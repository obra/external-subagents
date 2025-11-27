import process from 'node:process';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { Writable } from 'node:stream';
import { Paths } from '../lib/paths.ts';
import { Registry } from '../lib/registry.ts';

export interface LogCommandOptions {
  rootDir?: string;
  threadId: string;
  tail?: number;
  raw?: boolean;
  stdout?: Writable;
}

export async function logCommand(options: LogCommandOptions): Promise<void> {
  if (!options.threadId) {
    throw new Error('log command requires --thread');
  }

  const stdout = options.stdout ?? process.stdout;
  const paths = new Paths(options.rootDir);
  await paths.ensure();

  const registry = new Registry(paths);
  const thread = await registry.get(options.threadId);
  if (!thread) {
    throw new Error(`Thread ${options.threadId} not found`);
  }

  const logPath = paths.logFile(options.threadId);
  try {
    await access(logPath, fsConstants.F_OK);
  } catch {
    stdout.write(`No log entries found for thread ${options.threadId}\n`);
    return;
  }

  const raw = await readFile(logPath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    stdout.write(`No log entries found for thread ${options.threadId}\n`);
    return;
  }

  const tail = options.tail && options.tail > 0 ? options.tail : undefined;
  const slice = tail ? lines.slice(-tail) : lines;

  if (options.raw) {
    stdout.write(`${slice.join('\n')}\n`);
    return;
  }

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
