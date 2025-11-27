import process from 'node:process';
import path from 'node:path';
import { Writable } from 'node:stream';
import { Paths } from '../lib/paths.ts';
import { Registry } from '../lib/registry.ts';
import { appendMessages } from '../lib/logs.ts';
import { runExec } from '../lib/exec-runner.ts';
import { resolvePolicy } from '../lib/policy.ts';
import { assertThreadOwnership } from '../lib/thread-ownership.ts';

export interface SendCommandOptions {
  rootDir?: string;
  threadId: string;
  promptFile: string;
  outputLastPath?: string;
  stdout?: Writable;
  controllerId: string;
}

function ensureThreadMetadata(
  threadId: string,
  thread?: {
    role?: string;
    policy?: string;
  }
) {
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }
  if (!thread.role || !thread.policy) {
    throw new Error(`Thread ${threadId} is missing role/policy metadata`);
  }
}

export async function sendCommand(options: SendCommandOptions): Promise<void> {
  if (!options.threadId) {
    throw new Error('send command requires --thread');
  }
  if (!options.promptFile) {
    throw new Error('send command requires --prompt-file');
  }

  const stdout = options.stdout ?? process.stdout;
  const paths = new Paths(options.rootDir);
  await paths.ensure();

  const registry = new Registry(paths);
  const ownedThread = await assertThreadOwnership(
    await registry.get(options.threadId),
    options.controllerId,
    registry
  );
  ensureThreadMetadata(options.threadId, ownedThread);
  const policyConfig = resolvePolicy(ownedThread.policy!);

  const execResult = await runExec({
    promptFile: path.resolve(options.promptFile),
    outputLastPath: options.outputLastPath,
    extraArgs: ['resume', options.threadId],
    ...policyConfig,
  });

  const logPath = paths.logFile(options.threadId);
  await appendMessages(logPath, execResult.messages ?? []);

  await registry.updateThread(options.threadId, {
    status: execResult.status ?? ownedThread.status,
    last_message_id: execResult.last_message_id ?? ownedThread.last_message_id,
  });

  stdout.write(`Sent prompt to thread ${options.threadId}\n`);
}
