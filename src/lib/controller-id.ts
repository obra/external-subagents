import process from 'node:process';
import { spawnSync } from 'node:child_process';

export interface ControllerIdOptions {
  override?: string;
  psReader?: (pid: number) => ProcInfo | undefined;
  startPid?: number;
}

interface ProcInfo {
  pid: number;
  ppid: number;
  command: string;
}

let cachedId: string | undefined;

function defaultPsReader(pid: number): ProcInfo | undefined {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return undefined;
  }
  const line = result.stdout.trim();
  if (!line) {
    return undefined;
  }
  const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) {
    return undefined;
  }
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    command: match[3],
  };
}

function findControllerPid(
  psReader: (pid: number) => ProcInfo | undefined,
  startPid: number
): string {
  const visited = new Set<number>();
  let currentPid = startPid;

  while (!visited.has(currentPid)) {
    visited.add(currentPid);
    const info = psReader(currentPid);
    if (!info) {
      break;
    }
    if (/^codex\b/.test(info.command)) {
      return String(info.pid);
    }
    if (info.ppid === 0) {
      break;
    }
    currentPid = info.ppid;
  }

  return String(process.pid);
}

export function getControllerId(options: ControllerIdOptions = {}): string {
  if (options.override?.trim()) {
    cachedId = options.override.trim();
    return cachedId;
  }

  if (cachedId) {
    return cachedId;
  }

  const psReader = options.psReader ?? defaultPsReader;
  const startPid = options.startPid ?? process.pid;
  cachedId = findControllerPid(psReader, startPid);
  return cachedId;
}

export function resetControllerIdCache(): void {
  cachedId = undefined;
}
