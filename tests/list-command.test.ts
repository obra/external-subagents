import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { listCommand } from '../src/commands/list.ts';

const sampleThread = {
  thread_id: 'T-123',
  role: 'researcher',
  policy: 'research-readonly',
  status: 'running',
  updated_at: '2025-11-26T12:00:00Z',
};

async function createStateFixture(): Promise<string> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-'));
  const stateDir = path.join(tmp, '.codex-subagent', 'state');
  await mkdir(stateDir, { recursive: true });
  const threadsFile = path.join(stateDir, 'threads.json');
  await writeFile(
    threadsFile,
    JSON.stringify({ [sampleThread.thread_id]: sampleThread }, null, 2),
    'utf8'
  );
  return tmp;
}

function captureOutput() {
  const output: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output.push(chunk.toString());
      callback();
    },
  });
  return { output, stdout };
}

describe('list command', () => {
  it('prints thread metadata from the registry file', async () => {
    const root = await createStateFixture();
    const { stdout, output } = captureOutput();
    await listCommand({
      rootDir: path.join(root, '.codex-subagent'),
      stdout,
    });

    const text = output.join('');
    expect(text).toContain('Found 1 thread');
    expect(text).toContain('T-123');
    expect(text).toContain('researcher');
    expect(text).toContain('running');
  });

  it('informs the user when no threads exist', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-empty-'));
    const { stdout, output } = captureOutput();
    await listCommand({
      rootDir: path.join(tmp, '.codex-subagent'),
      stdout,
    });

    expect(output.join('')).toContain('No threads found');
  });
});
