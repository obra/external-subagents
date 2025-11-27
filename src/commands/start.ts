import process from 'node:process';
import { Writable } from 'node:stream';
import { Paths } from '../lib/paths.ts';
import { Registry } from '../lib/registry.ts';
import { runExec } from '../lib/exec-runner.ts';
import { appendMessages } from '../lib/logs.ts';
import { resolvePolicy } from '../lib/policy.ts';

export interface StartCommandOptions {
  rootDir?: string;
  role: string;
  policy: string;
  promptFile: string;
  outputLastPath?: string;
  stdout?: Writable;
  controllerId: string;
}

export async function startCommand(options: StartCommandOptions): Promise<string> {
  if (!options.role) {
    throw new Error('start command requires --role');
  }
  if (!options.policy) {
    throw new Error('start command requires --policy');
  }
  if (!options.promptFile) {
    throw new Error('start command requires --prompt-file');
  }

  const stdout = options.stdout ?? process.stdout;
  const paths = new Paths(options.rootDir);
  await paths.ensure();

  const policyConfig = resolvePolicy(options.policy);
  const execResult = await runExec({
    promptFile: options.promptFile,
    outputLastPath: options.outputLastPath,
    ...policyConfig,
  });

  const registry = new Registry(paths);
  await registry.upsert({
    thread_id: execResult.thread_id,
    role: options.role,
    policy: options.policy,
    status: execResult.status ?? 'running',
    last_message_id: execResult.last_message_id,
    controller_id: options.controllerId,
  });

  const logPath = paths.logFile(execResult.thread_id);
  await appendMessages(logPath, execResult.messages ?? []);

  stdout.write(`Started thread ${execResult.thread_id}\n`);
  return execResult.thread_id;
}
