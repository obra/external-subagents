import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Paths } from '../src/lib/paths.ts';
import { Registry } from '../src/lib/registry.ts';
import { labelCommand } from '../src/commands/label.ts';

async function setupThread(label?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-label-'));
  const codexRoot = path.join(root, '.codex-subagent');
  const paths = new Paths(codexRoot);
  await paths.ensure();
  const registry = new Registry(paths);
  await registry.upsert({
    thread_id: 'thread-123',
    role: 'researcher',
    permissions: 'workspace-write',
    controller_id: 'controller-one',
    label,
  });
  return { codexRoot, registry };
}

describe('label command', () => {
  it('sets or updates a label for an owned thread', async () => {
    const { codexRoot, registry } = await setupThread();

    await labelCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      label: 'Task 4 – CLI polish',
      controllerId: 'controller-one',
    });

    const updated = await registry.get('thread-123');
    expect(updated?.label).toBe('Task 4 – CLI polish');
  });

  it('rejects if the thread is missing', async () => {
    const { codexRoot } = await setupThread();

    await expect(
      labelCommand({
        rootDir: codexRoot,
        threadId: 'missing-thread',
        label: 'Whatever',
        controllerId: 'controller-one',
      })
    ).rejects.toThrow('Thread missing-thread not found');
  });
});
