import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Paths } from '../src/lib/paths.ts';
import { LaunchRegistry } from '../src/lib/launch-registry.ts';

async function createPaths(): Promise<Paths> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-launch-registry-'));
  const codexRoot = path.join(root, '.codex-subagent');
  const paths = new Paths(codexRoot);
  await paths.ensure();
  return paths;
}

describe('LaunchRegistry', () => {
  it('records attempts, failures, and cleans up successful launches', async () => {
    const paths = await createPaths();
    const registry = new LaunchRegistry(paths);

    const failure = await registry.createAttempt({
      controllerId: 'controller-one',
      type: 'start',
      label: 'Task Alpha',
      role: 'researcher',
      policy: 'workspace-write',
    });
    const success = await registry.createAttempt({
      controllerId: 'controller-one',
      type: 'send',
      label: 'Task Beta',
      role: 'researcher',
      policy: 'workspace-write',
    });

    expect(failure.status).toBe('pending');
    expect(success.status).toBe('pending');

    await registry.markFailure(failure.id, {
      error: new Error('codex exec failed'),
      stderr: 'stacktrace details',
    });

    await registry.markSuccess(success.id, { threadId: 'T-123' });

    const launchesRaw = await readFile(paths.launchesFile, 'utf8');
    const launches = JSON.parse(launchesRaw);
    expect(launches[failure.id].status).toBe('failed');
    expect(launches[failure.id].error_message).toContain('codex exec failed');
    expect(launches[failure.id].log_path).toContain('launch-errors');
    expect(launches[success.id]).toBeUndefined();

    const attempts = await registry.listAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].id).toBe(failure.id);
  });

  it('cleans up stale pending launches older than threshold', async () => {
    const paths = await createPaths();
    await paths.ensure();
    const registry = new LaunchRegistry(paths);

    // Create a pending launch
    const attempt = await registry.createAttempt({
      controllerId: 'test',
      type: 'start',
      label: 'stale-test',
    });

    // Read the file directly and backdate it
    const launchesFile = paths.launchesFile;
    const data = JSON.parse(await readFile(launchesFile, 'utf8'));
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
    data[attempt.id].created_at = oldTime;
    data[attempt.id].updated_at = oldTime;
    await writeFile(launchesFile, JSON.stringify(data, null, 2));

    // Clean up stale launches (1 hour threshold)
    const cleaned = await registry.cleanupStale(60 * 60 * 1000);
    expect(cleaned).toBe(1);

    // Verify it's now marked as failed
    const attempts = await registry.listAttempts();
    const stale = attempts.find(a => a.id === attempt.id);
    expect(stale?.status).toBe('failed');
    expect(stale?.error_message).toContain('Stale');
  });
});
