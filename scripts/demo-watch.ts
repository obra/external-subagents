#!/usr/bin/env tsx
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

interface ThreadEntry {
  thread_id: string;
  updated_at?: string;
}

async function readLatestThread(stateFile: string): Promise<string> {
  const raw = await readFile(stateFile, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, ThreadEntry>;
  const entries = Object.values(parsed);
  if (entries.length === 0) {
    throw new Error('No threads found in registry');
  }
  const latest = entries.sort((a, b) => {
    const left = a.updated_at ?? '';
    const right = b.updated_at ?? '';
    return right.localeCompare(left);
  })[0];
  return latest.thread_id;
}

async function main() {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const distBin = path.join(repoRoot, 'dist', 'codex-subagent.js');
  const promptFile = path.join(repoRoot, 'scripts', 'demo-watch-prompt.txt');
  const stateFile = path.join(repoRoot, '.codex-subagent', 'state', 'threads.json');

  console.log('Starting demo thread...');
  await execa(
    'node',
    [
      distBin,
      'start',
      '--role',
      'researcher',
      '--policy',
      'workspace-write',
      '--prompt-file',
      promptFile,
    ],
    {
      stdio: 'inherit',
    }
  );

  const latestThread = await readLatestThread(stateFile);
  console.log(`\nWatching thread ${latestThread}... (Ctrl+C to stop)`);
  await execa('node', [distBin, 'watch', '--thread', latestThread], {
    stdio: 'inherit',
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
