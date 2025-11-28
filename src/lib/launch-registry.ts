import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Paths } from './paths.ts';

export type LaunchStatus = 'pending' | 'failed';
export type LaunchType = 'start' | 'send';

export interface LaunchAttempt {
  id: string;
  controller_id: string;
  type: LaunchType;
  status: LaunchStatus;
  label?: string;
  role?: string;
  policy?: string;
  thread_id?: string;
  error_message?: string;
  log_path?: string;
  created_at: string;
  updated_at: string;
}

interface LaunchRecordMap {
  [id: string]: LaunchAttempt;
}

interface CreateAttemptInput {
  controllerId: string;
  type: LaunchType;
  label?: string;
  role?: string;
  policy?: string;
  threadId?: string;
}

interface FailureOptions {
  error: unknown;
  stderr?: string;
}

interface SuccessOptions {
  threadId?: string;
}

export class LaunchRegistry {
  constructor(private readonly paths: Paths) {}

  async listAttempts(): Promise<LaunchAttempt[]> {
    const records = await this.readAll();
    return Object.values(records).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async createAttempt(input: CreateAttemptInput): Promise<LaunchAttempt> {
    await this.paths.ensure();
    const records = await this.readAll();
    const id = `launch-${randomUUID()}`;
    const now = new Date().toISOString();
    const entry: LaunchAttempt = {
      id,
      controller_id: input.controllerId,
      type: input.type,
      status: 'pending',
      label: input.label,
      role: input.role,
      policy: input.policy,
      thread_id: input.threadId,
      created_at: now,
      updated_at: now,
    };
    records[id] = entry;
    await this.writeAll(records);
    return entry;
  }

  async markFailure(id: string, options: FailureOptions): Promise<void> {
    const records = await this.readAll();
    const existing = records[id];
    if (!existing) {
      return;
    }
    const message = formatErrorMessage(options.error);
    const logPath = await this.writeErrorLog(id, message, options);
    records[id] = {
      ...existing,
      status: 'failed',
      error_message: message,
      log_path: logPath,
      updated_at: new Date().toISOString(),
    };
    await this.writeAll(records);
  }

  async markSuccess(id: string, options?: SuccessOptions): Promise<void> {
    const records = await this.readAll();
    const existing = records[id];
    if (!existing) {
      return;
    }
    if (options?.threadId) {
      existing.thread_id = options.threadId;
    }
    delete records[id];
    await this.writeAll(records);
  }

  private async writeErrorLog(
    id: string,
    message: string,
    options: FailureOptions
  ): Promise<string> {
    await mkdir(this.paths.launchErrorsDir, { recursive: true });
    const logPath = this.paths.launchErrorFile(id);
    const lines = [`Timestamp: ${new Date().toISOString()}`, `Message: ${message}`];
    const stderr = options.stderr ?? extractStdErr(options.error);
    if (stderr) {
      lines.push('--- stderr ---', stderr);
    }
    if (options.error instanceof Error && options.error.stack) {
      lines.push('--- stack ---', options.error.stack);
    }
    await writeFile(logPath, `${lines.join('\n')}\n`, 'utf8');
    return logPath;
  }

  private async readAll(): Promise<LaunchRecordMap> {
    try {
      const raw = await readFile(this.paths.launchesFile, 'utf8');
      if (!raw.trim()) {
        return {};
      }
      return JSON.parse(raw) as LaunchRecordMap;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async writeAll(data: LaunchRecordMap): Promise<void> {
    await mkdir(path.dirname(this.paths.launchesFile), { recursive: true });
    await writeFile(this.paths.launchesFile, JSON.stringify(data, null, 2), 'utf8');
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}

function extractStdErr(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'stderr' in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && stderr.trim()) {
      return stderr;
    }
  }
  return undefined;
}
