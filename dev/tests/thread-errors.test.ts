import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Paths } from '../src/lib/paths.ts';
import { Registry } from '../src/lib/registry.ts';
import { markThreadError } from '../src/lib/thread-errors.ts';

async function createThread(paths: Paths) {
  const registry = new Registry(paths);
  await registry.upsert({
    thread_id: 'thread-xyz',
    controller_id: 'controller-one',
    role: 'researcher',
    permissions: 'workspace-write',
    status: 'running',
  });
}

describe('markThreadError', () => {
  it('updates the thread status and stores the error message', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-thread-error-'));
    const codexRoot = path.join(root, '.codex-subagent');
    const paths = new Paths(codexRoot);
    await paths.ensure();
    await createThread(paths);

    await markThreadError(paths, {
      threadId: 'thread-xyz',
      controllerId: 'controller-one',
      message: 'codex exec failed: policy missing',
    });

    const registry = new Registry(paths);
    const thread = await registry.get('thread-xyz');
    expect(thread?.status).toBe('failed');
    expect(thread?.error_message).toContain('policy missing');
  });
});
