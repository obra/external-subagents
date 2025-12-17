import process from 'node:process';
import { rename, mkdir, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { Writable } from 'node:stream';
import path from 'node:path';
import { Paths } from '../lib/paths.ts';
import { Registry } from '../lib/registry.ts';
import { assertThreadOwnership } from '../lib/thread-ownership.ts';

interface ArchiveTarget {
  thread_id: string;
}

export interface ArchiveCommandOptions {
  rootDir?: string;
  threadId?: string;
  completed?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  controllerId: string;
  stdout?: Writable;
}

function ensureConfirmation(options: ArchiveCommandOptions): void {
  if (options.dryRun) {
    return;
  }
  if (!options.yes) {
    throw new Error('archive command requires --yes to proceed (or use --dry-run).');
  }
}

export async function archiveCommand(options: ArchiveCommandOptions): Promise<void> {
  if (!options.threadId && !options.completed) {
    throw new Error('archive command requires either --thread or --completed');
  }
  ensureConfirmation(options);

  const stdout = options.stdout ?? process.stdout;
  const paths = new Paths(options.rootDir);
  await paths.ensure();
  const registry = new Registry(paths);

  let candidates: ArchiveTarget[] = [];
  if (options.threadId) {
    candidates = [{ thread_id: options.threadId }];
  } else {
    const threads = await registry.listThreads();
    candidates = threads
      .filter((thread) => (thread.status ?? 'completed') !== 'running')
      .map((thread) => ({ thread_id: thread.thread_id }));
  }

  if (candidates.length === 0) {
    stdout.write('No eligible threads to archive.\n');
    return;
  }

  for (const candidate of candidates) {
    const thread = await assertThreadOwnership(
      await registry.get(candidate.thread_id),
      options.controllerId,
      registry
    );
    if (!thread) {
      continue;
    }
    if (thread.status === 'running') {
      throw new Error(`Thread ${thread.thread_id} is still running and cannot be archived`);
    }

    const archiveDir = paths.archiveDir(thread.thread_id);
    if (options.dryRun) {
      stdout.write(`[dry-run] Would archive ${thread.thread_id} to ${archiveDir}\n`);
      continue;
    }

    await mkdir(archiveDir, { recursive: true });
    const logPath = paths.logFile(thread.thread_id);
    try {
      await access(logPath, fsConstants.F_OK);
      await rename(logPath, paths.archivedLogFile(thread.thread_id));
    } catch {
      // no log to move, ignore
    }

    const metadataPath = path.join(archiveDir, 'metadata.json');
    await writeFile(metadataPath, JSON.stringify(thread, null, 2), 'utf8');

    await registry.remove(thread.thread_id);
    stdout.write(`Archived thread ${thread.thread_id}\n`);
  }
}
