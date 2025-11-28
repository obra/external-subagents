import path from 'node:path';
import { Paths } from './paths.ts';
import { resolvePolicy } from './policy.ts';
import { runExec } from './exec-runner.ts';
import { Registry } from './registry.ts';
import { appendMessages } from './logs.ts';
import { composePrompt } from './prompt.ts';
import type { PersonaRuntime } from './personas.ts';

export interface StartThreadWorkflowOptions {
  rootDir?: string;
  role: string;
  policy: string;
  promptFile?: string;
  promptBody?: string;
  outputLastPath?: string;
  controllerId: string;
  workingDir?: string;
  label?: string;
  persona?: PersonaRuntime;
}

export interface StartThreadWorkflowResult {
  threadId: string;
}

export async function runStartThreadWorkflow(
  options: StartThreadWorkflowOptions
): Promise<StartThreadWorkflowResult> {
  if (!options.promptBody && !options.promptFile) {
    throw new Error('runStartThreadWorkflow requires a prompt body or file.');
  }

  const paths = new Paths(options.rootDir);
  await paths.ensure();

  const policyConfig = resolvePolicy(options.policy);
  const transformPrompt = (body: string) =>
    composePrompt(body, { workingDir: options.workingDir, persona: options.persona });
  const execResult = await runExec({
    promptFile: options.promptFile ? path.resolve(options.promptFile) : undefined,
    promptBody: options.promptBody,
    outputLastPath: options.outputLastPath ? path.resolve(options.outputLastPath) : undefined,
    transformPrompt,
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
    label: options.label,
    persona: options.persona?.name,
  });

  const logPath = paths.logFile(execResult.thread_id);
  await appendMessages(logPath, execResult.messages ?? []);

  return { threadId: execResult.thread_id };
}
