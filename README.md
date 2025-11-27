# codex-subagent-cli

A TypeScript CLI for launching and managing Codex subagents without bloating the primary agent's context. Threads run via `codex exec --json`, with metadata stored under `.codex-subagent`.

## Getting Started

```bash
npm install
npm run build
```

All commands assume Node 20+ and npm 10+.

## CLI Usage

```
codex-subagent <command> [options]
```

| Command | Purpose                                                      |
| ------- | ------------------------------------------------------------ |
| `start` | Launch a new Codex exec thread with explicit role/policy.    |
| `send`  | Resume an existing thread with a new prompt.                 |
| `peek`  | Show the newest unseen assistant message (read-only).        |
| `log`   | View the stored NDJSON history (supports `--tail`, `--raw`). |
| `watch` | Continuously peek a thread at an interval until interrupted. |
| `list`  | List every thread known to the registry.                     |

Common flags:

- `--root <path>`: override the default `.codex-subagent` root.
- `start` requires `--role`, `--policy`, and `--prompt-file` (use files to avoid shell quoting issues). Policies are mapped to safe `--sandbox` / `--profile` combinations automatically.
- `send` needs `--thread` + `--prompt-file`.
- `peek`, `log`, `watch` all require `--thread` and never call Codex (they read the local log/registry).

### Demo

`npm run demo` spins up a throwaway thread and then attaches `watch` so you can see updates flow through without any manual wiring.

## Development

- Format: `npm run format:fix`
- Lint: `npm run lint`
- Type-check: `npm run typecheck`
- Tests: `npm run test`
- Build bundle: `npm run build`

`peek`/`log`/`watch` share NDJSON logs under `.codex-subagent/logs/<thread>.ndjson`. Registry metadata lives in `.codex-subagent/state/threads.json` (commit this file only when intentionally sharing test fixtures).

## Policies & Safety

Subagents must never run in "allow everything" mode. The CLI enforces this by refusing dangerous policies and mapping safe ones to explicit `--sandbox`/`--profile` parameters when invoking `codex exec`.
