import { readFile } from 'node:fs/promises';

export interface LoggedMessage {
  id: string;
  text?: string;
  created_at?: string;
  role?: string;
}

export async function readLogLines(logPath: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(logPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseLogLine(line: string): LoggedMessage | undefined {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const candidate = parsed as Record<string, unknown>;
      const id = candidate.id;
      if (typeof id === 'string' && id.length > 0) {
        const message: LoggedMessage = { id };
        if (typeof candidate.text === 'string') {
          message.text = candidate.text;
        }
        if (typeof candidate.created_at === 'string') {
          message.created_at = candidate.created_at;
        }
        if (typeof candidate.role === 'string') {
          message.role = candidate.role;
        }
        return message;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
