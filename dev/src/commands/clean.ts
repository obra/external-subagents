import { readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import process from 'node:process';
import { Paths } from '../lib/paths.ts';

export interface CleanCommandOptions {
  rootDir?: string;
  olderThanDays?: number;
  yes?: boolean;
  dryRun?: boolean;
  stdout?: Writable;
}

const DEFAULT_OLDER_THAN_DAYS = 30;

export async function cleanCommand(options: CleanCommandOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const olderThanDays = options.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;
  const paths = new Paths(options.rootDir);
  const archiveDir = paths.archiveRoot;

  if (!options.yes && !options.dryRun) {
    throw new Error('clean command requires --yes or --dry-run for safety');
  }

  let entries: string[];
  try {
    entries = await readdir(archiveDir);
  } catch {
    stdout.write('No archive directory found. Nothing to clean.\n');
    return;
  }

  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const toDelete: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(archiveDir, entry);
    const stats = await stat(entryPath);
    if (stats.isDirectory() && stats.mtimeMs < cutoff) {
      toDelete.push(entryPath);
    }
  }

  if (toDelete.length === 0) {
    stdout.write(`No archived directories older than ${olderThanDays} days.\n`);
    return;
  }

  if (options.dryRun) {
    stdout.write(`Would delete ${toDelete.length} archived directory(ies):\n`);
    for (const dir of toDelete) {
      stdout.write(`  ${path.basename(dir)}\n`);
    }
    return;
  }

  for (const dir of toDelete) {
    await rm(dir, { recursive: true });
  }

  stdout.write(`Deleted ${toDelete.length} archived directory(ies).\n`);
}
