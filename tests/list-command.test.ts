import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { listCommand } from '../src/commands/list.ts';
import { RegistryLoadError } from '../src/lib/registry.ts';

const sampleThread = {
  thread_id: 'T-123',
  role: 'researcher',
  policy: 'research-readonly',
  status: 'running',
  updated_at: '2025-11-26T12:00:00Z',
  controller_id: 'controller-one',
};

async function createStateFixture(): Promise<string> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-'));
  const stateDir = path.join(tmp, '.codex-subagent', 'state');
  await mkdir(stateDir, { recursive: true });
  const threadsFile = path.join(stateDir, 'threads.json');
  await writeFile(
    threadsFile,
    JSON.stringify({ [sampleThread.thread_id]: sampleThread }, null, 2),
    'utf8'
  );
  return tmp;
}

async function writeLaunches(root: string, launches: Record<string, unknown>): Promise<void> {
  const stateDir = path.join(root, '.codex-subagent', 'state');
  await mkdir(stateDir, { recursive: true });
  await mkdir(path.join(stateDir, 'launch-errors'), { recursive: true });
  const launchesFile = path.join(stateDir, 'launches.json');
  await writeFile(launchesFile, JSON.stringify(launches, null, 2), 'utf8');
}

function captureOutput() {
  const output: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output.push(chunk.toString());
      callback();
    },
  });
  return { output, stdout };
}

describe('list command', () => {
  it('prints labels, statuses, and relative times with running threads first', async () => {
    const root = await createStateFixture();
    const { stdout, output } = captureOutput();
    await listCommand({
      rootDir: path.join(root, '.codex-subagent'),
      stdout,
      controllerId: 'controller-one',
      now: () => new Date('2025-11-26T12:05:00Z').valueOf(),
    });

    const text = output.join('');
    expect(text).toContain('Found 1 thread');
    expect(text).toContain('T-123');
    expect(text).toContain('running · researcher');
    expect(text).toContain('updated 5m ago');
    expect(text).not.toContain('unknown');
  });

  it('informs the user when no threads exist', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-empty-'));
    const { stdout, output } = captureOutput();
    await listCommand({
      rootDir: path.join(tmp, '.codex-subagent'),
      stdout,
      controllerId: 'controller-one',
    });

    expect(output.join('')).toContain('No threads found');
  });

  it('bubbles RegistryLoadError for malformed JSON', async () => {
    const root = await createStateFixture();
    const registryPath = path.join(root, '.codex-subagent', 'state', 'threads.json');
    await writeFile(registryPath, '{not-json', 'utf8');
    await expect(
      listCommand({
        rootDir: path.join(root, '.codex-subagent'),
        controllerId: 'controller-one',
      })
    ).rejects.toBeInstanceOf(RegistryLoadError);
  });

  it('skips threads belonging to other controllers', async () => {
    const root = await createStateFixture();
    const stateDir = path.join(root, '.codex-subagent', 'state');
    const threadsFile = path.join(stateDir, 'threads.json');
    const data = {
      [sampleThread.thread_id]: sampleThread,
      'T-OTHER': {
        ...sampleThread,
        thread_id: 'T-OTHER',
        controller_id: 'different-controller',
      },
    };
    await writeFile(threadsFile, JSON.stringify(data, null, 2));

    const { stdout, output } = captureOutput();
    await listCommand({
      rootDir: path.join(root, '.codex-subagent'),
      stdout,
      controllerId: 'controller-one',
    });

    const text = output.join('');
    expect(text).toContain('Found 1 thread');
    expect(text).toContain('T-123');
    expect(text).not.toContain('T-OTHER');
  });

  it('includes labels in output when present', async () => {
    const root = await createStateFixture();
    const threadsFile = path.join(root, '.codex-subagent', 'state', 'threads.json');
    const data = {
      RUNNING: {
        ...sampleThread,
        thread_id: 'RUNNING',
        status: 'running',
        label: 'Task 3 – log summaries',
        updated_at: new Date().toISOString(),
      },
      COMPLETE: {
        ...sampleThread,
        thread_id: 'COMPLETE',
        status: 'completed',
        updated_at: new Date().toISOString(),
      },
    };
    await writeFile(threadsFile, JSON.stringify(data, null, 2));

    const { stdout, output } = captureOutput();
    await listCommand({
      rootDir: path.join(root, '.codex-subagent'),
      stdout,
      controllerId: 'controller-one',
    });

    const text = output.join('');
    expect(text.indexOf('RUNNING (Task 3 – log summaries)')).toBeLessThan(text.indexOf('COMPLETE'));
  });

  it('shows failed launch diagnostics with NOT RUNNING text', async () => {
    const root = await createStateFixture();
    const codexRoot = path.join(root, '.codex-subagent');
    const stateDir = path.join(codexRoot, 'state');
    const logDir = path.join(stateDir, 'launch-errors');
    await mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, 'launch-failure.log');
    await writeFile(logPath, 'stderr output', 'utf8');

    await writeLaunches(root, {
      'launch-failure': {
        id: 'launch-failure',
        controller_id: 'controller-one',
        type: 'start',
        status: 'failed',
        label: 'Task Alpha',
        error_message: 'codex exec failed: profile missing',
        log_path: logPath,
        created_at: '2025-11-26T12:00:00Z',
        updated_at: '2025-11-26T12:01:00Z',
      },
    });

    const { stdout, output } = captureOutput();
    await listCommand({
      rootDir: codexRoot,
      stdout,
      controllerId: 'controller-one',
      now: () => new Date('2025-11-26T12:05:00Z').valueOf(),
    });

    const text = output.join('');
    expect(text).toContain('Launch diagnostics');
    expect(text).toContain('launch-failure');
    expect(text).toContain('NOT RUNNING');
    expect(text).toContain('codex exec failed');
    expect(text).toContain('See');
  });

  it('warns when a launch has been pending for several minutes', async () => {
    const root = await createStateFixture();
    const codexRoot = path.join(root, '.codex-subagent');

    await writeLaunches(root, {
      'launch-pending': {
        id: 'launch-pending',
        controller_id: 'controller-one',
        type: 'start',
        status: 'pending',
        label: 'Task Beta',
        created_at: '2025-11-26T12:00:00Z',
        updated_at: '2025-11-26T12:00:00Z',
      },
    });

    const { stdout, output } = captureOutput();
    await listCommand({
      rootDir: codexRoot,
      stdout,
      controllerId: 'controller-one',
      now: () => new Date('2025-11-26T12:07:00Z').valueOf(),
    });

    const text = output.join('');
    expect(text).toContain('Launch diagnostics');
    expect(text).toContain('launch-pending');
    expect(text).toContain('still waiting for Codex');
  });

  it('filters threads by status', async () => {
    const root = await createStateFixture();
    const threadsFile = path.join(root, '.codex-subagent', 'state', 'threads.json');
    const data = {
      't1': {
        thread_id: 't1',
        status: 'running',
        controller_id: 'controller-one',
        role: 'worker',
        policy: 'test',
        updated_at: new Date().toISOString(),
      },
      't2': {
        thread_id: 't2',
        status: 'completed',
        controller_id: 'controller-one',
        role: 'worker',
        policy: 'test',
        updated_at: new Date().toISOString(),
      },
    };
    await writeFile(threadsFile, JSON.stringify(data, null, 2));

    const { stdout, output } = captureOutput();
    await listCommand({
      rootDir: path.join(root, '.codex-subagent'),
      stdout,
      controllerId: 'controller-one',
      filterStatus: 'running',
    });

    const text = output.join('');
    expect(text).toContain('t1');
    expect(text).not.toContain('t2');
  });

  it('filters threads by label substring', async () => {
    const root = await createStateFixture();
    const threadsFile = path.join(root, '.codex-subagent', 'state', 'threads.json');
    const data = {
      't1': {
        thread_id: 't1',
        label: 'build-frontend',
        controller_id: 'controller-one',
        role: 'worker',
        policy: 'test',
        status: 'completed',
        updated_at: new Date().toISOString(),
      },
      't2': {
        thread_id: 't2',
        label: 'test-backend',
        controller_id: 'controller-one',
        role: 'worker',
        policy: 'test',
        status: 'completed',
        updated_at: new Date().toISOString(),
      },
    };
    await writeFile(threadsFile, JSON.stringify(data, null, 2));

    const { stdout, output } = captureOutput();
    await listCommand({
      rootDir: path.join(root, '.codex-subagent'),
      stdout,
      controllerId: 'controller-one',
      filterLabel: 'frontend',
    });

    const text = output.join('');
    expect(text).toContain('t1');
    expect(text).not.toContain('t2');
  });

  it('filters threads by role', async () => {
    const root = await createStateFixture();
    const threadsFile = path.join(root, '.codex-subagent', 'state', 'threads.json');
    const data = {
      't1': {
        thread_id: 't1',
        controller_id: 'controller-one',
        role: 'researcher',
        policy: 'test',
        status: 'completed',
        updated_at: new Date().toISOString(),
      },
      't2': {
        thread_id: 't2',
        controller_id: 'controller-one',
        role: 'worker',
        policy: 'test',
        status: 'completed',
        updated_at: new Date().toISOString(),
      },
    };
    await writeFile(threadsFile, JSON.stringify(data, null, 2));

    const { stdout, output } = captureOutput();
    await listCommand({
      rootDir: path.join(root, '.codex-subagent'),
      stdout,
      controllerId: 'controller-one',
      filterRole: 'researcher',
    });

    const text = output.join('');
    expect(text).toContain('t1');
    expect(text).not.toContain('t2');
  });
});
