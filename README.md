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

### Installing for `~/.codex/skills`

If you need Codex to call the CLI from a skill folder (e.g., `using-subagents-as-codex`), install this package there with production dependencies only:

```bash
npm install --prefix ~/.codex/skills/using-subagents-as-codex --production .
```

Afterwards, invoke the CLI through the binary that `npm` drops inside the skill directory:

```bash
~/.codex/skills/using-subagents-as-codex/codex-subagent <command>
```

This absolute path works no matter which repository the parent Codex session is using.

### Global flags

- `--root <path>`: override the default `.codex-subagent` root.
- `--controller-id <id>`: override the auto-detected controlling Codex session (use this when multiple Codex windows should share the same subagent state).

| Command | Purpose                                                      |
| ------- | ------------------------------------------------------------ |
| `start` | Launch a new Codex exec thread with explicit role/policy (defaults to **detached**, so it returns immediately; add `--wait` to block). |
| `send`  | Resume an existing thread with a new prompt.                 |
| `peek`  | Show the newest unseen assistant message (read-only).        |
| `log`   | View the stored NDJSON history (supports `--tail`, `--raw`). |
| `watch` | Continuously peek a thread at an interval until interrupted. |
| `list`  | List every thread owned by the current controller.           |

Per-command notes:

- `start` requires `--role`, `--policy`, and `--prompt-file` (write prompts to files to avoid shell quoting issues). Policies are mapped to safe `--sandbox` / `--profile` combinations automatically.
- `start` warns that long-running Codex sessions may take minutes or hours. Use the default detached mode when you just want the work to continue in the background, and `--wait` when you truly need to stream the run inline.
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

Subagents must never run in "allow everything" mode. The CLI enforces this by refusing dangerous policies and mapping safe ones to explicit `--sandbox`/`--profile` parameters when invoking `codex exec`. Every thread is also tagged with the controller session ID (auto-detected from the parent Codex process or supplied via `--controller-id`), and commands refuse to act on threads owned by some other controller.
