import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
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
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => ({
      unref: vi.fn(),
    }));
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
      controller_id: 'controller-one',
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
      controllerId: 'controller-one',
      wait: true,
    });

    expect(runExec).toHaveBeenCalledWith(
      expect.objectContaining({
        promptFile,
        sandbox: 'workspace-write',
        outputLastPath,
        extraArgs: ['resume', 'thread-123'],
      })
    );

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
        controllerId: 'controller-one',
        wait: true,
      })
    ).rejects.toThrow('Thread not found');
  });

  it('errors when accessing a thread owned by another controller', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-send-other-'));
    const codexRoot = path.join(root, '.codex-subagent');
    const paths = new Paths(codexRoot);
    await paths.ensure();
    const registry = new Registry(paths);
    await registry.upsert({
      thread_id: 'thread-123',
      role: 'researcher',
      policy: 'workspace-write',
      controller_id: 'other-controller',
    });
    const promptFile = path.join(root, 'prompt.txt');
    await writeFile(promptFile, 'Ping');

    await expect(
      sendCommand({
        rootDir: codexRoot,
        threadId: 'thread-123',
        promptFile,
        controllerId: 'controller-one',
        wait: true,
      })
    ).rejects.toThrow('Thread thread-123 belongs to a different controller');
  });

  it('detaches by default and launches a send worker', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-send-detach-'));
    const codexRoot = path.join(root, '.codex-subagent');
    const paths = new Paths(codexRoot);
    await paths.ensure();

    const registry = new Registry(paths);
    await registry.upsert({
      thread_id: 'thread-123',
      role: 'researcher',
      policy: 'workspace-write',
      controller_id: 'controller-one',
    });

    const promptFile = path.join(root, 'prompt.txt');
    await writeFile(promptFile, 'Detached resume');

    const { stdout, output } = captureOutput();
    await sendCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      promptFile,
      controllerId: 'controller-one',
      stdout,
    });

    expect(runExec).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const spawnArgs = spawnMock.mock.calls[0];
    expect(spawnArgs[0]).toBe(process.execPath);
    expect(spawnArgs[2]).toMatchObject({ detached: true, stdio: 'ignore' });

    const payloadBase64 = spawnArgs[1][2];
    const payloadJson = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    expect(payloadJson).toMatchObject({
      threadId: 'thread-123',
      promptFile: path.resolve(promptFile),
      controllerId: 'controller-one',
    });
    expect(payloadJson.rootDir).toBe(path.resolve(codexRoot));

    const message = output.join('');
    expect(message).toContain('Prompt sent in the background');

    const childProcess = spawnMock.mock.results[0]?.value;
    expect(childProcess?.unref).toHaveBeenCalled();
  });

  it('prepends working directory instructions when waiting', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-send-cwd-'));
    const codexRoot = path.join(root, '.codex-subagent');
    const paths = new Paths(codexRoot);
    await paths.ensure();
    const registry = new Registry(paths);
    await registry.upsert({
      thread_id: 'thread-123',
      role: 'researcher',
      policy: 'workspace-write',
      controller_id: 'controller-one',
    });

    const promptFile = path.join(root, 'prompt.txt');
    await writeFile(promptFile, 'Continue');

    const fixture = await loadFixture();
    vi.mocked(runExec).mockResolvedValueOnce(fixture);

    await sendCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      promptFile,
      controllerId: 'controller-one',
      wait: true,
      workingDir: '/tmp/demo-repo',
    });

    const callOptions = vi.mocked(runExec).mock.calls[0]?.[0];
    expect(callOptions?.transformPrompt).toBeTypeOf('function');
    const sample = callOptions.transformPrompt?.('Original prompt');
    expect(sample).toContain('/tmp/demo-repo');
    expect(sample).toContain('Original prompt');
  });

  it('reuses stored persona prompts when resuming', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-send-persona-'));
    const codexRoot = path.join(root, '.codex-subagent');
    const paths = new Paths(codexRoot);
    await paths.ensure();
    const projectAgents = path.join(path.resolve(codexRoot, '..'), '.codex', 'agents');
    await mkdir(projectAgents, { recursive: true });
    await writeFile(
      path.join(projectAgents, 'reviewer.md'),
      `---\nname: reviewer\n---\nReviewer instructions.\n`
    );
    const registry = new Registry(paths);
    await registry.upsert({
      thread_id: 'thread-123',
      role: 'researcher',
      policy: 'workspace-write',
      controller_id: 'controller-one',
      persona: 'reviewer',
    });

    const promptFile = path.join(root, 'prompt.txt');
    await writeFile(promptFile, 'Continue');

    const fixture = await loadFixture();
    vi.mocked(runExec).mockResolvedValueOnce(fixture);

    await sendCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      promptFile,
      controllerId: 'controller-one',
      wait: true,
    });

    const callOptions = vi.mocked(runExec).mock.calls[0]?.[0];
    expect(callOptions?.transformPrompt).toBeTypeOf('function');
    const sample = callOptions.transformPrompt?.('Resume now.');
    expect(sample).toContain('Reviewer instructions');
    expect(sample).toContain('Resume now.');
  });
});
