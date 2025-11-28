import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureOutput } from './helpers/io.ts';
import { Paths } from '../src/lib/paths.ts';
import { Registry } from '../src/lib/registry.ts';
import { peekCommand } from '../src/commands/peek.ts';

async function setupThread() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-peek-'));
  const codexRoot = path.join(root, '.codex-subagent');
  const paths = new Paths(codexRoot);
  await paths.ensure();
  const registry = new Registry(paths);
  await registry.upsert({
    thread_id: 'thread-123',
    role: 'researcher',
    policy: 'workspace-write',
    status: 'running',
    last_message_id: 'msg-new',
    controller_id: 'controller-one',
  });
  return { root, codexRoot, paths, registry };
}

describe('peek command', () => {
  it('prints the newest unseen assistant message and updates last_pulled_id', async () => {
    const { codexRoot, paths, registry, root } = await setupThread();
    const logPath = paths.logFile('thread-123');
    const logEntries = [
      { id: 'msg-old', text: 'Old info' },
      { id: 'msg-new', text: 'New hotness' },
    ];
    await writeFile(logPath, logEntries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');

    const outputLast = path.join(root, 'latest.txt');
    const { stdout, output } = captureOutput();
    await peekCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      outputLastPath: outputLast,
      stdout,
      controllerId: 'controller-one',
    });

    expect(output.join('')).toContain('Latest message for thread thread-123');
    expect(output.join('')).toContain('New hotness');
    const updated = await registry.get('thread-123');
    expect(updated?.last_pulled_id).toBe('msg-new');
    expect(await readFile(outputLast, 'utf8')).toBe('New hotness');
  });

  it('reports when there are no updates since the last peek', async () => {
    const { codexRoot, paths, registry } = await setupThread();
    await registry.updateThread('thread-123', { last_pulled_id: 'msg-new' });
    const logPath = paths.logFile('thread-123');
    await writeFile(
      logPath,
      [
        { id: 'msg-old', text: 'Old info' },
        { id: 'msg-new', text: 'New hotness' },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    );

    const { stdout, output } = captureOutput();
    await peekCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      stdout,
      controllerId: 'controller-one',
    });
    expect(output.join('')).toContain('No updates for thread thread-123');
  });

  it('shows last activity timestamps when verbose and no updates exist', async () => {
    const { codexRoot, paths, registry } = await setupThread();
    await registry.updateThread('thread-123', {
      last_pulled_id: 'msg-new',
      updated_at: '2025-11-27T22:15:00Z',
    });
    const logPath = paths.logFile('thread-123');
    await writeFile(
      logPath,
      [
        { id: 'msg-old', text: 'Old info', created_at: '2025-11-27T22:00:00Z' },
        { id: 'msg-new', text: 'New hotness', created_at: '2025-11-27T22:05:00Z' },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    );

    const { stdout, output } = captureOutput();
    await peekCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      stdout,
      controllerId: 'controller-one',
      verbose: true,
    });

    const text = output.join('');
    expect(text).toContain('No updates for thread thread-123');
    expect(text).toContain('Last activity 2025-11-27T22:05:00Z');
  });

  it('informs the user when no log exists yet', async () => {
    const { codexRoot } = await setupThread();
    const { stdout, output } = captureOutput();
    await peekCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      stdout,
      controllerId: 'controller-one',
    });
    expect(output.join('')).toContain('No log entries found');
  });
});
