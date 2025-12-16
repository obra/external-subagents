import process from 'node:process';
import { Writable } from 'node:stream';
import { Paths } from '../lib/paths.ts';
import { Registry } from '../lib/registry.ts';
import { assertThreadOwnership } from '../lib/thread-ownership.ts';

export interface LabelCommandOptions {
  rootDir?: string;
  threadId: string;
  label: string;
  controllerId: string;
  stdout?: Writable;
}

export async function labelCommand(options: LabelCommandOptions): Promise<void> {
  if (!options.threadId) {
    throw new Error('label command requires --thread');
  }
  if (options.label === undefined) {
    throw new Error('label command requires --label');
  }

  const stdout = options.stdout ?? process.stdout;
  const paths = new Paths(options.rootDir);
  const registry = new Registry(paths);
  const existing = await registry.get(options.threadId);
  if (!existing) {
    throw new Error(`Thread ${options.threadId} not found`);
  }

  const thread = await assertThreadOwnership(existing, options.controllerId, registry);
  if (!thread) {
    throw new Error(`Thread ${options.threadId} not found`);
  }

  await registry.updateThread(options.threadId, {
    label: options.label,
  });

  stdout.write(`Thread ${options.threadId} labeled as "${options.label}"\n`);
}
