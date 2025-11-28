import path from 'node:path';
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
  promptFile: string;
  outputLastPath?: string;
  controllerId: string;
  workingDir?: string;
  personaName?: string;
  persona?: PersonaRuntime;
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

  const execResult = await runExec({
    promptFile: path.resolve(options.promptFile),
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
