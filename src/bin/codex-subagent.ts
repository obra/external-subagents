import process from 'node:process';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { listCommand } from '../commands/list.ts';
import { startCommand } from '../commands/start.ts';
import { sendCommand } from '../commands/send.ts';
import { peekCommand } from '../commands/peek.ts';
import { logCommand } from '../commands/log.ts';
import { watchCommand } from '../commands/watch.ts';
import { statusCommand } from '../commands/status.ts';
import { archiveCommand } from '../commands/archive.ts';
import { labelCommand } from '../commands/label.ts';
import { waitCommand } from '../commands/wait.ts';
import { RegistryLoadError } from '../lib/registry.ts';
import { getControllerId } from '../lib/controller-id.ts';
import { parseStartManifest, StartManifest } from '../lib/start-manifest.ts';

interface ParsedArgs {
  command: string;
  rootDir?: string;
  controllerId?: string;
  rest: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  let command: string | undefined;
  let rootDir: string | undefined;
  let controllerId: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--root flag requires a path');
      }
      rootDir = path.resolve(next);
      i++; // skip path value
      continue;
    }
    if (arg === '--controller-id') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--controller-id flag requires a value');
      }
      controllerId = next;
      i++;
      continue;
    }
    if (!command) {
      command = arg;
      continue;
    }
    rest.push(arg);
  }

  return { command: command ?? 'list', rootDir, controllerId, rest };
}

interface StartFlags {
  role?: string;
  policy?: string;
  promptFile?: string;
  outputLastPath?: string;
  wait?: boolean;
  workingDir?: string;
  label?: string;
  persona?: string;
  manifestPath?: string;
  manifestFromStdin?: boolean;
}

function parseStartFlags(args: string[]): StartFlags {
  const flags: StartFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--role':
        if (!next) {
          throw new Error('--role flag requires a value');
        }
        flags.role = next;
        i++;
        break;
      case '--policy':
        if (!next) {
          throw new Error('--policy flag requires a value');
        }
        flags.policy = next;
        i++;
        break;
      case '--prompt-file':
        if (!next) {
          throw new Error('--prompt-file flag requires a path');
        }
        flags.promptFile = path.resolve(next);
        i++;
        break;
      case '--output-last':
        if (!next) {
          throw new Error('--output-last flag requires a path');
        }
        flags.outputLastPath = path.resolve(next);
        i++;
        break;
      case '--cwd':
        if (!next) {
          throw new Error('--cwd flag requires a path');
        }
        flags.workingDir = path.resolve(next);
        i++;
        break;
      case '--label':
        if (!next) {
          throw new Error('--label flag requires a value');
        }
        flags.label = next;
        i++;
        break;
      case '--persona':
        if (!next) {
          throw new Error('--persona flag requires a value');
        }
        flags.persona = next;
        i++;
        break;
      case '--manifest':
        if (!next) {
          throw new Error('--manifest flag requires a path');
        }
        flags.manifestPath = path.resolve(next);
        i++;
        break;
      case '--manifest-stdin':
        flags.manifestFromStdin = true;
        break;
      case '--wait':
        flags.wait = true;
        break;
      default:
        throw new Error(`Unknown flag for start command: ${arg}`);
    }
  }
  return flags;
}

async function loadManifestFromFlags(flags: StartFlags): Promise<StartManifest> {
  if (flags.manifestPath && flags.manifestFromStdin) {
    throw new Error('Use either --manifest or --manifest-stdin, not both.');
  }

  if (flags.manifestPath) {
    const body = await readFile(flags.manifestPath, 'utf8');
    const parsed = JSON.parse(body);
    return parseStartManifest(parsed, flags.manifestPath);
  }

  if (flags.manifestFromStdin) {
    const body = await readStdin();
    if (!body.trim()) {
      throw new Error('Manifest JSON from stdin was empty.');
    }
    const parsed = JSON.parse(body);
    return parseStartManifest(parsed, 'stdin');
  }

  throw new Error('Manifest flags were requested but no manifest source was provided.');
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    process.stdin.on('data', (chunk) => {
      if (typeof chunk === 'string') {
        chunks.push(chunk);
      } else {
        chunks.push(chunk.toString('utf8'));
      }
    });
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', (error) => reject(error));
  });
}

interface SendFlags {
  threadId?: string;
  promptFile?: string;
  outputLastPath?: string;
  wait?: boolean;
  workingDir?: string;
  persona?: string;
}

function parseSendFlags(args: string[]): SendFlags {
  const flags: SendFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--thread':
        if (!next) {
          throw new Error('--thread flag requires a value');
        }
        flags.threadId = next;
        i++;
        break;
      case '--prompt-file':
        if (!next) {
          throw new Error('--prompt-file flag requires a path');
        }
        flags.promptFile = path.resolve(next);
        i++;
        break;
      case '--output-last':
        if (!next) {
          throw new Error('--output-last flag requires a path');
        }
        flags.outputLastPath = path.resolve(next);
        i++;
        break;
      case '--cwd':
        if (!next) {
          throw new Error('--cwd flag requires a path');
        }
        flags.workingDir = path.resolve(next);
        i++;
        break;
      case '--persona':
        if (!next) {
          throw new Error('--persona flag requires a value');
        }
        flags.persona = next;
        i++;
        break;
      case '--wait':
        flags.wait = true;
        break;
      default:
        throw new Error(`Unknown flag for send command: ${arg}`);
    }
  }
  return flags;
}

interface PeekFlags {
  threadId?: string;
  outputLastPath?: string;
  verbose?: boolean;
}

function parsePeekFlags(args: string[]): PeekFlags {
  const flags: PeekFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--thread':
        if (!next) {
          throw new Error('--thread flag requires a value');
        }
        flags.threadId = next;
        i++;
        break;
      case '--output-last':
        if (!next) {
          throw new Error('--output-last flag requires a path');
        }
        flags.outputLastPath = path.resolve(next);
        i++;
        break;
      case '--verbose':
        flags.verbose = true;
        break;
      default:
        throw new Error(`Unknown flag for peek command: ${arg}`);
    }
  }
  return flags;
}

interface LogFlags {
  threadId?: string;
  tail?: number;
  raw?: boolean;
  verbose?: boolean;
}

interface LabelFlags {
  threadId?: string;
  label?: string;
}

interface StatusFlags {
  threadId?: string;
  tail?: number;
  raw?: boolean;
  staleMinutes?: number;
}

interface ArchiveFlags {
  threadId?: string;
  completed?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}

interface WaitFlags {
  threads?: string[];
  labels?: string[];
  all?: boolean;
  intervalMs?: number;
  timeoutMs?: number;
  followLast?: boolean;
}

function parseLogFlags(args: string[]): LogFlags {
  const flags: LogFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--thread':
        if (!next) {
          throw new Error('--thread flag requires a value');
        }
        flags.threadId = next;
        i++;
        break;
      case '--tail':
        if (!next) {
          throw new Error('--tail flag requires a value');
        }
        flags.tail = Number(next);
        if (Number.isNaN(flags.tail) || flags.tail! < 1) {
          throw new Error('--tail must be a positive integer');
        }
        i++;
        break;
      case '--raw':
        flags.raw = true;
        break;
      case '--verbose':
        flags.verbose = true;
        break;
      default:
        throw new Error(`Unknown flag for log command: ${arg}`);
    }
  }
  return flags;
}

function parseStatusFlags(args: string[]): StatusFlags {
  const flags: StatusFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--thread':
        if (!next) {
          throw new Error('--thread flag requires a value');
        }
        flags.threadId = next;
        i++;
        break;
      case '--tail':
        if (!next) {
          throw new Error('--tail flag requires a value');
        }
        flags.tail = Number(next);
        if (Number.isNaN(flags.tail) || flags.tail! < 1) {
          throw new Error('--tail must be a positive integer');
        }
        i++;
        break;
      case '--raw':
        flags.raw = true;
        break;
      case '--stale-minutes':
        if (!next) {
          throw new Error('--stale-minutes flag requires a value');
        }
        flags.staleMinutes = Number(next);
        if (Number.isNaN(flags.staleMinutes) || flags.staleMinutes! <= 0) {
          throw new Error('--stale-minutes must be greater than 0');
        }
        i++;
        break;
      default:
        throw new Error(`Unknown flag for status command: ${arg}`);
    }
  }
  return flags;
}

function parseArchiveFlags(args: string[]): ArchiveFlags {
  const flags: ArchiveFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--thread':
        if (!next) {
          throw new Error('--thread flag requires a value');
        }
        flags.threadId = next;
        i++;
        break;
      case '--completed':
        flags.completed = true;
        break;
      case '--yes':
        flags.yes = true;
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      default:
        throw new Error(`Unknown flag for archive command: ${arg}`);
    }
  }
  return flags;
}

function parseLabelFlags(args: string[]): LabelFlags {
  const flags: LabelFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--thread':
        if (!next) {
          throw new Error('--thread flag requires a value');
        }
        flags.threadId = next;
        i++;
        break;
      case '--label':
        if (!next) {
          throw new Error('--label flag requires a value');
        }
        flags.label = next;
        i++;
        break;
      default:
        throw new Error(`Unknown flag for label command: ${arg}`);
    }
  }
  return flags;
}

function parseWaitFlags(args: string[]): WaitFlags {
  const flags: WaitFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--threads':
        if (!next) {
          throw new Error('--threads flag requires a comma-separated list of thread IDs');
        }
        flags.threads = next.split(',').map((value) => value.trim()).filter(Boolean);
        i++;
        break;
      case '--labels':
        if (!next) {
          throw new Error('--labels flag requires a comma-separated list of labels');
        }
        flags.labels = next.split(',').map((value) => value.trim()).filter(Boolean);
        i++;
        break;
      case '--all-controller':
        flags.all = true;
        break;
      case '--interval-ms':
        if (!next) {
          throw new Error('--interval-ms flag requires a value');
        }
        flags.intervalMs = Number(next);
        if (Number.isNaN(flags.intervalMs) || flags.intervalMs! <= 0) {
          throw new Error('--interval-ms must be greater than 0');
        }
        i++;
        break;
      case '--timeout-ms':
        if (!next) {
          throw new Error('--timeout-ms flag requires a value');
        }
        flags.timeoutMs = Number(next);
        if (Number.isNaN(flags.timeoutMs) || flags.timeoutMs! <= 0) {
          throw new Error('--timeout-ms must be greater than 0');
        }
        i++;
        break;
      case '--follow-last':
        flags.followLast = true;
        break;
      default:
        throw new Error(`Unknown flag for wait command: ${arg}`);
    }
  }
  return flags;
}

interface WatchFlags {
  threadId?: string;
  intervalMs?: number;
  outputLastPath?: string;
  durationMs?: number;
}

function parseWatchFlags(args: string[]): WatchFlags {
  const flags: WatchFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--thread':
        if (!next) {
          throw new Error('--thread flag requires a value');
        }
        flags.threadId = next;
        i++;
        break;
      case '--interval-ms':
        if (!next) {
          throw new Error('--interval-ms flag requires a value');
        }
        flags.intervalMs = Number(next);
        if (Number.isNaN(flags.intervalMs) || flags.intervalMs! < 1) {
          throw new Error('--interval-ms must be a positive integer');
        }
        i++;
        break;
      case '--output-last':
        if (!next) {
          throw new Error('--output-last flag requires a path');
        }
        flags.outputLastPath = path.resolve(next);
        i++;
        break;
      case '--duration-ms':
        if (!next) {
          throw new Error('--duration-ms flag requires a value');
        }
        flags.durationMs = Number(next);
        if (Number.isNaN(flags.durationMs) || flags.durationMs! < 1) {
          throw new Error('--duration-ms must be a positive integer');
        }
        i++;
        break;
      default:
        throw new Error(`Unknown flag for watch command: ${arg}`);
    }
  }
  return flags;
}

function printHelp(): void {
  const lines = [
    'codex-subagent <command>',
    '',
    'Commands:',
    '  list            List stored threads (default)',
    '  start           Launch a new Codex exec thread',
    '  send            Send a new prompt to an existing thread (resume)',
    '  peek            Show the newest unseen assistant message for a thread',
    '  log             Print the stored log for a thread (no Codex call)',
    '  status          Summarize the latest activity for a thread',
    '  watch           Continuously peek a thread until interrupted',
    '  wait            Block until threads reach a stopped state',
    '  archive         Move completed thread logs/state into archive',
    '  label           Attach or update a friendly label for a thread',
    '',
    'Options:',
    '  --root <path>          Override the .codex-subagent root directory',
    '  --controller-id <id>   Override auto-detected controller session ID',
  '  start flags:',
  '    --role <name>         Required Codex role (e.g., researcher)',
  '    --policy <policy>     Required policy (never "allow everything")',
  '    --prompt-file <path>  Prompt contents for the subagent',
  '    --output-last <path>  Optional file for last message text',
  '    --cwd <path>          Optional working directory instruction for the subagent',
  '    --label <text>        Optional friendly label stored with the thread',
  '    --persona <name>      Optional persona to load from .codex/agents',
  '    --manifest <path>     Launch multiple tasks defined in a JSON manifest',
  '    --manifest-stdin      Read manifest JSON from stdin',
  '    --wait                Block until Codex finishes (default: detach)',
  '  send flags:',
  '    --thread <id>         Target thread to resume (required)',
  '    --prompt-file <path>  Prompt file for the next turn',
  '    --output-last <path>  Optional file for last message text',
  '    --cwd <path>          Optional working directory instruction for the subagent',
  '    --persona <name>      Optional persona override for this turn',
  '    --wait                Block until Codex finishes (default: detach)',
  '  peek flags:',
  '    --thread <id>         Target thread to inspect (required)',
  '    --output-last <path>  Optional file for last message text',
  '    --verbose             Include last-activity metadata even when no updates',
  '  log flags:',
  '    --thread <id>         Target thread to inspect (required)',
  '    --tail <n>            Optional number of most recent entries to show',
  '    --raw                 Output raw NDJSON lines',
  '    --verbose             Append last-activity metadata',
  '  status flags:',
  '    --thread <id>         Target thread to inspect (required)',
  '    --tail <n>            Optional number of most recent entries to show',
  '    --raw                 Output raw NDJSON lines',
  '    --stale-minutes <n>   Override idle threshold for follow-up suggestion (default 15)',
  '  archive flags:',
  '    --thread <id>         Archive a specific thread',
  '    --completed           Archive all completed threads (per controller)',
  '    --yes                 Required to actually archive (safety guard)',
  '    --dry-run             Show what would archive without moving files',
  '  watch flags:',
  '    --thread <id>         Target thread to watch (required)',
  '    --interval-ms <n>     Interval between peeks (default 5000)',
  '    --output-last <path>  Optional file for last message text',
  '    --duration-ms <n>     Optional max runtime before exiting cleanly',
  '  label flags:',
  '    --thread <id>         Target thread to label (required)',
  '    --label <text>        Friendly label text (empty string clears it)',
  '  wait flags:',
  '    --threads <ids>       Comma-separated thread IDs to wait on',
  '    --labels <labels>     Comma-separated labels to wait on',
  '    --all-controller      Wait for every thread owned by this controller',
  '    --interval-ms <n>     Polling interval (default 5000)',
  '    --timeout-ms <n>      Optional timeout before exiting with failure',
  '    --follow-last         Print the last assistant message when each thread stops',
  '',
  'Examples:',
  '  # Launch a detached researcher subagent',
  '  codex-subagent start --role researcher --policy workspace-write --prompt-file task.txt',
  '  # Resume a thread but wait for completion',
  '  codex-subagent send --thread 019... --prompt-file followup.txt --wait',
  '  # Peek the most recent assistant turn without resuming Codex',
  '  codex-subagent peek --thread 019...',
  '  # Watch for new turns for up to 60 seconds, then exit cleanly',
  '  codex-subagent watch --thread 019... --duration-ms 60000',
  '  # Give a friendly label to a thread',
  '  codex-subagent label --thread 019... --label "Task 3 – log summaries"',
  '',
  'Notes:',
  '  start/send run detached unless you pass --wait.',
  '  watch never resumes Codex; it only replays peek output. Prefer peek/log when you just need the latest turn.',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function run(): Promise<void> {
  const {
    command,
    rootDir,
    controllerId: overrideControllerId,
    rest,
  } = parseArgs(process.argv.slice(2));
  const controllerId = getControllerId({ override: overrideControllerId });

  switch (command) {
    case 'list':
      try {
        await listCommand({ rootDir, controllerId });
      } catch (error) {
        if (error instanceof RegistryLoadError) {
          process.stderr.write(`${error.message}\n`);
          process.exitCode = 1;
        } else {
          throw error;
        }
      }
      break;
    case 'start':
      try {
        const flags = parseStartFlags(rest);
        let manifest: StartManifest | undefined;
        if (flags.manifestPath || flags.manifestFromStdin) {
          manifest = await loadManifestFromFlags(flags);
        }
        await startCommand({
          rootDir,
          role: flags.role,
          policy: flags.policy,
          promptFile: flags.promptFile,
          outputLastPath: flags.outputLastPath,
          wait: Boolean(flags.wait),
          controllerId,
          workingDir: flags.workingDir,
          label: flags.label,
          personaName: flags.persona,
          manifest,
        });
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
      break;
    case 'send':
      try {
        const flags = parseSendFlags(rest);
        await sendCommand({
          rootDir,
          threadId: flags.threadId ?? '',
          promptFile: flags.promptFile ?? '',
          outputLastPath: flags.outputLastPath,
          controllerId,
          wait: Boolean(flags.wait),
          workingDir: flags.workingDir,
          personaName: flags.persona,
        });
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
      break;
    case 'peek':
      try {
        const flags = parsePeekFlags(rest);
        await peekCommand({
          rootDir,
          threadId: flags.threadId ?? '',
          outputLastPath: flags.outputLastPath,
          verbose: Boolean(flags.verbose),
          controllerId,
        });
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
      break;
    case 'log':
      try {
        const flags = parseLogFlags(rest);
        await logCommand({
          rootDir,
          threadId: flags.threadId ?? '',
          tail: flags.tail,
          raw: Boolean(flags.raw),
          verbose: Boolean(flags.verbose),
          controllerId,
        });
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
      break;
    case 'status':
      try {
        const flags = parseStatusFlags(rest);
        await statusCommand({
          rootDir,
          threadId: flags.threadId ?? '',
          tail: flags.tail,
          raw: Boolean(flags.raw),
          staleMinutes: flags.staleMinutes,
          controllerId,
        });
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
      break;
    case 'watch':
      try {
        const flags = parseWatchFlags(rest);
        const controller = new AbortController();
        const handleSigint = () => {
          controller.abort();
        };
        process.on('SIGINT', handleSigint);
        try {
          await watchCommand({
            rootDir,
            threadId: flags.threadId ?? '',
            intervalMs: flags.intervalMs,
            outputLastPath: flags.outputLastPath,
            durationMs: flags.durationMs,
            signal: controller.signal,
            controllerId,
          });
        } finally {
          process.off('SIGINT', handleSigint);
        }
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
      break;
    case 'wait':
      try {
        const flags = parseWaitFlags(rest);
        const controller = new AbortController();
        const handleSigint = () => {
          controller.abort();
        };
        process.on('SIGINT', handleSigint);
        try {
          await waitCommand({
            rootDir,
            controllerId,
            threadIds: flags.threads,
            labels: flags.labels,
            includeAll: Boolean(flags.all),
            intervalMs: flags.intervalMs,
            timeoutMs: flags.timeoutMs,
            followLast: Boolean(flags.followLast),
            signal: controller.signal,
          });
        } finally {
          process.off('SIGINT', handleSigint);
        }
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
      break;
    case 'label':
      try {
        const flags = parseLabelFlags(rest);
        await labelCommand({
          rootDir,
          threadId: flags.threadId ?? '',
          label: flags.label ?? '',
          controllerId,
        });
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
      break;
    case 'archive':
      try {
        const flags = parseArchiveFlags(rest);
        await archiveCommand({
          rootDir,
          threadId: flags.threadId,
          completed: Boolean(flags.completed),
          yes: Boolean(flags.yes),
          dryRun: Boolean(flags.dryRun),
          controllerId,
        });
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      printHelp();
      process.exitCode = 1;
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
