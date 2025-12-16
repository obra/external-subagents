import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureOutput } from './helpers/io.ts';
import { Paths } from '../src/lib/paths.ts';
import { Registry } from '../src/lib/registry.ts';
import { logCommand } from '../src/commands/log.ts';

describe('log command', () => {
  async function setup() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-log-'));
    const codexRoot = path.join(root, '.codex-subagent');
    const paths = new Paths(codexRoot);
    await paths.ensure();
    const registry = new Registry(paths);
    await registry.upsert({
      thread_id: 'thread-123',
      role: 'researcher',
      permissions: 'workspace-write',
      controller_id: 'controller-one',
    });
    return { root, codexRoot, paths };
  }

  it('prints formatted log lines by default', async () => {
    const { codexRoot, paths } = await setup();
    await writeFile(
      paths.logFile('thread-123'),
      [
        { id: 'msg-1', text: 'first' },
        { id: 'msg-2', text: 'second' },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    );

    const { stdout, output } = captureOutput();
    await logCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      stdout,
      controllerId: 'controller-one',
    });

    const text = output.join('');
    expect(text).toContain('Log entries for thread thread-123 (2)');
    expect(text).toContain('msg-1');
    expect(text).toContain('msg-2');
  });

  it('honors the --tail option and raw output', async () => {
    const { codexRoot, paths } = await setup();
    await writeFile(
      paths.logFile('thread-123'),
      [
        { id: 'msg-1', text: 'first' },
        { id: 'msg-2', text: 'second' },
        { id: 'msg-3', text: 'third' },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    );

    const { stdout, output } = captureOutput();
    await logCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      tail: 2,
      raw: true,
      stdout,
      controllerId: 'controller-one',
    });

    const lines = output.join('').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('msg-2');
    expect(lines[1]).toContain('msg-3');
  });

  it('prints last activity metadata when verbose', async () => {
    const { codexRoot, paths } = await setup();
    await writeFile(
      paths.logFile('thread-123'),
      [
        { id: 'msg-1', text: 'first', created_at: '2025-11-27T22:00:00Z' },
        { id: 'msg-2', text: 'second', created_at: '2025-11-27T22:10:00Z' },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    );

    const { stdout, output } = captureOutput();
    await logCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      stdout,
      controllerId: 'controller-one',
      verbose: true,
    });

    const text = output.join('');
    expect(text).toContain('Last activity 2025-11-27T22:10:00Z');
  });
});
