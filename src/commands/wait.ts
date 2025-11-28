import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { Writable } from 'node:stream';
import { Paths } from '../lib/paths.ts';
import { Registry, ThreadMetadata } from '../lib/registry.ts';
import { assertThreadOwnership } from '../lib/thread-ownership.ts';
import { readLogLines, parseLogLine } from '../lib/log-lines.ts';

export interface WaitCommandOptions {
  rootDir?: string;
  threadIds?: string[];
  labels?: string[];
  includeAll?: boolean;
  intervalMs?: number;
  timeoutMs?: number;
  followLast?: boolean;
  stdout?: Writable;
  controllerId: string;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<boolean>;
  now?: () => number;
  signal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 5000;

type OwnedThreadMap = Map<string, ThreadMetadata>;

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
  }
  await delay(ms);
  return true;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (remSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remSeconds}s`;
}

function normalizedStatus(status?: string): string {
  if (!status) {
    return 'unknown';
  }
  return status.toLowerCase();
}

function isRunningStatus(status?: string): boolean {
  const normalized = normalizedStatus(status);
  return normalized === 'running' || normalized === 'queued' || normalized === 'pending';
}

async function selectOwnedThreads(
  registry: Registry,
  controllerId: string
): Promise<OwnedThreadMap> {
  const threads = await registry.listThreads();
  const ownedEntries = await Promise.all(
    threads.map(async (thread) => {
      try {
        return await assertThreadOwnership(thread, controllerId, registry);
      } catch {
        return null;
      }
    })
  );
  const owned = ownedEntries.filter(
    (thread): thread is ThreadMetadata => thread !== null && Boolean(thread.thread_id)
  );
  return new Map(owned.map((thread) => [thread.thread_id, thread]));
}

async function loadThreadById(
  registry: Registry,
  controllerId: string,
  threadId: string
): Promise<ThreadMetadata> {
  const entry = await registry.get(threadId);
  return assertThreadOwnership(entry, controllerId, registry);
}

function formatThreadLabel(thread: ThreadMetadata | undefined, threadId: string): string {
  if (thread?.label) {
    return `${threadId} (${thread.label})`;
  }
  return threadId;
}

async function getLastAssistantSummary(paths: Paths, threadId: string): Promise<string | undefined> {
  const lines = await readLogLines(paths.logFile(threadId));
  if (lines.length === 0) {
    return undefined;
  }
  const messages = lines
    .map(parseLogLine)
    .filter((message): message is NonNullable<ReturnType<typeof parseLogLine>> => Boolean(message));
  if (messages.length === 0) {
    return undefined;
  }
  const assistants = messages.filter((message) => (message.role ?? 'assistant') === 'assistant');
  const latest = assistants.at(-1) ?? messages.at(-1);
  if (!latest) {
    return undefined;
  }
  const timestamp = latest.created_at ? ` (${latest.created_at})` : '';
  const text = latest.text ?? '[no-text]';
  return `${text}${timestamp}`;
}

interface TargetSelection {
  ids: string[];
  lookup: Map<string, ThreadMetadata>;
}

async function buildTargetSelection(
  registry: Registry,
  controllerId: string,
  options: WaitCommandOptions
): Promise<TargetSelection> {
  const owned = await selectOwnedThreads(registry, controllerId);
  const selected = new Map<string, ThreadMetadata>();

  if (options.includeAll) {
    for (const [threadId, thread] of owned.entries()) {
      selected.set(threadId, thread);
    }
  }

  if (options.labels && options.labels.length > 0) {
    for (const label of options.labels) {
      const matches = Array.from(owned.values()).filter((thread) => thread.label === label);
      if (matches.length === 0) {
        throw new Error(`No threads found with label "${label}" for controller ${controllerId}`);
      }
      for (const match of matches) {
        selected.set(match.thread_id, match);
      }
    }
  }

  if (options.threadIds && options.threadIds.length > 0) {
    for (const threadId of options.threadIds) {
      const trimmed = threadId.trim();
      if (!trimmed) {
        throw new Error('Thread IDs cannot be empty strings.');
      }
      const local = owned.get(trimmed) ?? (await loadThreadById(registry, controllerId, trimmed));
      selected.set(trimmed, local);
    }
  }

  return { ids: Array.from(selected.keys()), lookup: selected };
}

export async function waitCommand(options: WaitCommandOptions): Promise<void> {
  const hasSelection =
    (options.threadIds && options.threadIds.length > 0) ||
    (options.labels && options.labels.length > 0) ||
    options.includeAll;
  if (!hasSelection) {
    throw new Error(
      'wait command requires at least one selector: --threads, --labels, or --all-controller'
    );
  }

  const stdout = options.stdout ?? process.stdout;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  if (intervalMs <= 0) {
    throw new Error('--interval-ms must be greater than 0');
  }

  if (options.timeoutMs !== undefined && options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be greater than 0');
  }

  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  const paths = new Paths(options.rootDir);
  const registry = new Registry(paths);
  const selection = await buildTargetSelection(registry, options.controllerId, options);

  if (selection.ids.length === 0) {
    throw new Error('No matching threads found for wait command.');
  }

  const pending = new Set(selection.ids);
  const startTimestamp = now();
  stdout.write(
    `Waiting for ${selection.ids.length} thread${selection.ids.length === 1 ? '' : 's'} to stop (interval ${intervalMs}ms).\n`
  );

  while (pending.size > 0) {
    const snapshot = await registry.listThreads();
    const snapshotMap = new Map(snapshot.map((thread) => [thread.thread_id, thread]));

    for (const threadId of Array.from(pending)) {
      const entry = snapshotMap.get(threadId);
      if (!entry) {
        // Thread might have been archived or not yet created; treat absence as completed.
        pending.delete(threadId);
        stdout.write(
          `- ${formatThreadLabel(selection.lookup.get(threadId), threadId)} no longer in registry (treated as stopped)\n`
        );
        if (options.followLast) {
          const summary = await getLastAssistantSummary(paths, threadId);
          if (summary) {
            stdout.write(`  Last assistant: ${summary}\n`);
          }
        }
        continue;
      }

      const normalized = normalizedStatus(entry.status);
      if (!isRunningStatus(normalized)) {
        pending.delete(threadId);
        stdout.write(
          `- ${formatThreadLabel(entry, threadId)} finished with status ${normalized}\n`
        );
        if (options.followLast) {
          const summary = await getLastAssistantSummary(paths, threadId);
          if (summary) {
            stdout.write(`  Last assistant: ${summary}\n`);
          }
        }
      }
    }

    if (pending.size === 0) {
      break;
    }

    if (options.timeoutMs !== undefined) {
      const elapsed = now() - startTimestamp;
      if (elapsed >= options.timeoutMs) {
        throw new Error(
          `Timed out waiting for ${pending.size} thread${
            pending.size === 1 ? '' : 's'
          } after ${formatDuration(options.timeoutMs)}`
        );
      }
    }

    const shouldContinue = await sleep(intervalMs, options.signal);
    if (!shouldContinue) {
      throw new Error('wait command aborted before threads completed.');
    }
  }

  const totalElapsed = now() - startTimestamp;
  stdout.write(
    `All threads stopped after ${formatDuration(totalElapsed)}.\n`
  );
}
