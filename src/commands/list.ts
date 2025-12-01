import process from 'node:process';
import { Writable } from 'node:stream';
import { Registry } from '../lib/registry.ts';
import type { ThreadMetadata } from '../lib/registry.ts';
import { assertThreadOwnership } from '../lib/thread-ownership.ts';
import { Paths } from '../lib/paths.ts';
import { formatRelativeTime } from '../lib/time.ts';
import { LaunchRegistry, LaunchAttempt } from '../lib/launch-registry.ts';

export interface ListCommandOptions {
  rootDir?: string;
  stdout?: Writable;
  controllerId: string;
  now?: () => number;
}

const PENDING_WARNING_MS = 2 * 60 * 1000;

function formatThreadLine(thread: ThreadMetadata, nowMs: number): string {
  const idSegment = thread.label ? `${thread.thread_id} (${thread.label})` : thread.thread_id;
  const status = formatStatusLabel(thread.status);
  const parts = [idSegment, status, thread.role ?? 'unknown-role'];
  if (thread.policy) {
    parts.push(thread.policy);
  }
  parts.push(`updated ${formatRelativeTime(thread.updated_at, nowMs)}`);
  const lines = [`- ${parts.join(' · ')}`];
  if (thread.error_message) {
    lines.push(`  Error: ${thread.error_message}`);
  }
  return lines.join('\n');
}

function formatStatusLabel(rawStatus?: string): string {
  if (!rawStatus) {
    return 'stopped';
  }
  const normalized = rawStatus.toLowerCase();
  if (normalized === 'running') {
    return 'running';
  }
  if (normalized === 'failed' || normalized === 'not_running') {
    return 'NOT RUNNING';
  }
  return 'stopped';
}

function formatLaunchDiagnostics(attempts: LaunchAttempt[], nowMs: number): string[] {
  if (attempts.length === 0) {
    return [];
  }
  return ['Launch diagnostics:', ...attempts.map((attempt) => formatLaunchAttempt(attempt, nowMs))];
}

function formatLaunchAttempt(attempt: LaunchAttempt, nowMs: number): string {
  const idSegment = attempt.label ? `${attempt.id} (${attempt.label})` : attempt.id;
  const status = attempt.status === 'failed' ? 'NOT RUNNING' : 'pending';
  const parts = [
    idSegment,
    status,
    attempt.type,
    `launched ${formatRelativeTime(attempt.created_at, nowMs)}`,
  ];
  const lines = [`- ${parts.join(' · ')}`];

  if (attempt.status === 'failed' && attempt.error_message) {
    lines.push(`  Error: ${attempt.error_message}`);
    if (attempt.log_path) {
      lines.push(`  See ${attempt.log_path} for details.`);
    }
  }

  if (attempt.status === 'pending' && isPendingWarning(attempt, nowMs)) {
    lines.push('  Warning: still waiting for Codex (no thread yet).');
  }

  return lines.join('\n');
}

function isPendingWarning(attempt: LaunchAttempt, nowMs: number): boolean {
  if (!attempt.created_at) {
    return false;
  }
  const created = Date.parse(attempt.created_at);
  if (Number.isNaN(created)) {
    return false;
  }
  return nowMs - created >= PENDING_WARNING_MS;
}

export async function listCommand(options: ListCommandOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const nowMs = options.now ? options.now() : Date.now();
  const paths = new Paths(options.rootDir);
  const registry = new Registry(paths);
  const normalized = await Promise.all(
    (await registry.listThreads()).map(async (thread) => {
      try {
        return await assertThreadOwnership(thread, options.controllerId, registry);
      } catch {
        return null;
      }
    })
  );
  const threads = normalized.filter((thread): thread is ThreadMetadata => Boolean(thread));

  if (threads.length === 0) {
    stdout.write('No threads found.\n');
  } else {
    const header = `Found ${threads.length} thread${threads.length === 1 ? '' : 's'} in ${paths.root}`;
    const sorted = threads.sort((a, b) => {
      const aRunning = a.status === 'running' ? 0 : 1;
      const bRunning = b.status === 'running' ? 0 : 1;
      if (aRunning !== bRunning) {
        return aRunning - bRunning;
      }
      const aTime = Date.parse(a.updated_at ?? '') || 0;
      const bTime = Date.parse(b.updated_at ?? '') || 0;
      return bTime - aTime;
    });
    const lines = sorted.map((thread) => formatThreadLine(thread, nowMs));
    stdout.write(`${header}\n${lines.join('\n')}\n`);
  }

  const launchRegistry = new LaunchRegistry(paths);
  const STALE_LAUNCH_MS = 60 * 60 * 1000; // 1 hour
  await launchRegistry.cleanupStale(STALE_LAUNCH_MS, nowMs);
  const launchAttempts = (await launchRegistry.listAttempts()).filter(
    (attempt) => attempt.controller_id === options.controllerId
  );
  const diagnostics = formatLaunchDiagnostics(launchAttempts, nowMs);
  if (diagnostics.length > 0) {
    stdout.write(`${diagnostics.join('\n')}\n`);
  }
}
