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
      cleanup();
      resolve({ healthy: true });
    }, graceMs);

    const onExit = (code: number | null) => {
      cleanup();
      resolve({
        healthy: false,
        exitCode: code,
        error: `Worker exited immediately with code ${code}`,
      });
    };

    const onError = (err: Error) => {
      cleanup();
      resolve({
        healthy: false,
        error: err.message,
      });
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };

    child.on('exit', onExit);
    child.on('error', onError);
  });
}
