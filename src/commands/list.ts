import process from 'node:process';
import { Writable } from 'node:stream';
import { Registry } from '../lib/registry.ts';
import type { ThreadMetadata } from '../lib/registry.ts';
import { assertThreadOwnership } from '../lib/thread-ownership.ts';
import { Paths } from '../lib/paths.ts';

export interface ListCommandOptions {
  rootDir?: string;
  stdout?: Writable;
  controllerId: string;
}

function formatThreadLine(thread: {
  thread_id: string;
  role?: string;
  status?: string;
  policy?: string;
  updated_at?: string;
}): string {
  const parts = [
    thread.thread_id,
    thread.role ?? 'unknown-role',
    thread.status ?? 'unknown-status',
  ];
  if (thread.policy) {
    parts.push(thread.policy);
  }
  if (thread.updated_at) {
    parts.push(`updated ${thread.updated_at}`);
  }
  return `- ${parts.join(' · ')}`;
}

export async function listCommand(options: ListCommandOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
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
  const lines = threads.map((thread) => formatThreadLine(thread));
  stdout.write(`${header}\n${lines.join('\n')}\n`);
}
