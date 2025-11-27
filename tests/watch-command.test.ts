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
});
