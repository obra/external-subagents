import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, releaseLock } from '../src/lib/file-lock.ts';

describe('FileLock', () => {
  it('acquires and releases a lock on a file', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lock-test-'));
    const lockPath = path.join(tempDir, 'test.lock');

    const lock = await acquireLock(lockPath);
    expect(lock).toBeDefined();
    expect(lock.acquired).toBe(true);

    await releaseLock(lock);
    await rm(tempDir, { recursive: true });
  });

  it('blocks concurrent lock attempts', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lock-test-'));
    const lockPath = path.join(tempDir, 'test.lock');

    const lock1 = await acquireLock(lockPath);

    // Second lock should timeout
    await expect(acquireLock(lockPath, 100)).rejects.toThrow('Failed to acquire lock');

    await releaseLock(lock1);

    // Now should succeed
    const lock2 = await acquireLock(lockPath);
    expect(lock2.acquired).toBe(true);
    await releaseLock(lock2);

    await rm(tempDir, { recursive: true });
  });
});
