import process from 'node:process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { Writable } from 'node:stream';
import { Paths } from '../lib/paths.ts';
import { Registry } from '../lib/registry.ts';
import { assertThreadOwnership } from '../lib/thread-ownership.ts';

export interface PeekCommandOptions {
  rootDir?: string;
  threadId: string;
  outputLastPath?: string;
  stdout?: Writable;
  controllerId: string;
  verbose?: boolean;
}

interface LoggedMessage {
  id: string;
  text?: string;
  created_at?: string;
}

function parseLine(line: string): LoggedMessage | undefined {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed.id === 'string') {
      return parsed as LoggedMessage;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function peekCommand(options: PeekCommandOptions): Promise<void> {
  if (!options.threadId) {
    throw new Error('peek command requires --thread');
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
      writeLastActivity(stdout, thread.updated_at);
    }
    return;
  }

  const raw = await readFile(logPath, 'utf8');
  const messages = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLine)
    .filter((value): value is LoggedMessage => Boolean(value));

  if (messages.length === 0) {
    stdout.write(`No log entries found for thread ${options.threadId}\n`);
    if (options.verbose) {
      writeLastActivity(stdout, thread.updated_at);
    }
    return;
  }

  let latest: LoggedMessage | undefined;
  const mostRecent = messages[messages.length - 1];
  if (thread.last_pulled_id) {
    const idx = messages.findIndex((message) => message.id === thread.last_pulled_id);
    if (idx >= 0 && idx < messages.length - 1) {
      latest = messages[messages.length - 1];
    } else if (idx === messages.length - 1) {
      stdout.write(`No updates for thread ${options.threadId}\n`);
      if (options.verbose) {
        writeLastActivity(stdout, mostRecent?.created_at ?? thread.updated_at);
      }
      return;
    }
  }

  if (!latest) {
    latest = messages[messages.length - 1];
  }

  stdout.write(`Latest message for thread ${options.threadId}\n`);
  stdout.write(`- ${latest.id} · ${latest.text ?? '[no-text]'}\n`);
  if (options.verbose) {
    writeLastActivity(stdout, latest.created_at ?? thread.updated_at);
  }

  await registry.updateThread(options.threadId, {
    last_pulled_id: latest.id,
  });

  if (options.outputLastPath) {
    await writeFile(options.outputLastPath, latest.text ?? '', 'utf8');
  }
}

function writeLastActivity(stdout: Writable, timestamp?: string): void {
  if (!timestamp) {
    stdout.write('Last activity time unavailable\n');
    return;
  }
  stdout.write(`Last activity ${timestamp}\n`);
}
