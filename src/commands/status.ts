import process from 'node:process';
import { Writable } from 'node:stream';
import { Paths } from '../lib/paths.ts';
import { Registry } from '../lib/registry.ts';
import { assertThreadOwnership } from '../lib/thread-ownership.ts';
import { formatRelativeTime } from '../lib/time.ts';
import { readLogLines, parseLogLine, LoggedMessage } from '../lib/log-lines.ts';

export interface StatusCommandOptions {
  rootDir?: string;
  threadId: string;
  tail?: number;
  raw?: boolean;
  staleMinutes?: number;
  stdout?: Writable;
  controllerId: string;
  now?: () => number;
}

const DEFAULT_STALE_MINUTES = 15;

export async function statusCommand(options: StatusCommandOptions): Promise<void> {
  if (!options.threadId) {
    throw new Error('status command requires --thread');
  }

  const stdout = options.stdout ?? process.stdout;
  const staleMinutes = options.staleMinutes ?? DEFAULT_STALE_MINUTES;
  if (staleMinutes <= 0) {
    throw new Error('--stale-minutes must be greater than 0');
  }
  const nowMs = options.now ? options.now() : Date.now();

  const paths = new Paths(options.rootDir);
  await paths.ensure();

  const registry = new Registry(paths);
  const thread = await assertThreadOwnership(
    await registry.get(options.threadId),
    options.controllerId,
    registry
  );
  if (!thread) {
    throw new Error(`Thread ${options.threadId} not found`);
  }

  const logPath = paths.logFile(options.threadId);
  const lines = await readLogLines(logPath);

  const messages = lines
    .map(parseLogLine)
    .filter((message): message is LoggedMessage => Boolean(message));
  const latest = messages.at(-1);
  const lastActivityTs = latest?.created_at ?? thread.updated_at;

  stdout.write(
    `Thread ${thread.thread_id}${thread.label ? ` (${thread.label})` : ''}\n`
  );
  const status = thread.status ?? 'unknown';
  stdout.write(
    `Status: ${status} · updated ${formatRelativeTime(thread.updated_at, nowMs)}\n`
  );

  if (latest) {
    stdout.write('Latest assistant message:\n');
    stdout.write(`- ${latest.id} · ${latest.text ?? '[no-text]'}\n`);
  } else {
    stdout.write('No assistant messages recorded yet.\n');
  }

  stdout.write(
    `Last activity ${lastActivityTs ?? 'unknown'} (${formatRelativeTime(lastActivityTs, nowMs)})\n`
  );

  if (lastActivityTs) {
    const idleMinutes = Math.floor((nowMs - Date.parse(lastActivityTs)) / 60000);
    if (idleMinutes >= staleMinutes) {
      stdout.write(
        `Suggestion: send a follow-up prompt (idle for ${idleMinutes}m).\n`
      );
    }
  }

  if (options.tail && options.tail > 0) {
    const slice = lines.slice(-options.tail);
    if (options.raw) {
      if (slice.length > 0) {
        stdout.write(`${slice.join('\n')}\n`);
      }
    } else {
      stdout.write(
        `Log tail for thread ${options.threadId} (${slice.length})\n`
      );
      for (const line of slice) {
        try {
          const entry = JSON.parse(line);
          stdout.write(`- ${entry.id ?? '[unknown-id]'} · ${entry.text ?? '[no-text]'}\n`);
        } catch {
          stdout.write(`- [invalid-json] · ${line}\n`);
        }
      }
    }
  }
}
