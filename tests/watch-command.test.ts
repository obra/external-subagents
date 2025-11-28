import { describe, expect, it, vi, beforeEach } from 'vitest';
import { captureOutput } from './helpers/io.ts';

vi.mock('../src/commands/peek.ts', () => ({
  peekCommand: vi.fn(),
}));

import { peekCommand } from '../src/commands/peek.ts';
import { watchCommand } from '../src/commands/watch.ts';

describe('watch command', () => {
  beforeEach(() => {
    vi.mocked(peekCommand).mockReset();
    vi.mocked(peekCommand).mockResolvedValue(undefined);
  });
  it('invokes peek repeatedly and stops after the specified iterations', async () => {
    const { stdout } = captureOutput();
    const sleep = vi.fn().mockResolvedValue(true);

    await watchCommand({
      threadId: 'thread-123',
      stdout,
      iterations: 2,
      sleep,
      controllerId: 'controller-one',
    });

    expect(vi.mocked(peekCommand)).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('responds to abort signals and stops looping', async () => {
    const { stdout } = captureOutput();
    const controller = new AbortController();
    let resume: (() => void) | undefined;
    const sleep = vi.fn((_ms: number, signal?: AbortSignal) => {
      return new Promise<boolean>((resolve) => {
        resume = () => resolve(!signal?.aborted);
      });
    });
    const firstCall = new Promise<void>((resolve) => {
      vi.mocked(peekCommand).mockImplementationOnce(async () => {
        resolve();
      });
    });

    const watchPromise = watchCommand({
      threadId: 'thread-123',
      stdout,
      signal: controller.signal,
      sleep,
      controllerId: 'controller-one',
    });

    await firstCall;
    controller.abort();
    resume?.();
    await watchPromise;

    expect(vi.mocked(peekCommand)).toHaveBeenCalledTimes(1);
  });

  it('exits cleanly when duration elapses without updates', async () => {
    const { stdout, output } = captureOutput();
    const sleep = vi.fn();
    const nowMock = vi.fn();
    nowMock.mockReturnValueOnce(0); // start timestamp
    nowMock.mockReturnValueOnce(1_100); // after first peek
    nowMock.mockReturnValue(1_100);

    await watchCommand({
      threadId: 'thread-123',
      stdout,
      durationMs: 1_000,
      now: nowMock,
      sleep,
      controllerId: 'controller-one',
      iterations: Number.POSITIVE_INFINITY,
    });

    expect(vi.mocked(peekCommand)).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(output.join('')).toContain('after 1s; exiting');
    expect(output.join('')).toContain('Stopped watching thread thread-123');
  });

  it('throws on non-positive duration values', async () => {
    await expect(
      watchCommand({
        threadId: 'thread-123',
        durationMs: 0,
        controllerId: 'controller-one',
      })
    ).rejects.toThrow('--duration-ms must be greater than 0');
  });
});
