import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { Paths } from './paths.ts';
import { Registry } from './registry.ts';
import { appendMessages } from './logs.ts';
import { runExec } from './exec-runner.ts';
import { resolvePolicy } from './policy.ts';
import { assertThreadOwnership } from './thread-ownership.ts';
import { composePrompt } from './prompt.ts';
import { loadPersonaRuntime, PersonaRuntime } from './personas.ts';

export interface SendThreadWorkflowOptions {
  rootDir?: string;
  threadId: string;
  promptFile?: string;
  promptBody?: string;
  outputLastPath?: string;
  controllerId: string;
  workingDir?: string;
  personaName?: string;
  persona?: PersonaRuntime;
  printPrompt?: boolean;
  dryRun?: boolean;
  stdout?: Writable;
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

const RESUMABLE_STATUSES = ['completed', 'failed', 'stopped', 'waiting'];

function assertThreadResumable(thread: { thread_id: string; status?: string }): void {
  const status = thread.status?.toLowerCase() ?? 'unknown';
  if (!RESUMABLE_STATUSES.includes(status)) {
    throw new Error(
      `Thread ${thread.thread_id} has status "${thread.status}" and is not resumable. ` +
      `Can only resume threads with status: ${RESUMABLE_STATUSES.join(', ')}`
    );
  }
}

export async function runSendThreadWorkflow(
  options: SendThreadWorkflowOptions
): Promise<{ threadId: string }> {
  const paths = new Paths(options.rootDir);
  await paths.ensure();

  const registry = new Registry(paths);
  const ownedThread = await assertThreadOwnership(
    await registry.get(options.threadId),
    options.controllerId,
    registry
  );
  ensureThreadMetadata(options.threadId, ownedThread);
  assertThreadResumable(ownedThread);
  const policyConfig = resolvePolicy(ownedThread.policy!);
  let persona = options.persona;
  if (!persona) {
    const personaName = options.personaName ?? ownedThread.persona;
    if (personaName) {
      const projectRoot = path.resolve(paths.root, '..');
      persona = await loadPersonaRuntime(personaName, { projectRoot });
    }
  }
  const transformPrompt = (body: string) =>
    composePrompt(body, { workingDir: options.workingDir, persona });

  const stdout = options.stdout ?? process.stdout;
  let inlinePrompt = options.promptBody;
  const promptFile = options.promptFile ? path.resolve(options.promptFile) : undefined;

  if (!inlinePrompt && !promptFile) {
    throw new Error('send command requires prompt content (file or inline).');
  }

  if ((options.printPrompt || options.dryRun) && !inlinePrompt && promptFile) {
    inlinePrompt = await readFile(promptFile, 'utf8');
  }

  if (options.printPrompt || options.dryRun) {
    const preview = transformPrompt(inlinePrompt ?? '');
    stdout.write(`${preview}\n`);
    if (options.dryRun) {
      stdout.write('Dry run: Codex exec not started.\n');
      return { threadId: options.threadId };
    }
  }

  const execResult = await runExec({
    promptBody: inlinePrompt ?? undefined,
    promptFile: inlinePrompt ? undefined : promptFile!,
    outputLastPath: options.outputLastPath
      ? path.resolve(options.outputLastPath)
      : undefined,
    extraArgs: ['resume', options.threadId],
    transformPrompt,
    ...policyConfig,
  });

  const logPath = paths.logFile(options.threadId);
  await appendMessages(logPath, execResult.messages ?? []);

  await registry.updateThread(options.threadId, {
    status: execResult.status ?? ownedThread.status,
    last_message_id: execResult.last_message_id ?? ownedThread.last_message_id,
  });

  return { threadId: options.threadId };
}
