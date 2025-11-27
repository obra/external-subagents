import process from 'node:process';
import { Writable } from 'node:stream';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runStartThreadWorkflow } from '../lib/start-thread.ts';

export interface StartCommandOptions {
  rootDir?: string;
  role: string;
  policy: string;
  promptFile: string;
  outputLastPath?: string;
  stdout?: Writable;
  controllerId: string;
  wait?: boolean;
}

const WORKER_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../start-runner.js'
);

export async function startCommand(options: StartCommandOptions): Promise<string | undefined> {
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

  if (options.wait) {
    const result = await runStartThreadWorkflow(options);
    stdout.write(`Started thread ${result.threadId}\n`);
    return result.threadId;
  }

  launchDetachedWorker(options);
  stdout.write(
    'Subagent launched in the background; Codex may run for minutes or hours. Use `codex-subagent list`, `peek`, or `log` later to inspect results.\n'
  );
  return undefined;
}

function launchDetachedWorker(options: StartCommandOptions): void {
  const payloadData = {
    rootDir: options.rootDir ? path.resolve(options.rootDir) : undefined,
    role: options.role,
    policy: options.policy,
    promptFile: path.resolve(options.promptFile),
    outputLastPath: options.outputLastPath ? path.resolve(options.outputLastPath) : undefined,
    controllerId: options.controllerId,
  };

  const payload = Buffer.from(JSON.stringify(payloadData), 'utf8').toString('base64');
  const child = spawn(process.execPath, [WORKER_SCRIPT, '--payload', payload], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
