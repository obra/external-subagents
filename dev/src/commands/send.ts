import process from 'node:process';
import path from 'node:path';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { runSendThreadWorkflow } from '../lib/send-thread.ts';
import { Paths } from '../lib/paths.ts';
import { LaunchRegistry } from '../lib/launch-registry.ts';
import { markThreadError } from '../lib/thread-errors.ts';

export interface SendCommandOptions {
  rootDir?: string;
  threadId: string;
  promptFile?: string;
  promptBody?: string;
  outputLastPath?: string;
  stdout?: Writable;
  controllerId: string;
  wait?: boolean;
  workingDir?: string;
  personaName?: string;
  printPrompt?: boolean;
  dryRun?: boolean;
  cliPath?: string;
}

export async function sendCommand(options: SendCommandOptions): Promise<void> {
  if (!options.threadId) {
    throw new Error('send command requires --thread');
  }
  if (!options.promptFile && !options.promptBody) {
    throw new Error('send command requires prompt content (--prompt-file or --json).');
  }

  const stdout = options.stdout ?? process.stdout;
  const paths = new Paths(options.rootDir ? path.resolve(options.rootDir) : undefined);
  const launchRegistry = new LaunchRegistry(paths);
  const runInline = options.wait || options.printPrompt || options.dryRun;
  if (runInline) {
    const useHeartbeat = options.wait && !options.printPrompt && !options.dryRun;
    if (useHeartbeat) {
      stdout.write(`Sending to thread ${options.threadId}... (this may take minutes)\n`);
    }

    // Track progress for heartbeat
    const startTime = Date.now();
    let lineCount = 0;
    const onProgress = useHeartbeat
      ? (count: number) => {
          lineCount = count;
        }
      : undefined;

    // Heartbeat every 30s so caller knows we're not dead
    const heartbeat = useHeartbeat
      ? setInterval(() => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const mins = Math.floor(elapsed / 60);
          const secs = elapsed % 60;
          const timestamp = new Date().toLocaleTimeString();
          stdout.write(`[${timestamp}] Still running... (${mins}m ${secs}s, ${lineCount} events)\n`);
        }, 30_000)
      : undefined;

    try {
      await runSendThreadWorkflow({
        rootDir: options.rootDir,
        threadId: options.threadId,
        promptFile: options.promptFile ? path.resolve(options.promptFile) : undefined,
        promptBody: options.promptBody,
        outputLastPath: options.outputLastPath ? path.resolve(options.outputLastPath) : undefined,
        controllerId: options.controllerId,
        workingDir: options.workingDir ? path.resolve(options.workingDir) : undefined,
        personaName: options.personaName,
        printPrompt: Boolean(options.printPrompt),
        dryRun: Boolean(options.dryRun),
        stdout,
        onProgress,
      });
    } catch (error) {
      if (!options.dryRun) {
        await markThreadError(paths, {
          threadId: options.threadId,
          controllerId: options.controllerId,
          message: formatErrorMessage(error),
        });
      }
      throw error;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
    if (options.dryRun) {
      stdout.write('Dry run: prompt not sent.\n');
    } else {
      stdout.write(`Sent prompt to thread ${options.threadId}\n`);
    }
    return;
  }

  const attempt = await launchRegistry.createAttempt({
    controllerId: options.controllerId,
    type: 'send',
    label: options.threadId,
    threadId: options.threadId,
  });
  launchDetachedSendWorker({ ...options, launchId: attempt.id });
  stdout.write(
    'Prompt sent in the background; Codex will continue processing. Use `peek`/`log` later to inspect results.\n'
  );
}

function launchDetachedSendWorker(options: SendCommandOptions & { launchId?: string }): void {
  const cliPath = resolveCliPath(options.cliPath);
  const payloadData = {
    rootDir: options.rootDir ? path.resolve(options.rootDir) : undefined,
    threadId: options.threadId,
    promptFile: options.promptFile ? path.resolve(options.promptFile) : undefined,
    promptBody: options.promptBody ?? undefined,
    outputLastPath: options.outputLastPath ? path.resolve(options.outputLastPath) : undefined,
    controllerId: options.controllerId,
    workingDir: options.workingDir ? path.resolve(options.workingDir) : undefined,
    personaName: options.personaName,
    launchId: options.launchId,
  };

  const payload = Buffer.from(JSON.stringify(payloadData), 'utf8').toString('base64');
  const child = spawn(process.execPath, [cliPath, 'worker-send', '--payload', payload], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function resolveCliPath(overridePath?: string): string {
  if (overridePath) {
    return path.resolve(overridePath);
  }
  if (process.argv[1]) {
    return process.argv[1];
  }
  throw new Error('Cannot determine CLI path: process.argv[1] is not set');
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}
