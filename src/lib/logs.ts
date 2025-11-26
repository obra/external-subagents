import { appendFile } from 'node:fs/promises';
import { ExecMessage } from './exec-runner.ts';

export async function appendMessages(
  logPath: string,
  messages: ExecMessage[] | undefined
): Promise<number> {
  if (!messages || messages.length === 0) {
    await appendFile(logPath, '', 'utf8');
    return 0;
  }

  const payload = messages.map((message) => JSON.stringify(message)).join('\n') + '\n';
  await appendFile(logPath, payload, 'utf8');
  return messages.length;
}
