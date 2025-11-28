import { describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { waitCommand } from '../src/commands/wait.ts';
import { captureOutput } from './helpers/io.ts';

interface ThreadFixture {
  thread_id: string;
  role?: string;
  policy?: string;
  status?: string;
  updated_at?: string;
  controller_id?: string;
  label?: string;
}

async function writeRegistry(root: string, threads: Record<string, ThreadFixture>): Promise<void> {
  const stateDir = path.join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  const file = path.join(stateDir, 'threads.json');
  await writeFile(file, JSON.stringify(threads, null, 2), 'utf8');
}

async function appendLog(root: string, threadId: string, lines: unknown[]): Promise<void> {
  const logsDir = path.join(root, 'logs');
  await mkdir(logsDir, { recursive: true });
  const file = path.join(logsDir, `${threadId}.ndjson`);
  const payload = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
  await writeFile(file, payload, 'utf8');
}

describe('wait command', () => {
  it('waits for all controller threads and resolves when they finish', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-wait-'));
    const codexRoot = path.join(workspace, '.codex-subagent');
    await writeRegistry(codexRoot, {
      'thread-running': {
        thread_id: 'thread-running',
        role: 'researcher',
        policy: 'workspace-write',
        status: 'running',
        updated_at: '2025-11-28T09:00:00Z',
        controller_id: 'controller-one',
      },
      'thread-other-controller': {
        thread_id: 'thread-other-controller',
        status: 'running',
        controller_id: 'other-controller',
      },
    });

    const now = vi.fn();
    now.mockReturnValueOnce(0);
    now.mockReturnValue(5_000);
    const sleep = vi.fn(async () => {
      await writeRegistry(codexRoot, {
        'thread-running': {
          thread_id: 'thread-running',
          role: 'researcher',
          policy: 'workspace-write',
          status: 'completed',
          updated_at: '2025-11-28T09:05:00Z',
          controller_id: 'controller-one',
        },
        'thread-other-controller': {
          thread_id: 'thread-other-controller',
          status: 'running',
          controller_id: 'other-controller',
        },
      });
      return true;
    });

    const { stdout, output } = captureOutput();
    await waitCommand({
      rootDir: codexRoot,
      controllerId: 'controller-one',
      includeAll: true,
      intervalMs: 100,
      timeoutMs: 10_000,
      sleep,
      now,
      stdout,
    });

    expect(output.join('')).toContain('thread-running');
    expect(output.join('')).toContain('All threads stopped');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('times out if threads never finish', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-wait-timeout-'));
    const codexRoot = path.join(workspace, '.codex-subagent');
    await writeRegistry(codexRoot, {
      'thread-stuck': {
        thread_id: 'thread-stuck',
        role: 'analyst',
        policy: 'workspace-write',
        status: 'running',
        updated_at: '2025-11-28T09:00:00Z',
        controller_id: 'controller-one',
      },
    });

    const now = vi.fn();
    now.mockReturnValueOnce(0);
    now.mockReturnValue(2_000);

    await expect(
      waitCommand({
        rootDir: codexRoot,
        controllerId: 'controller-one',
        threadIds: ['thread-stuck'],
        intervalMs: 100,
        timeoutMs: 1_000,
        sleep: async () => true,
        now,
      })
    ).rejects.toThrow(/Timed out/i);
  });

  it('selects threads by label and prints the last assistant message when follow-last is enabled', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-wait-label-'));
    const codexRoot = path.join(workspace, '.codex-subagent');
    await writeRegistry(codexRoot, {
      'thread-labeled': {
        thread_id: 'thread-labeled',
        role: 'reviewer',
        policy: 'workspace-write',
        status: 'completed',
        updated_at: '2025-11-28T09:15:00Z',
        controller_id: 'controller-one',
        label: 'Task 7',
      },
    });
    await appendLog(codexRoot, 'thread-labeled', [
      { id: 'msg-1', text: 'Working on it', created_at: '2025-11-28T09:10:00Z', role: 'assistant' },
      { id: 'msg-2', text: 'All done', created_at: '2025-11-28T09:15:00Z', role: 'assistant' },
    ]);

    const { stdout, output } = captureOutput();
    await waitCommand({
      rootDir: codexRoot,
      controllerId: 'controller-one',
      labels: ['Task 7'],
      followLast: true,
      stdout,
      sleep: async () => true,
      now: () => 0,
    });

    const text = output.join('');
    expect(text).toContain('thread-labeled');
    expect(text).toContain('Last assistant: All done');
  });
});
