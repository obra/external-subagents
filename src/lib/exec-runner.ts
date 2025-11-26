import path from 'node:path';
import { execa } from 'execa';

export interface ExecMessage {
  id: string;
  role?: string;
  created_at?: string;
  content?: unknown;
}

export interface ExecResult {
  thread_id: string;
  last_message_id?: string;
  status?: string;
  messages?: ExecMessage[];
}

export interface ExecOptions {
  promptFile: string;
  role: string;
  policy: string;
  outputLastPath?: string;
  extraArgs?: string[];
}

function buildArgs(options: ExecOptions): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check'];
  args.push('--role', options.role.trim());
  args.push('--policy', options.policy.trim());
  args.push('--prompt-file', path.resolve(options.promptFile));
  if (options.outputLastPath) {
    args.push('--output-last-message', path.resolve(options.outputLastPath));
  }
  if (options.extraArgs && options.extraArgs.length > 0) {
    args.push(...options.extraArgs);
  }
  return args;
}

export async function runExec(options: ExecOptions): Promise<ExecResult> {
  const args = buildArgs(options);

  let stdout: string;
  try {
    ({ stdout } = await execa('codex', args));
  } catch (error) {
    const prefix = 'codex exec failed';
    if (error instanceof Error) {
      error.message = `${prefix}: ${error.message}`;
    }
    throw error;
  }

  try {
    const parsed = JSON.parse(stdout) as ExecResult;
    if (!parsed?.thread_id) {
      throw new Error('codex exec response missing thread_id');
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse codex exec JSON: ${message}`);
  }
}
