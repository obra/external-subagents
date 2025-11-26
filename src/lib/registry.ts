import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Paths } from './paths.ts';

export interface ThreadMetadata {
  thread_id: string;
  role?: string;
  policy?: string;
  status?: string;
  last_message_id?: string;
  updated_at?: string;
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
    const data = await this.readAll();
    const entry: ThreadMetadata = {
      ...data[thread.thread_id],
      ...thread,
      updated_at: thread.updated_at ?? new Date().toISOString(),
    };
    data[thread.thread_id] = entry;
    await this.writeAll(data);
    return entry;
  }

  private async readAll(): Promise<ThreadMap> {
    try {
      const contents = await readFile(this.paths.threadsFile, 'utf8');
      if (!contents.trim()) {
        return {};
      }
      const parsed = JSON.parse(contents);
      if (Array.isArray(parsed)) {
        return parsed.reduce<ThreadMap>((acc, thread) => {
          acc[thread.thread_id] = thread;
          return acc;
        }, {});
      }
      return parsed as ThreadMap;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async writeAll(data: ThreadMap): Promise<void> {
    await mkdir(path.dirname(this.paths.threadsFile), { recursive: true });
    const payload = JSON.stringify(data, null, 2);
    const tempFile = `${this.paths.threadsFile}.${randomUUID()}.tmp`;
    await writeFile(tempFile, payload, 'utf8');
    await rename(tempFile, this.paths.threadsFile);
  }
}
