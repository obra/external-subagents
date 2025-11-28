import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
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
});
