import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pullCommand } from '../src/commands/pull.ts';
import { Paths } from '../src/lib/paths.ts';
import { Registry } from '../src/lib/registry.ts';
import { captureOutput } from './helpers/io.ts';

describe('pull command', () => {
  it('prints messages appended since the last pull and writes outputLast', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-pull-'));
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
      last_pulled_id: 'msg-old',
    });

    const logPath = paths.logFile('thread-123');
    const first = {
      id: 'msg-old',
      role: 'assistant',
      text: 'Old message',
    };
    const second = {
      id: 'msg-new',
      role: 'assistant',
      text: 'New info',
    };
    await writeFile(logPath, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`, 'utf8');

    const outputLastPath = path.join(root, 'last.txt');
    const { stdout, output } = captureOutput();
    await pullCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      outputLastPath,
      stdout,
    });

    const updated = await registry.get('thread-123');
    expect(updated?.last_pulled_id).toBe('msg-new');
    expect(output.join('')).toContain('New messages (1) for thread thread-123');
    expect(await readFile(outputLastPath, 'utf8')).toContain('New info');
  });

  it('reports when no new messages are available', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-pull-none-'));
    const codexRoot = path.join(root, '.codex-subagent');
    const paths = new Paths(codexRoot);
    await paths.ensure();
    const registry = new Registry(paths);
    await registry.upsert({
      thread_id: 'thread-123',
      role: 'researcher',
      policy: 'workspace-write',
      status: 'running',
      last_message_id: 'msg-old',
      last_pulled_id: 'msg-old',
    });

    const logPath = paths.logFile('thread-123');
    const entry = {
      id: 'msg-old',
      role: 'assistant',
      text: 'Old message',
    };
    await writeFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');

    const { stdout, output } = captureOutput();
    await pullCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      stdout,
    });

    expect(output.join('')).toContain('No new messages');
  });
});
