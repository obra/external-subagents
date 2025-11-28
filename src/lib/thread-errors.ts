import { Paths } from './paths.ts';
import { Registry } from './registry.ts';
import { assertThreadOwnership } from './thread-ownership.ts';

interface MarkThreadErrorOptions {
  threadId: string;
  controllerId: string;
  message: string;
}

export async function markThreadError(
  paths: Paths,
  options: MarkThreadErrorOptions
): Promise<void> {
  const registry = new Registry(paths);
  const thread = await assertThreadOwnership(
    await registry.get(options.threadId),
    options.controllerId,
    registry
  );
  if (!thread) {
    throw new Error(`Thread ${options.threadId} not found`);
  }
  await registry.updateThread(options.threadId, {
    status: 'failed',
    error_message: options.message,
  });
}
