import { open, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { FileHandle } from 'node:fs/promises';

export interface FileLock {
  acquired: boolean;
  handle: FileHandle;
  path: string;
}

export async function acquireLock(lockPath: string, timeoutMs = 5000): Promise<FileLock> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const handle = await open(lockPath, 'wx');
      return { acquired: true, handle, path: lockPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to acquire lock on ${lockPath} within ${timeoutMs}ms`);
}

export async function releaseLock(lock: FileLock): Promise<void> {
  await lock.handle.close();
  try {
    await unlink(lock.path);
  } catch {
    // Ignore if already deleted
  }
}
