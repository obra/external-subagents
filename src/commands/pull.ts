import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { Paths } from '../lib/paths.ts';
import { Registry } from '../lib/registry.ts';
import { appendMessages } from '../lib/logs.ts';
import { runExec } from '../lib/exec-runner.ts';
import { resolvePolicy } from '../lib/policy.ts';

export interface PullCommandOptions {
  rootDir?: string;
  threadId: string;
  outputLastPath?: string;
  stdout?: Writable;
}

async function createPullPromptFile(lastMessageId?: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-pull-'));
  const file = path.join(dir, 'prompt.txt');
  const text =
    'System ping from codex-subagent: do not take new actions or run commands. ' +
    (lastMessageId
      ? `If you have produced any assistant output after fingerprint ${lastMessageId}, restate the newest assistant message verbatim. `
      : 'Restate your most recent assistant message verbatim. ') +
    'If nothing is new, respond exactly with NO_NEW_MESSAGES.';
  await writeFile(file, text, 'utf8');
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
  const safeThread = thread!;
  const policyConfig = resolvePolicy(safeThread.policy!);

  const { dir, file } = await createPullPromptFile(safeThread.last_message_id);
  try {
    const execResult = await runExec({
      promptFile: file,
      outputLastPath: options.outputLastPath,
      extraArgs: ['resume', options.threadId],
      ...policyConfig,
    });

    const messages = execResult.messages ?? [];
    const filtered =
      safeThread.last_message_id == null
        ? messages
        : messages.filter((message) => message.id !== safeThread.last_message_id);
    const newMessages = filtered.filter(
      (message) => message.text?.trim().toUpperCase() !== 'NO_NEW_MESSAGES'
    );

    if (newMessages.length === 0) {
      stdout.write(`No new messages for thread ${options.threadId}\n`);
      return;
    }

    const appended = await appendMessages(paths.logFile(options.threadId), newMessages);
    await registry.updateThread(options.threadId, {
      status: execResult.status ?? safeThread.status,
      last_message_id: newMessages.at(-1)?.id,
    });

    stdout.write(
      `Pulled ${appended} new message${appended === 1 ? '' : 's'} for thread ${options.threadId}\n`
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
