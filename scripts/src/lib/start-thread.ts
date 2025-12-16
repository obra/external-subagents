import path from 'node:path';
import { Paths } from './paths.ts';
import { runExec } from './exec-runner.ts';
import { Registry } from './registry.ts';
import { appendMessages } from './logs.ts';
import { composePrompt } from './prompt.ts';
import type { PersonaRuntime } from './personas.ts';
import type { PermissionLevel } from './backends.ts';

export interface StartThreadWorkflowOptions {
  rootDir?: string;
  role: string;
  promptFile?: string;
  promptBody?: string;
  outputLastPath?: string;
  controllerId: string;
  workingDir?: string;
  label?: string;
  persona?: PersonaRuntime;
  launchId?: string;
  onProgress?: (lineCount: number) => void;
  /** Backend to use: 'codex' (default) or 'claude' */
  backend?: 'codex' | 'claude';
  /** Permission level: 'read-only' or 'workspace-write' */
  permissions: PermissionLevel;
  /** Codex-only: custom profile name (overrides permissions) */
  profile?: string;
  /** Model to use (e.g., 'sonnet', 'opus', 'haiku') */
  model?: string;
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

  const backend = options.backend ?? 'codex';
  const transformPrompt = (body: string) =>
    composePrompt(body, { workingDir: options.workingDir, persona: options.persona });
  const execResult = await runExec({
    promptFile: options.promptFile ? path.resolve(options.promptFile) : undefined,
    promptBody: options.promptBody,
    outputLastPath: options.outputLastPath ? path.resolve(options.outputLastPath) : undefined,
    transformPrompt,
    onProgress: options.onProgress,
    backend,
    permissions: options.permissions,
    profile: options.profile,
    model: options.model,
  });

  const registry = new Registry(paths);
  await registry.upsert({
    thread_id: execResult.thread_id,
    role: options.role,
    permissions: options.permissions,
    status: execResult.status ?? 'running',
    last_message_id: execResult.last_message_id,
    controller_id: options.controllerId,
    label: options.label,
    persona: options.persona?.name,
    launch_id: options.launchId,
    backend,
  });

  const logPath = paths.logFile(execResult.thread_id);
  await appendMessages(logPath, execResult.messages ?? []);

  return { threadId: execResult.thread_id };
}
