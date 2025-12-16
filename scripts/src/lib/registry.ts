import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Paths } from './paths.ts';
import { acquireLock, releaseLock } from './file-lock.ts';

export class RegistryLoadError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RegistryLoadError';
    this.cause = cause;
  }
}

export interface ThreadMetadata {
  thread_id: string;
  role?: string;
  /** Permission level: 'read-only' or 'workspace-write' */
  permissions?: string;
  status?: string;
  last_message_id?: string;
  last_pulled_id?: string;
  updated_at?: string;
  controller_id?: string;
  label?: string;
  persona?: string;
  error_message?: string;
  launch_id?: string;
  /** Backend used: 'codex' or 'claude' */
  backend?: string;
}

type ThreadMap = Record<string, ThreadMetadata>;

export class Registry {
  constructor(private readonly paths: Paths) {}

  async listThreads(): Promise<ThreadMetadata[]> {
    const threads = await this.readAll();
    return Object.values(threads).sort((a, b) => {
      const left = a.updated_at ?? '';
      const right = b.updated_at ?? '';
      if (left === right) {
        return a.thread_id.localeCompare(b.thread_id);
      }
      return right.localeCompare(left);
    });
  }

  async get(threadId: string): Promise<ThreadMetadata | undefined> {
    const data = await this.readAll();
    return data[threadId];
  }

  async upsert(thread: ThreadMetadata): Promise<ThreadMetadata> {
    const threadId = thread.thread_id?.trim();
    if (!threadId) {
      throw new Error('thread_id is required');
    }

    return this.withLock(async () => {
      const data = await this.readAll();
      const entry: ThreadMetadata = {
        ...data[threadId],
        ...thread,
        thread_id: threadId,
        updated_at: thread.updated_at ?? new Date().toISOString(),
      };
      if (!entry.controller_id && thread.controller_id) {
        entry.controller_id = thread.controller_id;
      }
      data[threadId] = entry;
      await this.writeAllUnlocked(data);
      return entry;
    });
  }

  async updateThread(
    threadId: string,
    updates: Partial<Omit<ThreadMetadata, 'thread_id'>>
  ): Promise<ThreadMetadata> {
    const trimmed = threadId?.trim();
    if (!trimmed) {
      throw new Error('thread_id is required');
    }

    return this.withLock(async () => {
      const data = await this.readAll();
      const existing = data[trimmed];
      if (!existing) {
        throw new Error(`Thread ${threadId} not found in registry`);
      }

      const entry: ThreadMetadata = {
        ...existing,
        ...updates,
        thread_id: trimmed,
        updated_at: updates.updated_at ?? new Date().toISOString(),
      };

      data[trimmed] = entry;
      await this.writeAllUnlocked(data);
      return entry;
    });
  }

  async remove(threadId: string): Promise<void> {
    const trimmed = threadId?.trim();
    if (!trimmed) {
      throw new Error('thread_id is required');
    }

    await this.withLock(async () => {
      const data = await this.readAll();
      if (!data[trimmed]) {
        return;
      }
      delete data[trimmed];
      await this.writeAllUnlocked(data);
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.paths.threadsFile}.lock`;
    const lock = await acquireLock(lockPath);
    try {
      return await operation();
    } finally {
      await releaseLock(lock);
    }
  }

  private async readAll(): Promise<ThreadMap> {
    let contents: string;
    try {
      contents = await readFile(this.paths.threadsFile, 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw new RegistryLoadError(`Failed to read registry from ${this.paths.threadsFile}`, error);
    }

    if (!contents.trim()) {
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch (error: unknown) {
      throw new RegistryLoadError('Registry JSON is malformed', error);
    }

    if (Array.isArray(parsed)) {
      return parsed.reduce<ThreadMap>((acc, thread) => {
        if (thread?.thread_id) {
          acc[thread.thread_id] = thread;
        }
        return acc;
      }, {});
    }

    if (parsed && typeof parsed === 'object') {
      return parsed as ThreadMap;
    }

    throw new RegistryLoadError('Registry file must contain an object map');
  }

  private async writeAllUnlocked(data: ThreadMap): Promise<void> {
    await mkdir(path.dirname(this.paths.threadsFile), { recursive: true });
    const payload = JSON.stringify(data, null, 2);
    const tempFile = `${this.paths.threadsFile}.${randomUUID()}.tmp`;
    await writeFile(tempFile, payload, 'utf8');
    await rename(tempFile, this.paths.threadsFile);
  }
}
