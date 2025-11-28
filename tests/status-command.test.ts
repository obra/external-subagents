import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureOutput } from './helpers/io.ts';
import { Paths } from '../src/lib/paths.ts';
import { Registry } from '../src/lib/registry.ts';
import { statusCommand } from '../src/commands/status.ts';

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-status-'));
  const codexRoot = path.join(root, '.codex-subagent');
  const paths = new Paths(codexRoot);
  await paths.ensure();
  const registry = new Registry(paths);
  await registry.upsert({
    thread_id: 'thread-123',
    role: 'researcher',
    policy: 'workspace-write',
    controller_id: 'controller-one',
    status: 'running',
    updated_at: '2025-11-28T06:30:00Z',
  });
  return { codexRoot, paths, registry };
}

describe('status command', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('prints latest assistant message and last activity data', async () => {
    const { codexRoot, paths } = await setup();
    await writeFile(
      paths.logFile('thread-123'),
      [
        { id: 'msg-1', text: 'Old', created_at: '2025-11-28T06:20:00Z' },
        { id: 'msg-2', text: 'New info', created_at: '2025-11-28T06:29:00Z' },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    );

    const { stdout, output } = captureOutput();
    await statusCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      controllerId: 'controller-one',
      stdout,
      now: () => new Date('2025-11-28T06:35:00Z').valueOf(),
    });

    const text = output.join('');
    expect(text).toContain('Thread thread-123');
    expect(text).toContain('Status: running');
    expect(text).toContain('Latest assistant message');
    expect(text).toContain('New info');
    expect(text).toContain('Last activity 2025-11-28T06:29:00Z');
  });

  it('suggests follow-up when idle exceeds threshold', async () => {
    const { codexRoot, paths } = await setup();
    await writeFile(
      paths.logFile('thread-123'),
      [{ id: 'msg-1', text: 'Only entry', created_at: '2025-11-28T05:00:00Z' }]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    );

    const { stdout, output } = captureOutput();
    await statusCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      controllerId: 'controller-one',
      stdout,
      now: () => new Date('2025-11-28T06:30:00Z').valueOf(),
      staleMinutes: 30,
    });

    const text = output.join('');
    expect(text).toContain('Suggestion: send a follow-up');
  });

  it('prints tail output when requested', async () => {
    const { codexRoot, paths } = await setup();
    await writeFile(
      paths.logFile('thread-123'),
      [
        { id: 'msg-1', text: 'First' },
        { id: 'msg-2', text: 'Second' },
        { id: 'msg-3', text: 'Third' },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    );

    const { stdout, output } = captureOutput();
    await statusCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      controllerId: 'controller-one',
      stdout,
      tail: 2,
      raw: true,
    });

    const text = output.join('').trim();
    expect(text.split('\n').slice(-2)[0]).toContain('msg-2');
    expect(text.split('\n').slice(-1)[0]).toContain('msg-3');
  });

  it('surfaces error messages when a thread failed to resume', async () => {
    const { codexRoot, registry } = await setup();
    await registry.updateThread('thread-123', {
      status: 'failed',
      error_message: 'codex exec failed: missing policy',
      updated_at: '2025-11-28T06:31:00Z',
    });

    const { stdout, output } = captureOutput();
    await statusCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      controllerId: 'controller-one',
      stdout,
    });

    const text = output.join('');
    expect(text).toContain('Status: NOT RUNNING');
    expect(text).toContain('codex exec failed');
  });
});
