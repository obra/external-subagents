import path from 'node:path';
import { mkdir } from 'node:fs/promises';

export class Paths {
  readonly root: string;

  constructor(rootDir: string = path.resolve(process.cwd(), '.codex-subagent')) {
    this.root = path.resolve(rootDir);
  }

  get stateDir(): string {
    return path.join(this.root, 'state');
  }

  get logsDir(): string {
    return path.join(this.root, 'logs');
  }

  get archiveRoot(): string {
    return path.join(this.root, 'archive');
  }

  get threadsFile(): string {
    return path.join(this.stateDir, 'threads.json');
  }

  logFile(threadId: string): string {
    return path.join(this.logsDir, `${threadId}.ndjson`);
  }

  archiveDir(threadId: string): string {
    return path.join(this.archiveRoot, threadId);
  }

  archivedLogFile(threadId: string): string {
    return path.join(this.archiveDir(threadId), 'log.ndjson');
  }

  async ensure(): Promise<void> {
    await Promise.all([
      mkdir(this.stateDir, { recursive: true }),
      mkdir(this.logsDir, { recursive: true }),
      mkdir(this.archiveRoot, { recursive: true }),
    ]);
  }

  resolve(...segments: string[]): string {
    return path.join(this.root, ...segments);
  }
}
