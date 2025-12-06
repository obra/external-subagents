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
  promptFile?: string;
  promptBody?: string;
  outputLastPath?: string;
  extraArgs?: string[];
  sandbox?: string;
  profile?: string;
  transformPrompt?: (body: string) => string;
  onProgress?: (lineCount: number) => void;
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
  let promptBody: string;
  if (typeof options.promptBody === 'string') {
    promptBody = options.promptBody;
  } else if (options.promptFile) {
    promptBody = await readFile(path.resolve(options.promptFile), 'utf8');
  } else {
    throw new Error('runExec requires either promptBody or promptFile.');
  }

  if (options.transformPrompt) {
    promptBody = options.transformPrompt(promptBody);
  }

  // Stream stdout to count lines for progress reporting
  const lines: string[] = [];
  const child = execa('codex', args, { input: promptBody });

  if (child.stdout && options.onProgress) {
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const parts = buffer.split(/\r?\n/);
      // Keep incomplete line in buffer
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 0) {
          lines.push(trimmed);
          options.onProgress!(lines.length);
        }
      }
    });
  }

  let stdout: string;
  try {
    ({ stdout } = await child);
  } catch (error) {
    const formatted = formatCodexExecError(error);
    if (isExecaError(error)) {
      const errWithOutput = formatted as ErrorWithOutput;
      errWithOutput.stderr = coerceBuffer(error.stderr);
      errWithOutput.stdout = coerceBuffer(error.stdout);
    }
    throw formatted;
  }

  // If we streamed, use collected lines; otherwise parse stdout
  const parsedLines = lines.length > 0
    ? lines
    : stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

  if (parsedLines.length === 0) {
    throw new Error('codex exec returned no JSON output');
  }

  let threadId: string | undefined;
  const messages: ExecMessage[] = [];
  let status: string | undefined;

  for (const line of parsedLines) {
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
    const stderr =
      typeof error.stderr === 'string'
        ? error.stderr
        : Buffer.isBuffer(error.stderr)
          ? error.stderr.toString('utf8')
          : '';
    const stdout =
      typeof error.stdout === 'string'
        ? error.stdout
        : Buffer.isBuffer(error.stdout)
          ? error.stdout.toString('utf8')
          : '';
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

interface ErrorWithOutput extends Error {
  stderr?: string;
  stdout?: string;
}

function coerceBuffer(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return undefined;
}
