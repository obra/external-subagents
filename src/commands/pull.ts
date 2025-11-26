import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { Paths } from '../lib/paths.ts';
import { Registry } from '../lib/registry.ts';
import { appendMessages } from '../lib/logs.ts';
import { runExec } from '../lib/exec-runner.ts';

export interface PullCommandOptions {
  rootDir?: string;
  threadId: string;
  outputLastPath?: string;
  stdout?: Writable;
}

async function createEmptyPromptFile(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-pull-'));
  const file = path.join(dir, 'prompt.txt');
  await writeFile(file, '', 'utf8');
  return { dir, file };
}

function ensureThread(threadId: string, thread?: { role?: string; policy?: string }) {
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }
  if (!thread.role || !thread.policy) {
    throw new Error(`Thread ${threadId} is missing role/policy metadata`);
  }
}

export async function pullCommand(options: PullCommandOptions): Promise<void> {
  if (!options.threadId) {
    throw new Error('pull command requires --thread');
  }

  const stdout = options.stdout ?? process.stdout;
  const paths = new Paths(options.rootDir);
  await paths.ensure();

  const registry = new Registry(paths);
  const thread = await registry.get(options.threadId);
  ensureThread(options.threadId, thread);

  const { dir, file } = await createEmptyPromptFile();
  try {
    const execResult = await runExec({
      promptFile: file,
      role: thread!.role!,
      policy: thread!.policy!,
      outputLastPath: options.outputLastPath,
      extraArgs: ['resume', options.threadId],
    });

    const latestId = execResult.last_message_id;
    if (!latestId || latestId === thread!.last_message_id) {
      stdout.write(`No new messages for thread ${options.threadId}\n`);
      return;
    }

    const appended = await appendMessages(
      paths.logFile(options.threadId),
      execResult.messages ?? []
    );
    await registry.updateThread(options.threadId, {
      status: execResult.status ?? thread!.status,
      last_message_id: latestId,
    });

    stdout.write(
      `Pulled ${appended} new message${appended === 1 ? '' : 's'} for thread ${options.threadId}\n`
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
