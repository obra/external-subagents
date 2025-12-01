import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Paths } from '../src/lib/paths.ts';
import { Registry } from '../src/lib/registry.ts';
import { assertThreadOwnership } from '../src/lib/thread-ownership.ts';

async function createTestPaths(): Promise<Paths> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ownership-test-'));
  return new Paths(path.join(tempDir, '.codex-subagent'));
}

describe('Thread Ownership', () => {
  it('throws when thread has no controller_id instead of auto-claiming', async () => {
    const paths = await createTestPaths();
    await paths.ensure();
    const registry = new Registry(paths);

    // Create thread with no controller
    await registry.upsert({
      thread_id: 'orphan-thread',
      role: 'worker',
      policy: 'test',
      status: 'completed',
    });

    const thread = await registry.get('orphan-thread');

    // Should throw, not auto-claim
    await expect(
      assertThreadOwnership(thread, 'new-controller', registry)
    ).rejects.toThrow('has no controller');

    await rm(path.dirname(paths.root), { recursive: true });
  });

  it('allows access when controller matches', async () => {
    const paths = await createTestPaths();
    await paths.ensure();
    const registry = new Registry(paths);

    await registry.upsert({
      thread_id: 'owned-thread',
      role: 'worker',
      policy: 'test',
      status: 'completed',
      controller_id: 'my-controller',
    });

    const thread = await registry.get('owned-thread');
    const result = await assertThreadOwnership(thread, 'my-controller', registry);
    expect(result.thread_id).toBe('owned-thread');

    await rm(path.dirname(paths.root), { recursive: true });
  });

  it('rejects access when controller does not match', async () => {
    const paths = await createTestPaths();
    await paths.ensure();
    const registry = new Registry(paths);

    await registry.upsert({
      thread_id: 'other-thread',
      role: 'worker',
      policy: 'test',
      status: 'completed',
      controller_id: 'other-controller',
    });

    const thread = await registry.get('other-thread');
    await expect(
      assertThreadOwnership(thread, 'my-controller', registry)
    ).rejects.toThrow('belongs to a different controller');

    await rm(path.dirname(paths.root), { recursive: true });
  });
});
