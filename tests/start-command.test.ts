import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(() => ({
    unref: vi.fn(),
  })),
}));

vi.mock('node:child_process', () => childProcessMocks);
const spawnMock = childProcessMocks.spawn;

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
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => ({
      unref: vi.fn(),
    }));
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

    expect(runExec).toHaveBeenCalledWith(
      expect.objectContaining({
        promptFile: path.resolve(promptFile),
        profile: 'research-readonly',
        outputLastPath,
      })
    );

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

  it('detaches by default and launches worker with encoded payload', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-detached-'));
    const codexRoot = path.join(root, '.codex-subagent');
    const promptFile = path.join(root, 'prompt.txt');
    await writeFile(promptFile, 'Detached start run');

    const { stdout, output } = captureOutput();
    const threadId = await startCommand({
      rootDir: codexRoot,
      role: 'analyst',
      policy: 'workspace-write',
      promptFile,
      controllerId: 'controller-detached',
      stdout,
    });

    expect(threadId).toBeUndefined();
    expect(runExec).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const spawnArgs = spawnMock.mock.calls[0];
    expect(spawnArgs[0]).toBe(process.execPath);
    expect(spawnArgs[2]).toMatchObject({ detached: true, stdio: 'ignore' });

    const payloadBase64 = spawnArgs[1][2];
    const payloadJson = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    expect(payloadJson).toMatchObject({
      role: 'analyst',
      policy: 'workspace-write',
      controllerId: 'controller-detached',
    });
    expect(payloadJson.promptFile).toBe(path.resolve(promptFile));
    expect(payloadJson.rootDir).toBe(path.resolve(codexRoot));

    const detachedMessage = output.join('');
    expect(detachedMessage).toContain('Subagent launched in the background');

    const childProcess = spawnMock.mock.results[0]?.value;
    expect(childProcess?.unref).toBeDefined();
    expect(childProcess?.unref).toHaveBeenCalled();
  });

  it('augments prompts with working directory instructions when provided', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-start-cwd-'));
    const codexRoot = path.join(root, '.codex-subagent');
    const promptFile = path.join(root, 'prompt.txt');
    await writeFile(promptFile, 'Original prompt');

    const fixture = await loadFixture();
    vi.mocked(runExec).mockResolvedValueOnce(fixture);

    await startCommand({
      rootDir: codexRoot,
      role: 'researcher',
      policy: 'workspace-write',
      promptFile,
      controllerId: 'controller-test',
      wait: true,
      workingDir: '/tmp/demo-repo',
    });

    const callOptions = vi.mocked(runExec).mock.calls[0]?.[0];
    expect(callOptions?.transformPrompt).toBeTypeOf('function');
    const sample = callOptions.transformPrompt?.('Investigate.');
    expect(sample).toContain('/tmp/demo-repo');
    expect(sample).toContain('Investigate.');
  });

  it('applies persona prompt, skills, and model mapping', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-start-persona-'));
    const codexRoot = path.join(projectRoot, '.codex-subagent');
    const personaDir = path.join(projectRoot, '.codex', 'agents');
    await mkdir(personaDir, { recursive: true });
    const personaFile = path.join(personaDir, 'reviewer.md');
    await writeFile(
      personaFile,
      `---\nname: reviewer\ndescription: Code reviewer\nmodel: haiku\nskills: skill-alpha\n---\nYou are Reviewer Persona.\n`
    );

    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-home-'));
    const skillDir = path.join(tempHome, '.codex', 'skills', 'skill-alpha');
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Skill Alpha\nFollow these rules.');
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempHome);

    const promptFile = path.join(projectRoot, 'prompt.txt');
    await writeFile(promptFile, 'Persona prompt base.');

    const fixture = await loadFixture();
    vi.mocked(runExec).mockResolvedValueOnce(fixture);

    await startCommand({
      rootDir: codexRoot,
      role: 'reviewer',
      policy: 'workspace-write',
      promptFile,
      controllerId: 'controller-persona',
      wait: true,
      personaName: 'reviewer',
    });

    const callOptions = vi.mocked(runExec).mock.calls[0]?.[0];
    expect(callOptions?.sandbox).toBe('read-only');
    expect(callOptions?.transformPrompt).toBeTypeOf('function');
    const sample = callOptions.transformPrompt?.('Investigate now.');
    expect(sample).toContain('Reviewer Persona');
    expect(sample).toContain('Skill skill-alpha');
    expect(sample).toContain('Investigate now.');

    const registryPath = path.join(codexRoot, 'state', 'threads.json');
    const registry = JSON.parse(await readFile(registryPath, 'utf8'));
    const thread = registry[fixture.thread_id];
    expect(thread.persona).toBe('reviewer');

    homedirSpy.mockRestore();
  });
});
