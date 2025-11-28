# Codex Subagent Workflow

This doc captures the recommended flow for spinning up subagents via `codex-subagent` without polluting the main agent's context.

## 1. Start a Thread

Install (or reinstall) via `npm install --prefix ~/.codex/skills/using-subagents-as-codex --production .`. That command creates a wrapper script named `~/.codex/skills/using-subagents-as-codex/codex-subagent` that dynamically imports the packaged CLI from `node_modules/codex-subagent-cli/dist/bin/codex-subagent.js`, so dependency paths remain stable.

```
~/.codex/skills/using-subagents-as-codex/codex-subagent \
  start --role researcher --policy workspace-write \
  --prompt-file task.txt [--cwd /path/to/repo] [--persona code-reviewer] [--label "Task Name"] \
  [--output-last last.txt] [--controller-id demo-doc] [--wait]
```
- Write prompts to files to avoid shell quoting issues, or feed structured JSON via `--json prompt.json` / `--json -` (stdin) with keys such as `prompt`, `role`, `policy`, `cwd`, `label`, `persona`, `output_last`, and `wait`.
- `workspace-write` is the recommended policy; custom policy names only work if you have matching Codex profiles configured. When you pass `--persona`, the persona’s `model` field remaps the sandbox (e.g., `haiku` → `read-only`, `sonnet` → `workspace-write`).
- **Detached by default:** without `--wait`, `start` spawns a background Codex process and returns immediately. Long-running tasks may take minutes or hours; use `peek`/`log` later to inspect results, or add `--wait` when you need to stream the entire run inline.
- A new thread entry is persisted under `.codex-subagent/state/threads.json`, with NDJSON logs under `.codex-subagent/logs/<thread>.ndjson`.
- Personas live (in priority order) under `.codex/agents/` in the project, `~/.codex/agents/`, and the superpowers `agents/` directory. Their prompts and referenced skills are injected automatically, and the persona name is stored with the thread.
- `--print-prompt` echoes the fully composed prompt (persona instructions + working directory reminder) before Codex runs; pair it with `--dry-run` to stop after printing when you just want to inspect the text.

### Launch a batch with `start --manifest`

When you need several helpers at once, put them in a JSON manifest instead of hand-building prompt files:

```jsonc
[
  {
    "prompt": "You are Alpha...",
    "role": "researcher",
    "policy": "workspace-write",
    "cwd": "/repo/a",
    "label": "Alpha task"
  },
  {
    "prompt": "You are Beta...",
    "persona": "code-reviewer",
    "wait": true
  }
]
```

Save it as `tasks.json` (or pipe the JSON to stdin) and run:

```
codex-subagent start --policy workspace-write --role researcher --manifest tasks.json
```

Per-entry `role`, `policy`, `cwd`, `label`, `persona`, `outputLast`, and `wait` override the CLI defaults; unspecified fields inherit the CLI/defaults block at the top of the manifest. Detached entries return immediately, while entries with `wait: true` behave like inline `start --wait`. The summary printed at the end shows which tasks detached vs. waited and the thread IDs for waited entries—capture those IDs if you need to resume them later.

## 2. Resume with Context (Optional)

If the subagent needs another turn, feed it more context (detached by default, add `--wait` to stream inline). Use `--cwd` again if you want Codex to restate the working directory for the new turn:

```
codex-subagent send --thread <thread_id> --prompt-file followup.txt \
  [--cwd /path/to/repo] [--persona code-reviewer] [--output-last last.txt] [--wait]
```

`send` shells out to `codex exec resume …`, appends the streamed JSONL to the log, and updates the registry (status, `last_message_id`). Detached mode lets the main session keep working while Codex runs; pass `--wait` when you need to sit in the turn until it finishes. `--cwd` prepends a “work inside …” instruction so reviewers/helpers never guess the repo path. You can also pass `--json followup.json` (or stdin) instead of `--prompt-file` for single-shot resumes, and use `--print-prompt`/`--dry-run` just like `start` when you want to audit the composed message.

## 3. Check Results Without Resuming

Use `peek` to see whether the subagent produced anything new since you last looked (`--verbose` adds “last activity …” metadata even when nothing changed):

```
codex-subagent peek --thread <thread_id> [--output-last last.txt]
```

- Prints only the newest unseen assistant turn.
- Updates `last_pulled_id` so repeated peeks stay silent unless the log grows.

`log` shows the full NDJSON transcript when you need more context; add `--verbose` to append the last activity timestamp after the entries:

```
codex-subagent log --thread <thread_id> [--tail 20] [--raw]
```

## 4. Watch a Thread

For “is anything happening?” loops, `watch` reuses `peek` on an interval without hitting Codex unless a new turn exists:

```
codex-subagent watch --thread <thread_id> \
  [--interval-ms 2000] [--output-last last.txt] \
  [--controller-id demo-doc] [--duration-ms 60000]
```

Ctrl+C stops the loop. `npm run demo` shows a complete start → watch flow end-to-end. Pass `--duration-ms` when you want the command to stop automatically after a fixed window (helpful when you’re running inside automation and don’t want shell timeouts to show up as failures).

### Wait for a batch to finish

Use `wait` when you want to block until a set of detached threads reaches a terminal state:

```
codex-subagent wait \
  --threads thread-1,thread-2 \
  [--labels "Task A","Task B"] \
  [--all-controller] \
  [--interval-ms 5000] [--timeout-ms 1800000] [--follow-last]
```

- Supply explicit thread IDs, labels, or `--all-controller` (to track everything owned by this Codex session). Labels pair nicely with manifest-launched tasks—label each entry and then wait on the labels instead of thread IDs.
- `--follow-last` prints the most recent assistant message for each thread the moment it completes, so you can quickly summarize the outcomes in your main session.
- `--timeout-ms` fails fast instead of waiting forever; combine it with `--interval-ms` (default 5000) to tune polling frequency.

## 5. Status Checks & Labels

`status` gives you a one-shot view of the latest activity:

```
codex-subagent status --thread <thread_id> [--tail 5] [--raw] [--stale-minutes 30]
```

It shows the newest assistant message (without advancing `last_pulled_id`), how long it’s been idle, and suggests sending a follow-up if the idle time exceeds the threshold you set (default 15 minutes).

Give threads human-friendly names so `list` output stays readable:

```
codex-subagent label --thread <thread_id> --label "Task 3 – log summaries"
```

Pass an empty string to clear the label. New threads can also be labeled at launch with `start --label "…"`.

## 6. Cleanup / Archival

Registry + log files live under `.codex-subagent`. Commit them only if you intentionally share sample data; otherwise, add the directory to `.gitignore` (already configured in this repo). Each thread is tagged with the controller session ID (auto-detected from the parent `codex` process or supplied via `--controller-id`), and commands refuse to touch threads owned by another session.

Use `archive` to move completed threads out of the active registry:

```
codex-subagent archive --thread <thread_id> --yes
codex-subagent archive --completed --yes
codex-subagent archive --completed --dry-run
```

Archived logs + metadata live under `.codex-subagent/archive/<thread>/`. `--dry-run` previews changes; `--yes` is required for real moves.

## Verification Routine

Before publishing or submitting a PR, run:

```
npm run format:fix
npm run lint
npm run typecheck
npm run test
npm run build
```

Capture a manual smoke log (`start`, `send`, `peek`, `log`, `watch`) to document real-world behavior.
