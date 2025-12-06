import type { ChildProcess } from 'node:child_process';

export interface SpawnValidationResult {
  healthy: boolean;
  exitCode?: number | null;
  error?: string;
  stderr?: string;
}

export async function validateSpawnedWorker(
  child: ChildProcess,
  graceMs = 500
): Promise<SpawnValidationResult> {
  const stderrChunks: Buffer[] = [];

  // Capture stderr if available (spawn with stdio: ['ignore', 'pipe', 'pipe'])
  if (child.stderr) {
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      // Process survived grace period - consider it healthy
      cleanup();
      // Detach streams so they don't keep the parent alive
      detachStreams();
      resolve({ healthy: true });
    }, graceMs);

    const onExit = (code: number | null) => {
      cleanup();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      const baseError = `Worker exited immediately with code ${code}`;
      resolve({
        healthy: false,
        exitCode: code,
        stderr,
        error: stderr ? `${baseError}: ${stderr}` : baseError,
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

    const detachStreams = () => {
      // Stop listening and let streams drain independently
      if (child.stdout) {
        child.stdout.removeAllListeners();
        child.stdout.destroy();
      }
      if (child.stderr) {
        child.stderr.removeAllListeners();
        child.stderr.destroy();
      }
    };

    child.on('exit', onExit);
    child.on('error', onError);
  });
}
