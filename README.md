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

> Why this path? The installer drops a tiny Node wrapper named `codex-subagent` beside the skill. That script simply `import()`s `node_modules/codex-subagent-cli/dist/codex-subagent.js`, so all real dependencies stay inside `node_modules` while the wrapper remains stable and executable. If you ever delete or move the script, rerun the install command above to recreate it.

### Global flags

- `--root <path>`: override the default `.codex-subagent` root.
- `--controller-id <id>`: override the auto-detected controlling Codex session (use this when multiple Codex windows should share the same subagent state).

| Command | Purpose                                                      |
| ------- | ------------------------------------------------------------ |
| `start` | Launch a new Codex exec thread with explicit role/policy (defaults to **detached**, so it returns immediately; add `--wait` to block). |
| `send`  | Resume an existing thread with a new prompt (defaults to **detached**, add `--wait` to block). |
| `peek`  | Show the newest unseen assistant message (read-only; `--verbose` prints last-activity info). |
| `log`   | View the stored NDJSON history (supports `--tail`, `--raw`, `--verbose`). |
| `status`| Summarize the latest activity for a thread (latest message, idle time, optional log tail). |
| `watch` | Continuously peek a thread at an interval (use `--duration-ms` to exit cleanly). |
| `wait`  | Block until specific threads (or labels/all threads) reach a stopped state; optional timeout + “follow last assistant” output. |
| `archive` | Move completed thread logs/state into `.codex-subagent/archive/...` (with `--yes`/`--dry-run`). |
| `label` | Attach/update a friendly label for a thread so `list` is easier to scan. |
| `list`  | List every thread owned by the current controller.           |

Per-command notes:

- `start` requires `--role`, `--policy`, and `--prompt-file` (write prompts to files to avoid shell quoting issues). Policies are mapped to safe `--sandbox` / `--profile` combinations automatically.
- `start --manifest tasks.json` (or `--manifest-stdin`) launches multiple prompts from a single JSON payload. Each task entry accepts `prompt`, `role`, `policy`, `cwd`, `label`, `persona`, `outputLast`, and `wait`. This is the fastest way to spin up a whole squad of helpers; reference prompts inline in JSON so you don’t have to create dozens of temp files.
- `start --json prompt.json` (or `--json -` with stdin) accepts a single structured payload: `{ "prompt": "...", "role": "researcher", "policy": "workspace-write", "cwd": "/repo", "label": "Task", "persona": "reviewer", "output_last": "last.txt", "wait": true }`. Fields mirror the CLI flags, so you can drop prompt files entirely for ad-hoc work.
- `send --json followup.json` works the same way for resume turns (`prompt`, `cwd`, `persona`, `output_last`, `wait`).
- `start` warns that long-running Codex sessions may take minutes or hours. Use the default detached mode when you just want the work to continue in the background, and `--wait` when you truly need to stream the run inline.
- `start`/`send` accept `--cwd <path>` to automatically prepend “work inside /path” instructions, `--label` to tag new threads, and `--persona <name>` to merge Anthropic-style agent personas (project `.codex/agents/`, `~/.codex/agents/`, superpowers `agents/`). Model aliases (`haiku`, `sonnet`, `opus`, `inherit`) are mapped onto safe Codex policies; if a persona sets `model: sonnet`, we’ll use `workspace-write`, etc.
- `send` needs `--thread` + `--prompt-file` and, like `start`, runs detached unless you pass `--wait`. If a persona was set when the thread started, later `send` calls reuse the same persona automatically unless you override it with `--persona`.
- `peek`, `log`, `watch` all require `--thread` and never call Codex (they read the local log/registry). `peek`/`log` accept `--verbose` to print last activity timestamps even when nothing changed; `watch` adds `--duration-ms` so you can stop polling automatically instead of relying on Ctrl+C.
- `status --thread <id> [--tail 5] [--stale-minutes 15]` gives a one-shot summary (latest assistant turn, idle duration, and a suggestion to nudge if the thread has been idle longer than the threshold).
- `wait --threads id1,id2 --follow-last` polls the registry/logs until every selected thread stops. Use `--labels label-a,label-b` or `--all-controller` to track batches launched via manifests, `--interval-ms` to tune polling frequency, and `--timeout-ms` to fail fast instead of waiting forever. When `--follow-last` is set you’ll also see the final assistant reply for each thread as it finishes.
- `--print-prompt` shows the fully composed prompt (persona + working directory instructions) before launching Codex. Add `--dry-run` to skip the Codex invocation entirely after printing—handy for sanity-checking inputs.
- `label --thread <id> --label "Task X"` lets you rename an existing thread after the fact (pass an empty string to clear it).
- `archive --thread <id> --yes` moves a completed thread into the archive. Use `--completed --yes` to archive all completed threads, or `--dry-run` to preview.

### JSON prompt payloads

Skip ad-hoc prompt files by piping JSON straight into `start` or `send`:

```bash
cat <<'JSON' | codex-subagent start \
  --role researcher \
  --policy workspace-write \
  --json - \
  --print-prompt
{
  "prompt": "List open bugs, then propose a fix.",
  "cwd": "/Users/jesse/repos/service",
  "label": "Bug sweep",
  "persona": "triage",
  "output_last": "/tmp/bugs-last.txt",
  "wait": true
}
JSON
```

The same schema works for `send`:

```bash
codex-subagent send --thread 019... --json followup.json --wait
```

Relative paths inside the JSON payload are resolved against the file’s directory (or the current working directory when using stdin), so you can keep everything self-contained beside your manifest/prompt files.

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
