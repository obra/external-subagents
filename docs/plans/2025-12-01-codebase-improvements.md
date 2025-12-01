# Codex Subagents Codebase Improvements

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Address all design flaws, security issues, and CLI API improvements identified by code analysis.

**Architecture:** Fix critical infrastructure issues first (file locking, spawn validation, security), then address CLI usability improvements (flag renaming, redundancy removal, new features).

**Tech Stack:** TypeScript, Node.js 20+, vitest for testing, execa for process management.

---

## Phase 1: Critical Infrastructure Fixes

### Task 1: Add File Locking to Registry

**Files:**
- Create: `src/lib/file-lock.ts`
- Modify: `src/lib/registry.ts:150-156`
- Create: `tests/file-lock.test.ts`
- Modify: `tests/registry.test.ts`

**Step 1: Write the failing test for file lock acquisition**

```typescript
// tests/file-lock.test.ts
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
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/file-lock.test.ts`
Expected: FAIL with "Cannot find module '../src/lib/file-lock.ts'"

**Step 3: Write minimal file-lock implementation**

```typescript
// src/lib/file-lock.ts
import { open, mkdir } from 'node:fs/promises';
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
  const { unlink } = await import('node:fs/promises');
  try {
    await unlink(lock.path);
  } catch {
    // Ignore if already deleted
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/file-lock.test.ts`
Expected: PASS

**Step 5: Write test for concurrent lock contention**

```typescript
// Add to tests/file-lock.test.ts
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
```

**Step 6: Run test to verify it passes**

Run: `npx vitest run tests/file-lock.test.ts`
Expected: PASS (implementation already handles this)

**Step 7: Write test for registry with locking**

```typescript
// Add to tests/registry.test.ts
it('handles concurrent upserts without data loss', async () => {
  const paths = await createPaths();
  await paths.ensure();
  const registry = new Registry(paths);

  // Launch concurrent upserts
  const promises = Array.from({ length: 10 }, (_, i) =>
    registry.upsert({
      thread_id: `thread-${i}`,
      role: 'worker',
      status: 'running',
    })
  );

  await Promise.all(promises);

  const threads = await registry.listThreads();
  expect(threads.length).toBe(10);
});
```

**Step 8: Run test to verify current behavior (may pass or fail inconsistently)**

Run: `npx vitest run tests/registry.test.ts`

**Step 9: Modify registry to use file locking**

```typescript
// src/lib/registry.ts - modify writeAll method
import { acquireLock, releaseLock } from './file-lock.ts';

// Add to class:
private async writeAll(data: ThreadMap): Promise<void> {
  await mkdir(path.dirname(this.paths.threadsFile), { recursive: true });
  const lockPath = `${this.paths.threadsFile}.lock`;
  const lock = await acquireLock(lockPath);
  try {
    const payload = JSON.stringify(data, null, 2);
    const tempFile = `${this.paths.threadsFile}.${randomUUID()}.tmp`;
    await writeFile(tempFile, payload, 'utf8');
    await rename(tempFile, this.paths.threadsFile);
  } finally {
    await releaseLock(lock);
  }
}
```

**Step 10: Run all registry tests**

Run: `npx vitest run tests/registry.test.ts`
Expected: PASS

**Step 11: Commit**

```bash
git add src/lib/file-lock.ts tests/file-lock.test.ts src/lib/registry.ts tests/registry.test.ts
git commit -m "$(cat <<'EOF'
feat: add file locking to registry to prevent concurrent write races

Concurrent registry writes (e.g., during manifest launches) could clobber
each other. This adds a simple file-based lock to serialize writes.
EOF
)"
```

---

### Task 2: Add Spawn Validation for Detached Workers

**Files:**
- Modify: `src/commands/start.ts:368-390`
- Modify: `src/lib/launch-registry.ts`
- Create: `tests/spawn-validation.test.ts`

**Step 1: Write failing test for spawn validation**

```typescript
// tests/spawn-validation.test.ts
import { describe, expect, it, vi } from 'vitest';
import { validateSpawnedWorker } from '../src/lib/spawn-validation.ts';

describe('Spawn Validation', () => {
  it('detects when spawned process exits immediately with error', async () => {
    const mockProcess = {
      pid: 12345,
      exitCode: null,
      killed: false,
    };

    // Simulate immediate exit
    setTimeout(() => {
      mockProcess.exitCode = 1;
    }, 10);

    const result = await validateSpawnedWorker(mockProcess as any, 100);
    expect(result.healthy).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/spawn-validation.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal spawn validation implementation**

```typescript
// src/lib/spawn-validation.ts
import type { ChildProcess } from 'node:child_process';

export interface SpawnValidationResult {
  healthy: boolean;
  exitCode?: number | null;
  error?: string;
}

export async function validateSpawnedWorker(
  child: ChildProcess,
  graceMs = 500
): Promise<SpawnValidationResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      // Process survived grace period - consider it healthy
      resolve({ healthy: true });
    }, graceMs);

    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve({
        healthy: false,
        exitCode: code,
        error: `Worker exited immediately with code ${code}`,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        healthy: false,
        error: err.message,
      });
    });
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/spawn-validation.test.ts`
Expected: PASS

**Step 5: Write test for healthy spawn**

```typescript
// Add to tests/spawn-validation.test.ts
it('reports healthy when process survives grace period', async () => {
  const mockProcess = {
    pid: 12345,
    exitCode: null,
    killed: false,
    on: vi.fn(),
  };

  const result = await validateSpawnedWorker(mockProcess as any, 50);
  expect(result.healthy).toBe(true);
});
```

**Step 6: Run test**

Run: `npx vitest run tests/spawn-validation.test.ts`
Expected: PASS

**Step 7: Modify start command to use spawn validation**

In `src/commands/start.ts`, after spawning the detached worker, add validation:

```typescript
// After: child.unref();
// Add:
import { validateSpawnedWorker } from '../lib/spawn-validation.ts';

const validation = await validateSpawnedWorker(child, 500);
if (!validation.healthy) {
  await launchRegistry.markFailure(launchId, {
    error: new Error(validation.error ?? 'Worker failed to start'),
  });
  throw new Error(`Detached worker failed to start: ${validation.error}`);
}
```

**Step 8: Run existing start tests**

Run: `npx vitest run tests/start-command.test.ts`
Expected: PASS (or update mocks as needed)

**Step 9: Commit**

```bash
git add src/lib/spawn-validation.ts tests/spawn-validation.test.ts src/commands/start.ts
git commit -m "$(cat <<'EOF'
feat: validate detached workers survive initial spawn

Detached workers that crash immediately were invisible to the user.
Now we wait a short grace period to detect immediate spawn failures.
EOF
)"
```

---

### Task 3: Fix Thread Ownership Auto-Claim Security Issue

**Files:**
- Modify: `src/lib/thread-ownership.ts`
- Modify: `tests/controller-id.test.ts` (or create new test file)

**Step 1: Write failing test for ownership claim behavior**

```typescript
// tests/thread-ownership.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Paths } from '../src/lib/paths.ts';
import { Registry } from '../src/lib/registry.ts';
import { assertThreadOwnership } from '../src/lib/thread-ownership.ts';

describe('Thread Ownership', () => {
  it('throws when thread has no controller_id instead of auto-claiming', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ownership-test-'));
    const paths = new Paths(path.join(tempDir, '.codex-subagent'));
    await paths.ensure();
    const registry = new Registry(paths);

    // Create thread with no controller
    await registry.upsert({
      thread_id: 'orphan-thread',
      role: 'worker',
      status: 'completed',
    });

    const thread = await registry.get('orphan-thread');

    // Should throw, not auto-claim
    await expect(
      assertThreadOwnership(thread, 'new-controller', registry)
    ).rejects.toThrow('has no controller');

    await rm(tempDir, { recursive: true });
  });
});
```

**Step 2: Run test to verify it fails (current behavior auto-claims)**

Run: `npx vitest run tests/thread-ownership.test.ts`
Expected: FAIL (current code auto-claims instead of throwing)

**Step 3: Fix thread ownership to reject unclaimed threads**

```typescript
// src/lib/thread-ownership.ts
import { Registry, ThreadMetadata } from './registry.ts';

export async function assertThreadOwnership(
  thread: ThreadMetadata | undefined,
  controllerId: string,
  registry: Registry
): Promise<ThreadMetadata> {
  if (!thread) {
    throw new Error('Thread not found');
  }

  if (thread.controller_id && thread.controller_id !== controllerId) {
    throw new Error(`Thread ${thread.thread_id} belongs to a different controller`);
  }

  if (!thread.controller_id) {
    throw new Error(
      `Thread ${thread.thread_id} has no controller_id. ` +
      `Use 'label --thread ${thread.thread_id} --claim' to explicitly claim ownership.`
    );
  }

  return thread;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thread-ownership.test.ts`
Expected: PASS

**Step 5: Update existing tests that relied on auto-claim behavior**

Search for tests that create threads without controller_id and expect ownership assertion to pass. Update them to include controller_id in the upsert.

**Step 6: Run all tests**

Run: `npx vitest run`
Expected: PASS (after updating tests)

**Step 7: Commit**

```bash
git add src/lib/thread-ownership.ts tests/thread-ownership.test.ts
git commit -m "$(cat <<'EOF'
fix: reject threads without controller_id instead of auto-claiming

Auto-claiming orphan threads was a security risk. Now threads must have
a controller_id set at creation time, or be explicitly claimed.
EOF
)"
```

---

### Task 4: Add Max Iteration Limit to Process Tree Walk

**Files:**
- Modify: `src/lib/controller-id.ts:40-63`
- Modify: `tests/controller-id.test.ts`

**Step 1: Write failing test for iteration limit**

```typescript
// Add to tests/controller-id.test.ts
it('throws error if process tree walk exceeds max iterations', () => {
  let callCount = 0;
  const cyclicPsReader = (pid: number): ProcInfo | undefined => {
    callCount++;
    // Return a valid process that always points to a different parent
    return { pid, ppid: pid + 1, command: 'some-process' };
  };

  expect(() =>
    getControllerId({ psReader: cyclicPsReader, startPid: 1 })
  ).toThrow('exceeded maximum');

  // Should have stopped well before 1000 iterations
  expect(callCount).toBeLessThan(200);
});
```

**Step 2: Run test to verify it fails (hangs or takes too long)**

Run: `npx vitest run tests/controller-id.test.ts --timeout 5000`
Expected: FAIL (timeout or no error thrown)

**Step 3: Add iteration limit**

```typescript
// src/lib/controller-id.ts - modify findControllerPid
const MAX_TREE_DEPTH = 100;

function findControllerPid(
  psReader: (pid: number) => ProcInfo | undefined,
  startPid: number
): string {
  const visited = new Set<number>();
  let currentPid = startPid;
  let iterations = 0;

  while (!visited.has(currentPid)) {
    if (iterations++ > MAX_TREE_DEPTH) {
      throw new Error(
        `Process tree walk exceeded maximum depth (${MAX_TREE_DEPTH}). ` +
        `Possible cycle or unusually deep process hierarchy.`
      );
    }

    visited.add(currentPid);
    const info = psReader(currentPid);
    if (!info) {
      break;
    }
    if (/^codex\b/.test(info.command)) {
      return String(info.pid);
    }
    if (info.ppid === 0) {
      break;
    }
    currentPid = info.ppid;
  }

  return String(process.pid);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/controller-id.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/controller-id.ts tests/controller-id.test.ts
git commit -m "$(cat <<'EOF'
fix: add max iteration limit to process tree walk

Prevents potential infinite loop if process tree has unexpected cycles
or psReader returns inconsistent data.
EOF
)"
```

---

## Phase 2: High Priority Bug Fixes

### Task 5: Validate Thread Status Before Send

**Files:**
- Modify: `src/lib/send-thread.ts:43-98`
- Modify: `tests/send-command.test.ts`

**Step 1: Write failing test**

```typescript
// Add to tests/send-command.test.ts
it('rejects send to a thread that is still running', async () => {
  // Setup: create a running thread
  await registry.upsert({
    thread_id: 'running-thread',
    role: 'worker',
    policy: 'workspace-write',
    status: 'running',
    controller_id: 'test-controller',
  });

  await expect(
    runSendThreadWorkflow({
      rootDir: paths.root,
      threadId: 'running-thread',
      promptBody: 'test prompt',
      controllerId: 'test-controller',
    })
  ).rejects.toThrow('still running');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/send-command.test.ts`
Expected: FAIL (current code doesn't check status)

**Step 3: Add status validation**

```typescript
// src/lib/send-thread.ts - add after assertThreadOwnership
const RESUMABLE_STATUSES = ['completed', 'failed', 'stopped', 'waiting'];

function assertThreadResumable(thread: ThreadMetadata): void {
  const status = thread.status?.toLowerCase() ?? 'unknown';
  if (!RESUMABLE_STATUSES.includes(status)) {
    throw new Error(
      `Thread ${thread.thread_id} is ${status}. ` +
      `Can only resume threads with status: ${RESUMABLE_STATUSES.join(', ')}`
    );
  }
}

// In runSendThreadWorkflow, after ensureThreadMetadata:
assertThreadResumable(ownedThread);
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/send-command.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/send-thread.ts tests/send-command.test.ts
git commit -m "$(cat <<'EOF'
fix: validate thread status before allowing send/resume

Prevents accidentally resuming a thread that is still running,
which could cause log corruption and race conditions.
EOF
)"
```

---

### Task 6: Improve Wait Command Handling of Missing Threads

**Files:**
- Modify: `src/commands/wait.ts:256-268`
- Modify: `tests/wait-command.test.ts`

**Step 1: Write failing test**

```typescript
// Add to tests/wait-command.test.ts
it('throws error when thread disappears unexpectedly', async () => {
  // Setup: thread exists initially
  await registry.upsert({
    thread_id: 'vanishing-thread',
    role: 'worker',
    policy: 'test',
    status: 'running',
    controller_id: 'test-controller',
  });

  // Start waiting, then delete thread mid-wait
  const waitPromise = waitCommand({
    rootDir: paths.root,
    threadIds: ['vanishing-thread'],
    controllerId: 'test-controller',
    intervalMs: 50,
  });

  // Delete thread after first poll
  await delay(75);
  await registry.remove('vanishing-thread');

  await expect(waitPromise).rejects.toThrow('disappeared');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/wait-command.test.ts`
Expected: FAIL (current code treats missing as completed)

**Step 3: Fix wait to distinguish archived vs missing**

```typescript
// src/commands/wait.ts - modify the missing thread handling
import { stat } from 'node:fs/promises';

// Replace the "Thread might have been archived" section:
if (!entry) {
  // Check if thread was archived
  const archivePath = paths.archiveLogFile(threadId);
  let wasArchived = false;
  try {
    await stat(archivePath);
    wasArchived = true;
  } catch {
    // Not archived
  }

  if (wasArchived) {
    pending.delete(threadId);
    stdout.write(
      `- ${formatThreadLabel(selection.lookup.get(threadId), threadId)} was archived\n`
    );
  } else {
    throw new Error(
      `Thread ${threadId} disappeared from registry unexpectedly. ` +
      `This may indicate a bug or manual registry modification.`
    );
  }
  continue;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/wait-command.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/wait.ts tests/wait-command.test.ts
git commit -m "$(cat <<'EOF'
fix: distinguish archived vs unexpectedly missing threads in wait

Previously, wait treated any missing thread as "completed". Now it
checks the archive and throws an error for truly missing threads.
EOF
)"
```

---

### Task 7: Add Launch Registry Cleanup for Stale Pending Launches

**Files:**
- Modify: `src/lib/launch-registry.ts`
- Modify: `tests/launch-registry.test.ts`

**Step 1: Write failing test**

```typescript
// Add to tests/launch-registry.test.ts
it('cleans up stale pending launches older than threshold', async () => {
  const registry = new LaunchRegistry(paths);

  // Create a pending launch with old timestamp
  const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
  await registry.createAttempt({
    controllerId: 'test',
    type: 'start',
  });

  // Manually backdate it
  const attempts = await registry.listAttempts();
  // ... modify created_at

  await registry.cleanupStale(60 * 60 * 1000); // 1 hour threshold

  const remaining = await registry.listAttempts();
  expect(remaining.filter(a => a.status === 'pending')).toHaveLength(0);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/launch-registry.test.ts`
Expected: FAIL (cleanupStale doesn't exist)

**Step 3: Add cleanupStale method**

```typescript
// src/lib/launch-registry.ts - add method
async cleanupStale(maxAgeMs: number): Promise<number> {
  const records = await this.readAll();
  const now = Date.now();
  let cleaned = 0;

  for (const [id, attempt] of Object.entries(records)) {
    if (attempt.status !== 'pending') {
      continue;
    }
    const age = now - new Date(attempt.created_at).getTime();
    if (age > maxAgeMs) {
      records[id] = {
        ...attempt,
        status: 'failed',
        error_message: `Stale: no response after ${Math.round(age / 60000)} minutes`,
        updated_at: new Date().toISOString(),
      };
      cleaned++;
    }
  }

  if (cleaned > 0) {
    await this.writeAll(records);
  }
  return cleaned;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/launch-registry.test.ts`
Expected: PASS

**Step 5: Add cleanup call to list command**

```typescript
// src/commands/list.ts - add at start of listCommand
const STALE_LAUNCH_MS = 60 * 60 * 1000; // 1 hour
await launchRegistry.cleanupStale(STALE_LAUNCH_MS);
```

**Step 6: Run list tests**

Run: `npx vitest run tests/list-command.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/lib/launch-registry.ts src/commands/list.ts tests/launch-registry.test.ts
git commit -m "$(cat <<'EOF'
feat: auto-cleanup stale pending launches

Pending launches older than 1 hour are marked as failed on list.
Prevents stale launches from accumulating indefinitely.
EOF
)"
```

---

## Phase 3: CLI API Improvements

### Task 8: Rename --output-last to --save-response

**Files:**
- Modify: `src/bin/codex-subagent.ts` (multiple locations)
- Modify: Tests that use --output-last

**Step 1: Update flag parsing to accept both old and new names**

```typescript
// In parseStartFlags, parseSendFlags, parsePeekFlags, parseWatchFlags:
case '--save-response':
case '--output-last':  // Deprecated alias
  if (!next) {
    throw new Error('--save-response flag requires a path');
  }
  flags.outputLastPath = path.resolve(next);
  i++;
  break;
```

**Step 2: Update help text**

```typescript
// Replace all instances of '--output-last' in help text with:
'    --save-response <path>  Optional file to save the last assistant message',
```

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add src/bin/codex-subagent.ts
git commit -m "$(cat <<'EOF'
refactor: rename --output-last to --save-response

The new name is clearer. --output-last remains as a deprecated alias.
EOF
)"
```

---

### Task 9: Remove Redundant --json-stdin and --manifest-stdin Flags

**Files:**
- Modify: `src/bin/codex-subagent.ts`

**Step 1: Remove --json-stdin case, keep --json - support**

```typescript
// Remove these cases from parseStartFlags and parseSendFlags:
// case '--json-stdin':
//   flags.jsonSource = '-';
//   flags.jsonFromStdin = true;
//   break;

// The --json - case already handles stdin
```

**Step 2: Remove --manifest-stdin case**

```typescript
// Remove:
// case '--manifest-stdin':
//   flags.manifestFromStdin = true;
//   break;

// Update --manifest to accept '-':
case '--manifest':
  if (!next) {
    throw new Error('--manifest flag requires a path or "-" for stdin');
  }
  if (next === '-') {
    flags.manifestFromStdin = true;
  } else {
    flags.manifestPath = path.resolve(next);
  }
  i++;
  break;
```

**Step 3: Update help text**

```typescript
// Update help text to show:
'    --manifest <path>        Launch multiple tasks from manifest (use "-" for stdin)',
```

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bin/codex-subagent.ts
git commit -m "$(cat <<'EOF'
refactor: remove redundant --json-stdin and --manifest-stdin flags

Use --json - and --manifest - for stdin, following Unix conventions.
EOF
)"
```

---

### Task 10: Rename --all-controller to --all

**Files:**
- Modify: `src/bin/codex-subagent.ts:685-686`

**Step 1: Update flag parsing**

```typescript
// In parseWaitFlags:
case '--all':
case '--all-controller':  // Deprecated alias
  flags.all = true;
  break;
```

**Step 2: Update help text**

```typescript
'    --all                    Wait for every thread owned by this controller',
```

**Step 3: Run wait tests**

Run: `npx vitest run tests/wait-command.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/bin/codex-subagent.ts
git commit -m "$(cat <<'EOF'
refactor: rename --all-controller to --all

Simpler flag name. --all-controller remains as deprecated alias.
EOF
)"
```

---

### Task 11: Add Short Flags

**Files:**
- Modify: `src/bin/codex-subagent.ts`

**Step 1: Add short flag cases**

```typescript
// In each parse*Flags function, add short alternatives:

// parseStartFlags:
case '-w':
case '--wait':
  flags.wait = true;
  break;

case '-f':
case '--prompt-file':
  // ...

// parseSendFlags, etc:
case '-t':
case '--thread':
  // ...
```

**Step 2: Update help text to show short flags**

```typescript
'    -t, --thread <id>        Target thread (required)',
'    -w, --wait               Block until Codex finishes',
'    -f, --prompt-file <path> Prompt contents file',
```

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add src/bin/codex-subagent.ts
git commit -m "$(cat <<'EOF'
feat: add short flags (-t, -w, -f) for common options

Improves CLI ergonomics for frequent users.
EOF
)"
```

---

### Task 12: Rename --raw to --json

**Files:**
- Modify: `src/bin/codex-subagent.ts` (parseLogFlags, parseStatusFlags)

**Step 1: Update flag parsing**

```typescript
// In parseLogFlags and parseStatusFlags:
case '--json':
case '--raw':  // Deprecated alias
  flags.raw = true;
  break;
```

**Step 2: Update help text**

```typescript
'    --json                   Output raw NDJSON lines',
```

**Step 3: Run tests**

Run: `npx vitest run tests/log-command.test.ts tests/status-command.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/bin/codex-subagent.ts
git commit -m "$(cat <<'EOF'
refactor: rename --raw to --json for output format

More explicit name. --raw remains as deprecated alias.
EOF
)"
```

---

### Task 13: Standardize Timeout Flag Naming

**Files:**
- Modify: `src/bin/codex-subagent.ts` (parseWatchFlags)

**Step 1: Add --timeout-ms alias to watch command**

```typescript
// In parseWatchFlags:
case '--timeout-ms':
case '--duration-ms':  // Keep for compatibility
  if (!next) {
    throw new Error('--timeout-ms flag requires a value');
  }
  flags.durationMs = Number(next);
  if (Number.isNaN(flags.durationMs) || flags.durationMs! < 1) {
    throw new Error('--timeout-ms must be a positive integer');
  }
  i++;
  break;
```

**Step 2: Update help text**

```typescript
'    --timeout-ms <n>         Optional max runtime before exiting cleanly',
```

**Step 3: Run tests**

Run: `npx vitest run tests/watch-command.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/bin/codex-subagent.ts
git commit -m "$(cat <<'EOF'
refactor: standardize on --timeout-ms for time limits

watch command now accepts --timeout-ms (same as wait).
--duration-ms remains as alias.
EOF
)"
```

---

## Phase 4: New Features

### Task 14: Add Filtering to List Command

**Files:**
- Modify: `src/bin/codex-subagent.ts`
- Modify: `src/commands/list.ts`
- Modify: `tests/list-command.test.ts`

**Step 1: Write failing test**

```typescript
// Add to tests/list-command.test.ts
it('filters threads by status', async () => {
  await registry.upsert({ thread_id: 't1', status: 'running', controller_id: 'test' });
  await registry.upsert({ thread_id: 't2', status: 'completed', controller_id: 'test' });

  const { output } = captureOutput();
  await listCommand({
    rootDir: paths.root,
    controllerId: 'test',
    filterStatus: 'running',
    stdout: output,
  });

  const text = output.join('');
  expect(text).toContain('t1');
  expect(text).not.toContain('t2');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/list-command.test.ts`
Expected: FAIL

**Step 3: Add filter parsing to CLI**

```typescript
// Add to parseListFlags (create if needed):
interface ListFlags {
  filterStatus?: string;
  filterLabel?: string;
  filterRole?: string;
}

function parseListFlags(args: string[]): ListFlags {
  const flags: ListFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--status':
        if (!next) throw new Error('--status requires a value');
        flags.filterStatus = next;
        i++;
        break;
      case '--label':
        if (!next) throw new Error('--label requires a value');
        flags.filterLabel = next;
        i++;
        break;
      case '--role':
        if (!next) throw new Error('--role requires a value');
        flags.filterRole = next;
        i++;
        break;
      default:
        throw new Error(`Unknown flag for list command: ${arg}`);
    }
  }
  return flags;
}
```

**Step 4: Add filtering to list command**

```typescript
// src/commands/list.ts - add filter options and logic
export interface ListCommandOptions {
  // ... existing
  filterStatus?: string;
  filterLabel?: string;
  filterRole?: string;
}

// In listCommand, after getting threads:
let filtered = threads;
if (options.filterStatus) {
  filtered = filtered.filter(t =>
    t.status?.toLowerCase() === options.filterStatus?.toLowerCase()
  );
}
if (options.filterLabel) {
  filtered = filtered.filter(t =>
    t.label?.includes(options.filterLabel!)
  );
}
if (options.filterRole) {
  filtered = filtered.filter(t =>
    t.role === options.filterRole
  );
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/list-command.test.ts`
Expected: PASS

**Step 6: Update help text**

```typescript
'  list flags:',
'    --status <status>        Filter by thread status (running, completed, etc)',
'    --label <text>           Filter by label (substring match)',
'    --role <role>            Filter by role',
```

**Step 7: Commit**

```bash
git add src/bin/codex-subagent.ts src/commands/list.ts tests/list-command.test.ts
git commit -m "$(cat <<'EOF'
feat: add --status, --label, --role filters to list command

Allows filtering the thread list for easier management.
EOF
)"
```

---

### Task 15: Add Clean Command for Old Archives

**Files:**
- Create: `src/commands/clean.ts`
- Modify: `src/bin/codex-subagent.ts`
- Create: `tests/clean-command.test.ts`

**Step 1: Write failing test**

```typescript
// tests/clean-command.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Paths } from '../src/lib/paths.ts';
import { cleanCommand } from '../src/commands/clean.ts';

describe('clean command', () => {
  it('removes archived threads older than threshold', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'clean-test-'));
    const paths = new Paths(path.join(tempDir, '.codex-subagent'));
    await paths.ensure();

    // Create old archive
    const archiveDir = path.join(paths.root, 'archive');
    await mkdir(archiveDir, { recursive: true });
    await writeFile(path.join(archiveDir, 'old-thread.log'), 'test');

    // Backdate the file (mock)
    // ...

    await cleanCommand({
      rootDir: paths.root,
      olderThanDays: 0, // Clean everything
      yes: true,
    });

    const remaining = await readdir(archiveDir);
    expect(remaining).toHaveLength(0);

    await rm(tempDir, { recursive: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/clean-command.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement clean command**

```typescript
// src/commands/clean.ts
import { readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import process from 'node:process';
import { Paths } from '../lib/paths.ts';

export interface CleanCommandOptions {
  rootDir?: string;
  olderThanDays?: number;
  yes?: boolean;
  dryRun?: boolean;
  stdout?: Writable;
}

const DEFAULT_OLDER_THAN_DAYS = 30;

export async function cleanCommand(options: CleanCommandOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const olderThanDays = options.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;
  const paths = new Paths(options.rootDir);
  const archiveDir = path.join(paths.root, 'archive');

  if (!options.yes && !options.dryRun) {
    throw new Error('clean command requires --yes or --dry-run for safety');
  }

  let files: string[];
  try {
    files = await readdir(archiveDir);
  } catch {
    stdout.write('No archive directory found. Nothing to clean.\n');
    return;
  }

  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const toDelete: string[] = [];

  for (const file of files) {
    const filePath = path.join(archiveDir, file);
    const stats = await stat(filePath);
    if (stats.mtimeMs < cutoff) {
      toDelete.push(filePath);
    }
  }

  if (toDelete.length === 0) {
    stdout.write(`No archived files older than ${olderThanDays} days.\n`);
    return;
  }

  if (options.dryRun) {
    stdout.write(`Would delete ${toDelete.length} archived file(s):\n`);
    for (const file of toDelete) {
      stdout.write(`  ${path.basename(file)}\n`);
    }
    return;
  }

  for (const file of toDelete) {
    await rm(file);
  }

  stdout.write(`Deleted ${toDelete.length} archived file(s).\n`);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/clean-command.test.ts`
Expected: PASS

**Step 5: Add to CLI**

```typescript
// src/bin/codex-subagent.ts
import { cleanCommand } from '../commands/clean.ts';

// Add case in switch:
case 'clean':
  try {
    const flags = parseCleanFlags(rest);
    await cleanCommand({
      rootDir,
      olderThanDays: flags.olderThanDays,
      yes: Boolean(flags.yes),
      dryRun: Boolean(flags.dryRun),
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  break;

// Add flag parser:
interface CleanFlags {
  olderThanDays?: number;
  yes?: boolean;
  dryRun?: boolean;
}

function parseCleanFlags(args: string[]): CleanFlags {
  const flags: CleanFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--older-than':
        if (!next) throw new Error('--older-than requires a number of days');
        flags.olderThanDays = Number(next);
        if (Number.isNaN(flags.olderThanDays) || flags.olderThanDays < 0) {
          throw new Error('--older-than must be a non-negative number');
        }
        i++;
        break;
      case '--yes':
        flags.yes = true;
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      default:
        throw new Error(`Unknown flag for clean command: ${arg}`);
    }
  }
  return flags;
}
```

**Step 6: Update help text**

```typescript
'  clean           Remove old archived threads',
// ...
'  clean flags:',
'    --older-than <days>      Delete archives older than N days (default 30)',
'    --yes                    Required to actually delete',
'    --dry-run                Show what would be deleted',
```

**Step 7: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 8: Commit**

```bash
git add src/commands/clean.ts src/bin/codex-subagent.ts tests/clean-command.test.ts
git commit -m "$(cat <<'EOF'
feat: add clean command to remove old archived threads

Helps manage disk space by removing archives older than N days.
EOF
)"
```

---

### Task 16: Add Positional Argument Support for Thread ID

**Files:**
- Modify: `src/bin/codex-subagent.ts`

**Step 1: Modify flag parsers to accept positional thread ID**

```typescript
// In parsePeekFlags, parseLogFlags, parseStatusFlags, etc:
function parsePeekFlags(args: string[]): PeekFlags {
  const flags: PeekFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    // Handle positional thread ID (first non-flag argument)
    if (!arg.startsWith('-') && !flags.threadId) {
      flags.threadId = arg;
      continue;
    }

    switch (arg) {
      case '-t':
      case '--thread':
        if (!next) {
          throw new Error('--thread flag requires a value');
        }
        flags.threadId = next;
        i++;
        break;
      // ... rest of cases
    }
  }
  return flags;
}
```

**Step 2: Update help text with examples**

```typescript
'Examples:',
'  # Peek using positional thread ID',
'  codex-subagent peek 019abc...',
'  # Or with flag',
'  codex-subagent peek --thread 019abc...',
```

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add src/bin/codex-subagent.ts
git commit -m "$(cat <<'EOF'
feat: support positional thread ID argument

Commands like peek, log, status now accept thread ID as first argument:
  codex-subagent peek <thread-id>
The --thread flag still works for scripts.
EOF
)"
```

---

## Final Verification

### Task 17: Run Full Test Suite and Lint

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run linter**

Run: `npm run lint`
Expected: No errors

**Step 3: Run type check**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: complete codebase improvements

All design flaws, security issues, and CLI improvements addressed:
- File locking for registry
- Spawn validation for detached workers
- Thread ownership security fix
- Process tree iteration limit
- Thread status validation before send
- Improved wait handling for missing threads
- Launch registry cleanup
- CLI flag renaming and cleanup
- List filtering
- Clean command
- Positional thread ID support
EOF
)"
```

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1 | 1-4 | Critical infrastructure (locking, spawn validation, security) |
| 2 | 5-7 | High priority bug fixes (status validation, wait improvements, cleanup) |
| 3 | 8-13 | CLI API improvements (flag renaming, redundancy removal) |
| 4 | 14-16 | New features (list filtering, clean command, positional args) |

**Total: 17 tasks, ~50-70 individual steps**

Each task follows TDD: write failing test → implement → verify → commit.
