import process from 'node:process';
import { runStartThreadWorkflow } from '../lib/start-thread.ts';

function parsePayload(): Record<string, unknown> {
  const payloadFlagIndex = process.argv.indexOf('--payload');
  if (payloadFlagIndex === -1 || payloadFlagIndex === process.argv.length - 1) {
    throw new Error('start-runner requires --payload <base64-json>');
  }
  const base64 = process.argv[payloadFlagIndex + 1];
  const json = Buffer.from(base64, 'base64').toString('utf8');
  return JSON.parse(json);
}

(async () => {
  try {
    const payload = parsePayload();
    await runStartThreadWorkflow({
      rootDir: typeof payload.rootDir === 'string' ? payload.rootDir : undefined,
      role: String(payload.role),
      policy: String(payload.policy),
      promptFile: String(payload.promptFile),
      outputLastPath:
        typeof payload.outputLastPath === 'string' ? payload.outputLastPath : undefined,
      controllerId: String(payload.controllerId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Detached start failed: ${message}\n`);
    process.exitCode = 1;
  }
})();
