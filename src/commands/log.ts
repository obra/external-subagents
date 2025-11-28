import process from 'node:process';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { Writable } from 'node:stream';
import { Paths } from '../lib/paths.ts';
import { Registry } from '../lib/registry.ts';
import { assertThreadOwnership } from '../lib/thread-ownership.ts';

export interface LogCommandOptions {
  rootDir?: string;
  threadId: string;
  tail?: number;
  raw?: boolean;
  stdout?: Writable;
  controllerId: string;
  verbose?: boolean;
}

export async function logCommand(options: LogCommandOptions): Promise<void> {
  if (!options.threadId) {
    throw new Error('log command requires --thread');
  }

  const stdout = options.stdout ?? process.stdout;
  const paths = new Paths(options.rootDir);
  await paths.ensure();

  const registry = new Registry(paths);
  const thread = await assertThreadOwnership(
    await registry.get(options.threadId),
    options.controllerId,
    registry
  );

  const logPath = paths.logFile(options.threadId);
  try {
    await access(logPath, fsConstants.F_OK);
  } catch {
    stdout.write(`No log entries found for thread ${options.threadId}\n`);
    if (options.verbose) {
      writeLastActivity(stdout, thread?.updated_at);
    }
    return;
  }

  const raw = await readFile(logPath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    stdout.write(`No log entries found for thread ${options.threadId}\n`);
    if (options.verbose) {
      writeLastActivity(stdout, thread?.updated_at);
    }
    return;
  }

  const tail = options.tail && options.tail > 0 ? options.tail : undefined;
  const slice = tail ? lines.slice(-tail) : lines;

  if (options.raw) {
    stdout.write(`${slice.join('\n')}\n`);
  } else {
    stdout.write(`Log entries for thread ${options.threadId} (${slice.length})\n`);
    for (const line of slice) {
      try {
        const entry = JSON.parse(line);
        const text = typeof entry.text === 'string' ? entry.text : '[no-text]';
        stdout.write(`- ${entry.id ?? '[unknown-id]'} · ${text}\n`);
      } catch {
        stdout.write(`- [invalid-json] · ${line}\n`);
      }
    }
  }

  if (options.verbose) {
    const timestamp = slice.length > 0 ? extractTimestampFromLine(slice[slice.length - 1]) : undefined;
    writeLastActivity(stdout, timestamp ?? thread?.updated_at);
  }
}

function writeLastActivity(stdout: Writable, timestamp?: string): void {
  if (!timestamp) {
    stdout.write('Last activity time unavailable\n');
    return;
  }
  stdout.write(`Last activity ${timestamp}\n`);
}

function extractTimestampFromLine(line: string): string | undefined {
  try {
    const entry = JSON.parse(line);
    if (entry && typeof entry.created_at === 'string') {
      return entry.created_at;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
