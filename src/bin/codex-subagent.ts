import process from 'node:process';
import path from 'node:path';
import { listCommand } from '../commands/list.ts';
import { startCommand } from '../commands/start.ts';
import { sendCommand } from '../commands/send.ts';
import { peekCommand } from '../commands/peek.ts';
import { logCommand } from '../commands/log.ts';
import { RegistryLoadError } from '../lib/registry.ts';

interface ParsedArgs {
  command: string;
  rootDir?: string;
  rest: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  let command: string | undefined;
  let rootDir: string | undefined;
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
    if (!command) {
      command = arg;
      continue;
    }
    rest.push(arg);
  }

  return { command: command ?? 'list', rootDir, rest };
}

interface StartFlags {
  role?: string;
  policy?: string;
  promptFile?: string;
  outputLastPath?: string;
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
      default:
        throw new Error(`Unknown flag for start command: ${arg}`);
    }
  }
  return flags;
}

interface SendFlags {
  threadId?: string;
  promptFile?: string;
  outputLastPath?: string;
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
      default:
        throw new Error(`Unknown flag for send command: ${arg}`);
    }
  }
  return flags;
}

interface PeekFlags {
  threadId?: string;
  outputLastPath?: string;
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
      default:
        throw new Error(`Unknown flag for log command: ${arg}`);
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
    '',
    'Options:',
    '  --root <path>   Override the .codex-subagent root directory',
    '  start flags:',
    '    --role <name>         Required Codex role (e.g., researcher)',
    '    --policy <policy>     Required policy (never "allow everything")',
    '    --prompt-file <path>  Prompt contents for the subagent',
    '    --output-last <path>  Optional file for last message text',
    '  send flags:',
    '    --thread <id>         Target thread to resume (required)',
    '    --prompt-file <path>  Prompt file for the next turn',
    '    --output-last <path>  Optional file for last message text',
    '  peek flags:',
    '    --thread <id>         Target thread to inspect (required)',
    '    --output-last <path>  Optional file for last message text',
    '  log flags:',
    '    --thread <id>         Target thread to inspect (required)',
    '    --tail <n>            Optional number of most recent entries to show',
    '    --raw                 Output raw NDJSON lines',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function run(): Promise<void> {
  const { command, rootDir, rest } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'list':
      try {
        await listCommand({ rootDir });
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
        await startCommand({
          rootDir,
          role: flags.role ?? '',
          policy: flags.policy ?? '',
          promptFile: flags.promptFile ?? '',
          outputLastPath: flags.outputLastPath,
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
