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
    return await registry.updateThread(thread.thread_id, {
      controller_id: controllerId,
    });
  }

  return thread;
}
