import process from 'node:process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { Writable } from 'node:stream';
import { Paths } from '../lib/paths.ts';
import { Registry } from '../lib/registry.ts';

export interface PullCommandOptions {
  rootDir?: string;
  threadId: string;
  outputLastPath?: string;
  stdout?: Writable;
}

function ensureThread(threadId: string, thread?: { role?: string; policy?: string }) {
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }
  if (!thread.role || !thread.policy) {
    throw new Error(`Thread ${threadId} is missing role/policy metadata`);
  }
}

interface LoggedMessage {
  id: string;
  role?: string;
  text?: string;
}

function parseLogLine(line: string): LoggedMessage | undefined {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed.id === 'string') {
      return parsed as LoggedMessage;
    }
  } catch {}
  return undefined;
}

export async function pullCommand(options: PullCommandOptions): Promise<void> {
  if (!options.threadId) {
    throw new Error('pull command requires --thread');
  }

  const stdout = options.stdout ?? process.stdout;
  const paths = new Paths(options.rootDir);
  await paths.ensure();

  const registry = new Registry(paths);
  const thread = await registry.get(options.threadId);
  ensureThread(options.threadId, thread);
  const safeThread = thread!;

  const logPath = paths.logFile(options.threadId);
  try {
    await access(logPath, fsConstants.F_OK);
  } catch {
    stdout.write(`No log entries found for thread ${options.threadId}\n`);
    return;
  }

  const logRaw = await readFile(logPath, 'utf8');
  const messages: LoggedMessage[] = logRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseLogLine(line))
    .filter((value): value is LoggedMessage => Boolean(value));

  let startIndex = 0;
  if (safeThread.last_pulled_id) {
    const previousIndex = messages.findIndex((message) => message.id === safeThread.last_pulled_id);
    if (previousIndex >= 0) {
      startIndex = previousIndex + 1;
    }
  }

  const newMessages = messages.slice(startIndex);

  if (newMessages.length === 0) {
    stdout.write(`No new messages for thread ${options.threadId}\n`);
    return;
  }

  const lines = newMessages.map((message) => {
    const text = typeof message.text === 'string' ? message.text : '[no-text]';
    return `- ${message.id} · ${text}`;
  });

  stdout.write(`New messages (${newMessages.length}) for thread ${options.threadId}\n`);
  stdout.write(`${lines.join('\n')}\n`);

  await registry.updateThread(options.threadId, {
    last_pulled_id: newMessages.at(-1)!.id,
  });

  if (options.outputLastPath) {
    await writeFile(options.outputLastPath, newMessages.at(-1)?.text ?? '', 'utf8');
  }
}
