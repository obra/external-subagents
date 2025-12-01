import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Paths } from '../src/lib/paths.ts';
import { cleanCommand } from '../src/commands/clean.ts';
import { captureOutput } from './helpers/io.ts';

async function createPaths(): Promise<Paths> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'clean-test-'));
  return new Paths(path.join(tempDir, '.codex-subagent'));
}

describe('clean command', () => {
  it('removes archived directories older than threshold', async () => {
    const paths = await createPaths();
    await paths.ensure();

    // Create archive subdirectories (matching actual structure)
    const oldThreadDir = path.join(paths.archiveRoot, 'old-thread');
    await mkdir(oldThreadDir, { recursive: true });
    const oldFile = path.join(oldThreadDir, 'log.ndjson');
    await writeFile(oldFile, 'test content');

    // Backdate directory to 40 days ago
    const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await utimes(oldThreadDir, oldTime, oldTime);

    // Create recent archive directory
    const newThreadDir = path.join(paths.archiveRoot, 'new-thread');
    await mkdir(newThreadDir, { recursive: true });
    const newFile = path.join(newThreadDir, 'log.ndjson');
    await writeFile(newFile, 'recent content');

    const { stdout } = captureOutput();
    await cleanCommand({
      rootDir: paths.root,
      olderThanDays: 30,
      yes: true,
      stdout,
    });

    const remaining = await readdir(paths.archiveRoot);
    expect(remaining).toContain('new-thread');
    expect(remaining).not.toContain('old-thread');

    await rm(path.dirname(paths.root), { recursive: true });
  });

  it('requires --yes or --dry-run for safety', async () => {
    const paths = await createPaths();
    await paths.ensure();

    await expect(
      cleanCommand({ rootDir: paths.root })
    ).rejects.toThrow('--yes or --dry-run');

    await rm(path.dirname(paths.root), { recursive: true });
  });

  it('shows what would be deleted in dry-run mode', async () => {
    const paths = await createPaths();
    await paths.ensure();

    const oldThreadDir = path.join(paths.archiveRoot, 'old-thread');
    await mkdir(oldThreadDir, { recursive: true });
    const oldFile = path.join(oldThreadDir, 'log.ndjson');
    await writeFile(oldFile, 'test');
    const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await utimes(oldThreadDir, oldTime, oldTime);

    const { stdout, output } = captureOutput();
    await cleanCommand({
      rootDir: paths.root,
      olderThanDays: 30,
      dryRun: true,
      stdout,
    });

    const text = output.join('');
    expect(text).toContain('Would delete');

    // Directory should still exist
    const remaining = await readdir(paths.archiveRoot);
    expect(remaining).toContain('old-thread');

    await rm(path.dirname(paths.root), { recursive: true });
  });
});
