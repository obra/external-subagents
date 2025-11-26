import process from 'node:process';
import path from 'node:path';
import { listCommand } from '../commands/list.ts';
import { RegistryLoadError } from '../lib/registry.ts';

interface ParsedArgs {
  command: string;
  rootDir?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  let command: string | undefined;
  let rootDir: string | undefined;

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
    }
  }

  return { command: command ?? 'list', rootDir };
}

function printHelp(): void {
  const lines = [
    'codex-subagent <command>',
    '',
    'Commands:',
    '  list            List stored threads (default)',
    '',
    'Options:',
    '  --root <path>   Override the .codex-subagent root directory',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function run(): Promise<void> {
  const { command, rootDir } = parseArgs(process.argv.slice(2));

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
