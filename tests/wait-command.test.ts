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
  launch_id?: string;
}

async function writeRegistry(root: string, threads: Record<string, ThreadFixture>): Promise<void> {
  const stateDir = path.join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  const file = path.join(stateDir, 'threads.json');
  await writeFile(file, JSON.stringify(threads, null, 2), 'utf8');
}

async function writeLaunches(
  root: string,
  launches: Record<string, unknown>
): Promise<void> {
  const stateDir = path.join(root, 'state');
  await mkdir(stateDir, { recursive: true });
  const file = path.join(stateDir, 'launches.json');
  await writeFile(file, JSON.stringify(launches, null, 2), 'utf8');
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

  it('waits for pending launches to register threads before completing', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-wait-launch-'));
    const codexRoot = path.join(workspace, '.codex-subagent');
    await writeRegistry(codexRoot, {});
    await writeLaunches(codexRoot, {
      'launch-1': {
        id: 'launch-1',
        controller_id: 'controller-one',
        type: 'start',
        status: 'pending',
        label: 'live-node-app',
        created_at: '2025-11-28T10:00:00Z',
        updated_at: '2025-11-28T10:00:00Z',
      },
    });

    const sleep = vi.fn(async () => {
      await writeRegistry(codexRoot, {
        'thread-new': {
          thread_id: 'thread-new',
          role: 'engineer',
          policy: 'workspace-write',
          status: 'completed',
          updated_at: '2025-11-28T10:01:00Z',
          controller_id: 'controller-one',
          label: 'live-node-app',
          launch_id: 'launch-1',
        },
      });
      await writeLaunches(codexRoot, {}); // launch resolved
      return true;
    });

    const now = vi.fn();
    now.mockReturnValueOnce(0);
    now.mockReturnValue(5_000);

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

    const text = output.join('');
    expect(text).toContain('thread-new');
    expect(text).toContain('All threads stopped');
    expect(sleep).toHaveBeenCalled();
  });

  it('throws error when thread disappears unexpectedly', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-wait-missing-'));
    const codexRoot = path.join(workspace, '.codex-subagent');
    await writeRegistry(codexRoot, {
      'vanishing-thread': {
        thread_id: 'vanishing-thread',
        role: 'worker',
        policy: 'workspace-write',
        status: 'running',
        updated_at: '2025-11-28T09:00:00Z',
        controller_id: 'test-controller',
      },
    });

    let pollCount = 0;
    const sleep = vi.fn(async () => {
      pollCount++;
      if (pollCount === 2) {
        // Thread disappears during wait (not archived, just gone)
        await writeRegistry(codexRoot, {});
      }
      await new Promise((r) => setTimeout(r, 10));
      return true;
    });

    const now = vi.fn();
    now.mockReturnValueOnce(0);
    now.mockReturnValue(5_000);

    await expect(
      waitCommand({
        rootDir: codexRoot,
        threadIds: ['vanishing-thread'],
        controllerId: 'test-controller',
        intervalMs: 50,
        timeoutMs: 10_000,
        sleep,
        now,
      })
    ).rejects.toThrow(/disappeared|missing|unexpectedly/i);
  });
});
