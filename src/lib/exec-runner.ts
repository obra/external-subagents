import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execa } from 'execa';
import type { ExecaError } from 'execa';

export interface ExecMessage {
  id: string;
  role?: string;
  created_at?: string;
  text?: string;
  raw?: unknown;
  raw_id?: string;
}

export interface ExecResult {
  thread_id: string;
  last_message_id?: string;
  status?: string;
  messages?: ExecMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface ExecOptions {
  promptFile: string;
  outputLastPath?: string;
  extraArgs?: string[];
  sandbox?: string;
  profile?: string;
}

function buildArgs(options: ExecOptions): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check'];
  if (options.outputLastPath) {
    args.push('--output-last-message', path.resolve(options.outputLastPath));
  }
  if (options.sandbox) {
    args.push('--sandbox', options.sandbox);
  }
  if (options.profile) {
    args.push('--profile', options.profile);
  }
  if (options.extraArgs && options.extraArgs.length > 0) {
    args.push(...options.extraArgs);
  }
  args.push('-');
  return args;
}

export async function runExec(options: ExecOptions): Promise<ExecResult> {
  const args = buildArgs(options);
  const promptBody = await readFile(path.resolve(options.promptFile), 'utf8');

  let stdout: string;
  try {
    ({ stdout } = await execa('codex', args, { input: promptBody }));
  } catch (error) {
    throw formatCodexExecError(error);
  }

  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error('codex exec returned no JSON output');
  }

  let threadId: string | undefined;
  const messages: ExecMessage[] = [];
  let status: string | undefined;

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Failed to parse codex exec JSON line: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!isRecord(event)) {
      continue;
    }

    const eventType = typeof event.type === 'string' ? event.type : undefined;

    if (eventType === 'thread.started' && typeof event.thread_id === 'string') {
      threadId = event.thread_id;
    }

    if (
      eventType === 'item.completed' &&
      isRecord(event.item) &&
      event.item.type === 'agent_message'
    ) {
      const item = event.item as Record<string, unknown> & { type: string };
      const rawPayload = JSON.stringify(item);
      const fingerprint = createHash('sha256').update(rawPayload).digest('hex');
      const rawId = typeof item.id === 'string' ? item.id : undefined;
      const id = fingerprint;
      const text = typeof item.text === 'string' ? item.text : undefined;
      messages.push({
        id,
        role: 'assistant',
        text,
        raw: item,
        raw_id: rawId,
      });
    }

    if (eventType === 'turn.completed') {
      status = 'completed';
    }
  }

  if (!threadId) {
    throw new Error('codex exec output missing thread.started event');
  }

  return {
    thread_id: threadId,
    status,
    messages,
    last_message_id: messages.at(-1)?.id,
  };
}

function formatCodexExecError(error: unknown): Error {
  const baseMessage = error instanceof Error ? error.message : String(error);
  let hint: string | undefined;

  if (isExecaError(error)) {
    const stderr = error.stderr ?? '';
    const stdout = error.stdout ?? '';
    hint = deriveRecoveryHint(stderr, stdout);
  }

  const message = hint
    ? `codex exec failed: ${baseMessage}\nRecovery hint: ${hint}`
    : `codex exec failed: ${baseMessage}`;

  return new Error(message);
}

function deriveRecoveryHint(stderr: string, stdout: string): string | undefined {
  const haystack = `${stderr}\n${stdout}`.toLowerCase();

  if (haystack.includes('config profile') && haystack.includes('not found')) {
    return 'The requested policy maps to a Codex config profile that does not exist. Use the built-in policies (workspace-write/read-only) or create the profile via `codex config`.';
  }

  if (haystack.includes('failed to initialize rollout recorder')) {
    return 'Codex CLI could not initialize its rollout recorder. Rerun your parent codex session with --dangerously-bypass-approvals-and-sandbox or from an environment where the rollout recorder is permitted.';
  }

  if (haystack.includes('command not found')) {
    return 'Verify that the `codex` CLI is installed and available on PATH in this environment.';
  }

  return undefined;
}

function isExecaError(error: unknown): error is ExecaError {
  return Boolean(error && typeof error === 'object' && 'isCanceled' in error);
}
