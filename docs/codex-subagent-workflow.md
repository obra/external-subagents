# Codex Subagent Workflow

This doc captures the recommended flow for spinning up subagents via `codex-subagent` without polluting the main agent's context.

## 1. Start a Thread

```
codex-subagent start --role researcher --policy workspace-write --prompt-file task.txt [--output-last last.txt]
```

- Write prompts to files to avoid shell quoting issues.
- Policies map to safe Codex sandbox/profile combinations; the CLI refuses "allow everything".
- A new thread entry is persisted under `.codex-subagent/state/threads.json`, with NDJSON logs under `.codex-subagent/logs/<thread>.ndjson`.

## 2. Resume with Context (Optional)

If the subagent needs another turn, feed it more context:

```
codex-subagent send --thread <thread_id> --prompt-file followup.txt [--output-last last.txt]
```

`send` shells out to `codex exec resume …`, appends the streamed JSONL to the log, and updates the registry (status, `last_message_id`).

## 3. Check Results Without Resuming

Use `peek` to see whether the subagent produced anything new since you last looked:

```
codex-subagent peek --thread <thread_id> [--output-last last.txt]
```

- Prints only the newest unseen assistant turn.
- Updates `last_pulled_id` so repeated peeks stay silent unless the log grows.

`log` shows the full NDJSON transcript when you need more context:

```
codex-subagent log --thread <thread_id> [--tail 20] [--raw]
```

## 4. Watch a Thread

For “is anything happening?” loops, `watch` reuses `peek` on an interval without hitting Codex unless a new turn exists:

```
codex-subagent watch --thread <thread_id> [--interval-ms 2000] [--output-last last.txt]
```

Ctrl+C stops the loop. `npm run demo` shows a complete start → watch flow end-to-end.

## 5. Cleanup / Archival

Registry + log files live under `.codex-subagent`. Commit them only if you intentionally share sample data; otherwise, add the directory to `.gitignore` (already configured in this repo).

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
