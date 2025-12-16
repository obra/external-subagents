import type { Registry } from './registry.ts';
import { ThreadMetadata } from './registry.ts';

// Note: registry param kept for API compatibility, may be used in future for explicit claim
export async function assertThreadOwnership(
  thread: ThreadMetadata | undefined,
  controllerId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _registry: Registry
): Promise<ThreadMetadata> {
  if (!thread) {
    throw new Error('Thread not found');
  }

  if (thread.controller_id && thread.controller_id !== controllerId) {
    throw new Error(`Thread ${thread.thread_id} belongs to a different controller`);
  }

  if (!thread.controller_id) {
    throw new Error(
      `Thread ${thread.thread_id} has no controller_id and cannot be auto-claimed. ` +
      `Threads must have controller_id set at creation time.`
    );
  }

  return thread;
}
