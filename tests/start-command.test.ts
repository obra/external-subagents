import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../src/lib/exec-runner.ts', () => ({
  runExec: vi.fn(),
}));

import { runExec } from '../src/lib/exec-runner.ts';
import { startCommand } from '../src/commands/start.ts';
import { captureOutput } from './helpers/io.ts';

const execFixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'exec-start.json'
);

async function loadFixture() {
  const raw = await readFile(execFixturePath, 'utf8');
  return JSON.parse(raw);
}

describe('start command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs codex exec, stores registry metadata, and logs messages', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-start-'));
    const codexRoot = path.join(root, '.codex-subagent');
    const promptFile = path.join(root, 'prompt.txt');
    await writeFile(promptFile, 'Investigate Task 4.');
    const outputLastPath = path.join(root, 'last-message.txt');

    const fixture = await loadFixture();
    vi.mocked(runExec).mockResolvedValueOnce(fixture);

    const { stdout, output } = captureOutput();
    await startCommand({
      rootDir: codexRoot,
      role: 'researcher',
      policy: 'research-readonly',
      promptFile,
      outputLastPath,
      stdout,
      controllerId: 'controller-test',
      wait: true,
    });

    expect(runExec).toHaveBeenCalledWith({
      promptFile: path.resolve(promptFile),
      profile: 'research-readonly',
      outputLastPath,
    });

    const registryPath = path.join(codexRoot, 'state', 'threads.json');
    const registryRaw = await readFile(registryPath, 'utf8');
    const registry = JSON.parse(registryRaw);
    expect(registry[fixture.thread_id].policy).toBe('research-readonly');
    expect(registry[fixture.thread_id].last_message_id).toBe('msg-last');
    expect(registry[fixture.thread_id].role).toBe('researcher');
    expect(registry[fixture.thread_id].controller_id).toBe('controller-test');

    const logPath = path.join(codexRoot, 'logs', `${fixture.thread_id}.ndjson`);
    const logRaw = await readFile(logPath, 'utf8');
    const lines = logRaw.trim().split('\n');
    expect(lines).toHaveLength(fixture.messages.length);
    expect(JSON.parse(lines[0]).id).toBe('msg-last');

    expect(output.join('')).toContain(`Started thread ${fixture.thread_id}`);
  });

  it('propagates exec errors without creating new state files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-start-fail-'));
    const codexRoot = path.join(root, '.codex-subagent');
    await mkdir(codexRoot, { recursive: true });
    const promptFile = path.join(root, 'prompt.txt');
    await writeFile(promptFile, 'Investigate Task 4.');

    vi.mocked(runExec).mockRejectedValueOnce(new Error('exec failed'));

    await expect(
      startCommand({
        rootDir: codexRoot,
        role: 'researcher',
        policy: 'research-readonly',
        promptFile,
        controllerId: 'controller-test',
        wait: true,
      })
    ).rejects.toThrow('exec failed');

    await expect(access(path.join(codexRoot, 'state', 'threads.json'))).rejects.toBeTruthy();
  });
});
