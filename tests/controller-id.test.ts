import { describe, expect, it, beforeEach } from 'vitest';
import { getControllerId, resetControllerIdCache } from '../src/lib/controller-id.ts';

describe('controller id detection', () => {
  beforeEach(() => {
    resetControllerIdCache();
  });

  it('returns override when provided', () => {
    const id = getControllerId({ override: 'manual-id' });
    expect(id).toBe('manual-id');
  });

  it('walks up the process tree to find codex command', () => {
    const processes = new Map([
      [100, { pid: 100, ppid: 50, command: 'node dist/codex-subagent.js' }],
      [50, { pid: 50, ppid: 1, command: 'codex -m gpt-5.1-codex' }],
      [1, { pid: 1, ppid: 0, command: 'launchd' }],
    ]);

    const id = getControllerId({
      psReader: (pid) => processes.get(pid),
      startPid: 100,
    });

    expect(id).toBe('50');
  });

  it('falls back to current pid when codex process not found', () => {
    const id = getControllerId({ psReader: () => undefined });
    expect(id).toBe(String(process.pid));
  });

  it('throws error if process tree walk exceeds max iterations', () => {
    resetControllerIdCache();

    let callCount = 0;
    const cyclicPsReader = (pid: number) => {
      callCount++;
      // Return a valid process that always points to a different parent
      // This creates an infinitely deep tree
      return { pid, ppid: pid + 1, command: 'some-process' };
    };

    expect(() =>
      getControllerId({ psReader: cyclicPsReader, startPid: 1 })
    ).toThrow('exceeded maximum');

    // Should have stopped well before 1000 iterations
    expect(callCount).toBeLessThan(200);
  });
});
