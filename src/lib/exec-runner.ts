import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execa } from 'execa';

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
    const prefix = 'codex exec failed';
    if (error instanceof Error) {
      error.message = `${prefix}: ${error.message}`;
    }
    throw error;
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
      throw new Error(`Failed to parse codex exec JSON line: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!isRecord(event)) {
      continue;
    }

    const eventType = typeof event.type === 'string' ? event.type : undefined;

    if (eventType === 'thread.started' && typeof event.thread_id === 'string') {
      threadId = event.thread_id;
    }

    if (eventType === 'item.completed' && isRecord(event.item) && event.item.type === 'agent_message') {
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
