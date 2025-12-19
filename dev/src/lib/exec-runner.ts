import path from 'node:path';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { access, copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execa } from 'execa';
import type { ExecaError } from 'execa';
import { type Backend, type PermissionLevel, getBackend } from './backends.ts';

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
  transformPrompt?: (body: string) => string;
  onProgress?: (lineCount: number) => void;
  /** Backend to use: 'codex' (default) or 'claude' */
  backend?: 'codex' | 'claude';
  /** Permission level: 'read-only' or 'workspace-write' */
  permissions?: PermissionLevel;
  /** Codex-only: custom profile name (overrides permissions) */
  profile?: string;
  /** Model to use (e.g., 'sonnet', 'opus', 'haiku') */
  model?: string;
}

export async function runExec(options: ExecOptions): Promise<ExecResult> {
  const backend = getBackend(options.backend ?? 'codex');
  const args = backend.buildArgs({
    outputLastPath: options.outputLastPath,
    permissions: options.permissions,
    profile: options.profile,
    extraArgs: options.extraArgs,
    model: options.model,
  });

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

  const env = await buildBackendEnv(backend.name);

  // Stream stdout to count lines for progress reporting
  const lines: string[] = [];
  const child = env
    ? execa(backend.command, args, { input: promptBody, env })
    : execa(backend.command, args, { input: promptBody });

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
    const formatted = formatExecError(error, backend);
    if (isExecaError(error)) {
      const errWithOutput = formatted as ErrorWithOutput;
      errWithOutput.stderr = coerceBuffer(error.stderr);
      errWithOutput.stdout = coerceBuffer(error.stdout);
    }
    throw formatted;
  }

  // If we streamed, use collected lines; otherwise parse stdout
  const parsedLines =
    lines.length > 0
      ? lines
      : stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

  if (parsedLines.length === 0) {
    throw new Error(`${backend.name} returned no JSON output`);
  }

  let sessionId: string | undefined;
  const messages: ExecMessage[] = [];
  let status: string | undefined;

  for (const line of parsedLines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Failed to parse ${backend.name} JSON line: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!isRecord(event)) {
      continue;
    }

    const parsed = backend.parseEvent(event);

    if (parsed.kind === 'session_started' && parsed.sessionId) {
      sessionId = parsed.sessionId;
    }

    if (parsed.kind === 'assistant_message' && parsed.message) {
      const rawPayload = JSON.stringify(parsed.message.raw);
      const fingerprint = createHash('sha256').update(rawPayload).digest('hex');
      messages.push({
        id: fingerprint,
        role: 'assistant',
        text: parsed.message.text,
        raw: parsed.message.raw,
        raw_id: parsed.message.rawId,
      });
    }

    if (parsed.kind === 'completed') {
      status = 'completed';
    }
  }

  if (!sessionId) {
    throw new Error(`${backend.name} output missing session start event`);
  }

  return {
    thread_id: sessionId,
    status,
    messages,
    last_message_id: messages.at(-1)?.id,
  };
}

let cachedCodexHomeOverride: string | null | undefined;

async function buildBackendEnv(backendName: string): Promise<NodeJS.ProcessEnv | undefined> {
  if (backendName !== 'codex') {
    return undefined;
  }

  const codexHomeOverride = await resolveCodexHomeOverride();
  if (!codexHomeOverride) {
    return undefined;
  }

  return { ...process.env, CODEX_HOME: codexHomeOverride };
}

async function resolveCodexHomeOverride(): Promise<string | undefined> {
  const explicit = process.env.CODEX_HOME;
  if (explicit && explicit.trim().length > 0) {
    return undefined;
  }

  if (cachedCodexHomeOverride !== undefined) {
    return cachedCodexHomeOverride ?? undefined;
  }

  const defaultCodexHome = path.join(os.homedir(), '.codex');
  const writable = await isDirectoryWritable(defaultCodexHome);
  if (writable) {
    cachedCodexHomeOverride = null;
    return undefined;
  }

  const localCodexHome = path.resolve(process.cwd(), '.codex-home');
  await mkdir(localCodexHome, { recursive: true });
  await copyCodexAuthFiles(defaultCodexHome, localCodexHome);

  cachedCodexHomeOverride = localCodexHome;
  return localCodexHome;
}

async function copyCodexAuthFiles(fromCodexHome: string, toCodexHome: string): Promise<void> {
  for (const filename of ['auth.json', 'config.toml']) {
    const src = path.join(fromCodexHome, filename);
    const dest = path.join(toCodexHome, filename);
    const destExists = await fileExists(dest);
    if (destExists) {
      continue;
    }
    const srcExists = await fileExists(src);
    if (!srcExists) {
      continue;
    }
    try {
      await copyFile(src, dest);
    } catch {
      // Best-effort: if home reads are blocked, codex will report auth errors.
    }
  }
}

async function isDirectoryWritable(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
    const probePath = path.join(dir, '.codex-subagent-write-probe');
    try {
      await writeFile(probePath, 'probe', { encoding: 'utf8' });
    } finally {
      try {
        await unlink(probePath);
      } catch {
        // ignore cleanup errors
      }
    }
    return true;
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return false;
    }
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'EACCES' || code === 'EPERM';
}

function formatExecError(error: unknown, backend: Backend): Error {
  const baseMessage = error instanceof Error ? error.message : String(error);

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
    return new Error(backend.formatError(baseMessage, stderr, stdout));
  }

  return new Error(backend.formatError(baseMessage, '', ''));
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
