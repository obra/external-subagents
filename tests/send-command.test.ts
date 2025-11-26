import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../src/lib/exec-runner.ts', () => ({
  runExec: vi.fn(),
}));

import { runExec } from '../src/lib/exec-runner.ts';
import { sendCommand } from '../src/commands/send.ts';
import { Paths } from '../src/lib/paths.ts';
import { Registry } from '../src/lib/registry.ts';
import { captureOutput } from './helpers/io.ts';

const resumeFixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'exec-resume-new.json'
);

async function loadFixture() {
  const raw = await readFile(resumeFixturePath, 'utf8');
  return JSON.parse(raw);
}

describe('send command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resumes a thread with a prompt file and records new messages', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-send-'));
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

    const promptFile = path.join(root, 'prompt.txt');
    await writeFile(promptFile, 'Please continue.');
    const outputLastPath = path.join(root, 'last.txt');

    const fixture = await loadFixture();
    vi.mocked(runExec).mockResolvedValueOnce(fixture);

    const { stdout, output } = captureOutput();
    await sendCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      promptFile,
      outputLastPath,
      stdout,
    });

    expect(runExec).toHaveBeenCalledWith({
      promptFile,
      sandbox: 'workspace-write',
      outputLastPath,
      extraArgs: ['resume', 'thread-123'],
    });

    const logPath = path.join(codexRoot, 'logs', 'thread-123.ndjson');
    const logRaw = await readFile(logPath, 'utf8');
    const lines = logRaw.trim().split('\n');
    expect(lines).toHaveLength(fixture.messages.length);
    expect(JSON.parse(lines[0]).id).toBe('msg-new');

    const registryFile = await registry.get('thread-123');
    expect(registryFile?.last_message_id).toBe('msg-new');
    expect(registryFile?.status).toBe('running');

    expect(output.join('')).toContain('Sent prompt to thread thread-123');
  });

  it('throws when thread metadata is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-send-missing-'));
    const codexRoot = path.join(root, '.codex-subagent');
    const promptFile = path.join(root, 'prompt.txt');
    await writeFile(promptFile, 'Please respond.');

    await expect(
      sendCommand({
        rootDir: codexRoot,
        threadId: 'nope',
        promptFile,
      })
    ).rejects.toThrow('Thread nope not found');
  });
});
