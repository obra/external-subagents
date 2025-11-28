import process from 'node:process';
import { Writable } from 'node:stream';
import { Registry } from '../lib/registry.ts';
import type { ThreadMetadata } from '../lib/registry.ts';
import { assertThreadOwnership } from '../lib/thread-ownership.ts';
import { Paths } from '../lib/paths.ts';
import { formatRelativeTime } from '../lib/time.ts';

export interface ListCommandOptions {
  rootDir?: string;
  stdout?: Writable;
  controllerId: string;
  now?: () => number;
}

function formatThreadLine(thread: ThreadMetadata, nowMs: number): string {
  const idSegment = thread.label ? `${thread.thread_id} (${thread.label})` : thread.thread_id;
  const status = (thread.status ?? 'unknown').toLowerCase();
  const displayStatus = status === 'running' ? 'running' : 'stopped';
  const parts = [
    idSegment,
    displayStatus,
    thread.role ?? 'unknown-role',
  ];
  if (thread.policy) {
    parts.push(thread.policy);
  }
  parts.push(`updated ${formatRelativeTime(thread.updated_at, nowMs)}`);
  return `- ${parts.join(' · ')}`;
}

export async function listCommand(options: ListCommandOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const nowMs = options.now ? options.now() : Date.now();
  const paths = new Paths(options.rootDir);
  const registry = new Registry(paths);
  const normalized = await Promise.all(
    (await registry.listThreads()).map(async (thread) => {
      try {
        return await assertThreadOwnership(thread, options.controllerId, registry);
      } catch {
        return null;
      }
    })
  );
  const threads = normalized.filter((thread): thread is ThreadMetadata => Boolean(thread));

  if (threads.length === 0) {
    stdout.write('No threads found.\n');
    return;
  }

  const header = `Found ${threads.length} thread${threads.length === 1 ? '' : 's'} in ${paths.root}`;
  const sorted = threads.sort((a, b) => {
    const aRunning = a.status === 'running' ? 0 : 1;
    const bRunning = b.status === 'running' ? 0 : 1;
    if (aRunning !== bRunning) {
      return aRunning - bRunning;
    }
    const aTime = Date.parse(a.updated_at ?? '') || 0;
    const bTime = Date.parse(b.updated_at ?? '') || 0;
    return bTime - aTime;
  });
  const lines = sorted.map((thread) => formatThreadLine(thread, nowMs));
  stdout.write(`${header}\n${lines.join('\n')}\n`);
}
