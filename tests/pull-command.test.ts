import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../src/lib/exec-runner.ts', () => ({
  runExec: vi.fn(),
}));

import { runExec } from '../src/lib/exec-runner.ts';
import { pullCommand } from '../src/commands/pull.ts';
import { Paths } from '../src/lib/paths.ts';
import { Registry } from '../src/lib/registry.ts';
import { captureOutput } from './helpers/io.ts';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function readFixture(name: string) {
  const raw = await readFile(path.join(fixtureDir, name), 'utf8');
  return JSON.parse(raw);
}

describe('pull command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('appends new messages when last_message_id changes', async () => {
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
      last_message_id: 'msg-old',
    });

    const fixture = await readFixture('exec-resume-new.json');
    const promptBodies: string[] = [];
    vi.mocked(runExec).mockImplementationOnce(async (options) => {
      promptBodies.push(await readFile(options.promptFile, 'utf8'));
      return fixture;
    });

    const outputLastPath = path.join(root, 'last.txt');
    const { stdout, output } = captureOutput();
    await pullCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      outputLastPath,
      stdout,
    });

    const call = vi.mocked(runExec).mock.calls[0][0];
    expect(call.extraArgs).toEqual(['resume', 'thread-123']);
    expect(call.outputLastPath).toBe(outputLastPath);
    expect(call.promptFile).toBeTruthy();
    expect(call.sandbox).toBe('workspace-write');
    expect(promptBodies[0]).toContain('NO_NEW_MESSAGES');
    expect(promptBodies[0]).toContain('fingerprint msg-old');

    const logPath = path.join(codexRoot, 'logs', 'thread-123.ndjson');
    const logRaw = await readFile(logPath, 'utf8');
    expect(logRaw).toContain('msg-new');

    const updated = await registry.get('thread-123');
    expect(updated?.last_message_id).toBe('msg-new');

    expect(output.join('')).toContain('Pulled 1 new message');
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
    });

    vi.mocked(runExec).mockResolvedValueOnce({
      thread_id: 'thread-123',
      last_message_id: 'msg-old',
      messages: [
        {
          id: 'msg-old',
          role: 'assistant',
          text: 'NO_NEW_MESSAGES',
        },
      ],
    });

    const { stdout, output } = captureOutput();
    await pullCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      stdout,
    });

    await expect(access(path.join(codexRoot, 'logs', 'thread-123.ndjson'))).rejects.toBeTruthy();
    expect(output.join('')).toContain('No new messages');
  });
});
