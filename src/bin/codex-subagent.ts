import process from 'node:process';
import path from 'node:path';
import { listCommand } from '../commands/list.ts';
import { startCommand } from '../commands/start.ts';
import { sendCommand } from '../commands/send.ts';
import { pullCommand } from '../commands/pull.ts';
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

interface PullFlags {
  threadId?: string;
  outputLastPath?: string;
}

function parsePullFlags(args: string[]): PullFlags {
  const flags: PullFlags = {};
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
        throw new Error(`Unknown flag for pull command: ${arg}`);
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
    '  pull            Check an existing thread for new assistant messages',
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
    '  pull flags:',
    '    --thread <id>         Target thread to resume (required)',
    '    --output-last <path>  Optional file for last message text',
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
    case 'pull':
      try {
        const flags = parsePullFlags(rest);
        await pullCommand({
          rootDir,
          threadId: flags.threadId ?? '',
          outputLastPath: flags.outputLastPath,
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
