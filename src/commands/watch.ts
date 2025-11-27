import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { Writable } from 'node:stream';
import { peekCommand } from './peek.ts';

export interface WatchCommandOptions {
  rootDir?: string;
  threadId: string;
  intervalMs?: number;
  outputLastPath?: string;
  stdout?: Writable;
  signal?: AbortSignal;
  iterations?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<boolean>;
}

const DEFAULT_INTERVAL_MS = 5000;

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal) {
    try {
      await delay(ms, undefined, { signal });
      return !signal.aborted;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return false;
      }
      throw error;
    }
  } else {
    await delay(ms);
  }
  return true;
}

export async function watchCommand(options: WatchCommandOptions): Promise<void> {
  if (!options.threadId) {
    throw new Error('watch command requires --thread');
  }

  const stdout = options.stdout ?? process.stdout;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const signal = options.signal;
  const sleep = options.sleep ?? defaultSleep;
  let remaining = options.iterations ?? Number.POSITIVE_INFINITY;

  stdout.write(
    `Watching thread ${options.threadId} every ${intervalMs}ms. Press Ctrl+C to stop.\n`
  );

  while (remaining > 0) {
    if (signal?.aborted) {
      break;
    }

    await peekCommand({
      rootDir: options.rootDir,
      threadId: options.threadId,
      outputLastPath: options.outputLastPath,
      stdout,
    });

    remaining -= 1;
    if (remaining <= 0) {
      break;
    }

    if (signal?.aborted) {
      break;
    }

    const shouldContinue = await sleep(intervalMs, signal);
    if (!shouldContinue) {
      break;
    }
  }

  stdout.write(`Stopped watching thread ${options.threadId}\n`);
}
