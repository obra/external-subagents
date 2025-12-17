import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Paths } from '../src/lib/paths.ts';
import { Registry } from '../src/lib/registry.ts';
import { archiveCommand } from '../src/commands/archive.ts';
import { captureOutput } from './helpers/io.ts';

async function setupThread(status: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-archive-'));
  const codexRoot = path.join(root, '.codex-subagent');
  const paths = new Paths(codexRoot);
  await paths.ensure();
  const registry = new Registry(paths);
  await registry.upsert({
    thread_id: 'thread-123',
    role: 'researcher',
    permissions: 'workspace-write',
    controller_id: 'controller-one',
    status,
    updated_at: '2025-11-28T06:30:00Z',
  });
  await writeFile(paths.logFile('thread-123'), 'log-line\n');
  return { root, codexRoot, paths, registry };
}

describe('archive command', () => {
  beforeEach(() => {
    process.env = { ...process.env }; // ensure no accidental env coupling
  });

  it('moves completed thread files into archive directory', async () => {
    const { codexRoot, paths, registry } = await setupThread('completed');

    const { stdout } = captureOutput();
    await archiveCommand({
      rootDir: codexRoot,
      threadId: 'thread-123',
      yes: true,
      controllerId: 'controller-one',
      stdout,
    });

    await expect(registry.get('thread-123')).resolves.toBeUndefined();
    const archiveDir = paths.archiveDir('thread-123');
    await expect(access(path.join(archiveDir, 'log.ndjson'), fsConstants.F_OK)).resolves.toBeUndefined();
    const metadata = await readFile(path.join(archiveDir, 'metadata.json'), 'utf8');
    expect(metadata).toContain('thread-123');
  });

  it('supports archiving all completed threads with --completed', async () => {
    const { codexRoot, paths, registry } = await setupThread('completed');
    await registry.upsert({
      thread_id: 'thread-running',
      role: 'researcher',
      permissions: 'workspace-write',
      controller_id: 'controller-one',
      status: 'running',
    });

    const { stdout } = captureOutput();
    await archiveCommand({
      rootDir: codexRoot,
      completed: true,
      yes: true,
      controllerId: 'controller-one',
      stdout,
    });

    await expect(registry.get('thread-123')).resolves.toBeUndefined();
    const archiveDir = paths.archiveDir('thread-123');
    await expect(access(path.join(archiveDir, 'metadata.json'), fsConstants.F_OK)).resolves.toBeUndefined();
    await expect(registry.get('thread-running')).resolves.toBeDefined();
  });

  it('refuses to archive running threads', async () => {
    const { codexRoot } = await setupThread('running');

    await expect(
      archiveCommand({
        rootDir: codexRoot,
        threadId: 'thread-123',
        yes: true,
        controllerId: 'controller-one',
      })
    ).rejects.toThrow('Thread thread-123 is still running');
  });
});
