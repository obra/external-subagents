import process from 'node:process';
import path from 'node:path';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSendThreadWorkflow } from '../lib/send-thread.ts';

export interface SendCommandOptions {
  rootDir?: string;
  threadId: string;
  promptFile: string;
  outputLastPath?: string;
  stdout?: Writable;
  controllerId: string;
  wait?: boolean;
  workingDir?: string;
  personaName?: string;
}

const WORKER_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../send-runner.js'
);

export async function sendCommand(options: SendCommandOptions): Promise<void> {
  if (!options.threadId) {
    throw new Error('send command requires --thread');
  }
  if (!options.promptFile) {
    throw new Error('send command requires --prompt-file');
  }

  const stdout = options.stdout ?? process.stdout;
  if (options.wait) {
    await runSendThreadWorkflow({
      rootDir: options.rootDir,
      threadId: options.threadId,
      promptFile: path.resolve(options.promptFile),
      outputLastPath: options.outputLastPath ? path.resolve(options.outputLastPath) : undefined,
      controllerId: options.controllerId,
      workingDir: options.workingDir ? path.resolve(options.workingDir) : undefined,
      personaName: options.personaName,
    });
    stdout.write(`Sent prompt to thread ${options.threadId}\n`);
    return;
  }

  launchDetachedSendWorker(options);
  stdout.write(
    'Prompt sent in the background; Codex will continue processing. Use `peek`/`log` later to inspect results.\n'
  );
}

function launchDetachedSendWorker(options: SendCommandOptions): void {
  const payloadData = {
    rootDir: options.rootDir ? path.resolve(options.rootDir) : undefined,
    threadId: options.threadId,
    promptFile: path.resolve(options.promptFile),
    outputLastPath: options.outputLastPath ? path.resolve(options.outputLastPath) : undefined,
    controllerId: options.controllerId,
    workingDir: options.workingDir ? path.resolve(options.workingDir) : undefined,
    personaName: options.personaName,
  };

  const payload = Buffer.from(JSON.stringify(payloadData), 'utf8').toString('base64');
  const child = spawn(process.execPath, [WORKER_SCRIPT, '--payload', payload], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
