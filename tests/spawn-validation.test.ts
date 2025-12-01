import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { validateSpawnedWorker } from '../src/lib/spawn-validation.ts';

describe('Spawn Validation', () => {
  it('detects when spawned process exits immediately with error', async () => {
    const mockProcess = new EventEmitter() as EventEmitter & { pid: number };
    mockProcess.pid = 12345;

    // Simulate immediate exit after small delay
    setTimeout(() => {
      mockProcess.emit('exit', 1);
    }, 10);

    const result = await validateSpawnedWorker(mockProcess as any, 200);
    expect(result.healthy).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('reports healthy when process survives grace period', async () => {
    const mockProcess = new EventEmitter() as EventEmitter & { pid: number };
    mockProcess.pid = 12345;

    // Don't emit exit - process survives
    const result = await validateSpawnedWorker(mockProcess as any, 50);
    expect(result.healthy).toBe(true);
  });

  it('detects spawn errors', async () => {
    const mockProcess = new EventEmitter() as EventEmitter & { pid: number };
    mockProcess.pid = 12345;

    setTimeout(() => {
      mockProcess.emit('error', new Error('spawn ENOENT'));
    }, 10);

    const result = await validateSpawnedWorker(mockProcess as any, 200);
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('ENOENT');
  });
});
