import process from 'node:process';
import { runSendThreadWorkflow } from '../lib/send-thread.ts';

function parsePayload(): Record<string, unknown> {
  const payloadFlagIndex = process.argv.indexOf('--payload');
  if (payloadFlagIndex === -1 || payloadFlagIndex === process.argv.length - 1) {
    throw new Error('send-runner requires --payload <base64-json>');
  }
  const base64 = process.argv[payloadFlagIndex + 1];
  const json = Buffer.from(base64, 'base64').toString('utf8');
  return JSON.parse(json);
}

(async () => {
  try {
    const payload = parsePayload();
    await runSendThreadWorkflow({
      rootDir: typeof payload.rootDir === 'string' ? payload.rootDir : undefined,
      threadId: String(payload.threadId),
      promptFile:
        typeof payload.promptFile === 'string' && payload.promptFile.length > 0
          ? payload.promptFile
          : undefined,
      promptBody:
        typeof payload.promptBody === 'string' && payload.promptBody.length > 0
          ? payload.promptBody
          : undefined,
      outputLastPath:
        typeof payload.outputLastPath === 'string' ? payload.outputLastPath : undefined,
      controllerId: String(payload.controllerId),
      workingDir: typeof payload.workingDir === 'string' ? payload.workingDir : undefined,
      personaName:
        typeof payload.personaName === 'string' ? payload.personaName : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Detached send failed: ${message}\n`);
    process.exitCode = 1;
  }
})();
