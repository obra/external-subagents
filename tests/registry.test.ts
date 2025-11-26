import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Paths } from '../src/lib/paths.ts';
import { Registry, RegistryLoadError } from '../src/lib/registry.ts';

async function createPaths(): Promise<Paths> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-ts-'));
  return new Paths(path.join(root, '.codex-subagent'));
}

describe('Registry (TypeScript)', () => {
  it('returns an empty list when the registry file is missing', async () => {
    const paths = await createPaths();
    const registry = new Registry(paths);
    const threads = await registry.listThreads();
    expect(threads).toEqual([]);
  });

  it('throws RegistryLoadError when JSON is malformed', async () => {
    const paths = await createPaths();
    await paths.ensure();
    await writeFile(paths.threadsFile, '{not-json', 'utf8');
    const registry = new Registry(paths);
    await expect(registry.listThreads()).rejects.toBeInstanceOf(RegistryLoadError);
  });

  it('rejects upserts without a thread_id', async () => {
    const paths = await createPaths();
    await paths.ensure();
    const registry = new Registry(paths);
    await expect(
      registry.upsert({ role: 'worker' } as unknown as { thread_id: string })
    ).rejects.toThrow('thread_id is required');
  });
});
