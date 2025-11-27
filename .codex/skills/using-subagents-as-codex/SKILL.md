name: using-subagents-as-codex
description: Use when Codex would benefit from a background subagent so the primary session stays lean—this skill walks through codex-subagent start/send/peek/log/watch usage, controller ID tagging, and disk-based prompt/result handling for reliable async work.

# Using Subagents as Codex

## Overview
`codex-subagent` is the standard way to launch Codex-controlled helpers whose prompts/results live on disk (`.codex-subagent`). This skill explains when to spin up a subagent, how to run `start`/`send/peek/log/watch`, and how controller IDs keep multiple Codex terminals from colliding.

## When to Use
Use this skill any time the main Codex session might benefit from parallel or long-running work: research threads, context-heavy builds, or anything that would otherwise bloat the active chat. Install the CLI into this folder (`npm install --prefix ~/.codex/skills/using-subagents-as-codex --production .`) and call it via `~/.codex/skills/using-subagents-as-codex/node_modules/.bin/codex-subagent …` so the path works regardless of your current repository. The CLI auto-detects the controlling Codex PID, so mistagging is rare—but the instructions below ensure you never forget prompts, policies, or result capture.

### Symptoms / Triggers
| Situation | Why this skill helps |
| --- | --- |
| Need background research while main session keeps context | `start`/`send` run subagents fully outside your chat. |
| Lots of copy/paste between prompts | Prompt files keep history reproducible. |
| Hard to remember what a subagent already answered | `peek`/`log` read NDJSON logs safely. |
| Multiple Codex tabs open | Controller IDs keep each set of threads isolated (use `--controller-id` when intentionally sharing). |

## Workflow (Do This Every Time)
1. **Prep prompt**: Write the request to a prompt file (`task.txt`, `followup.txt`). Never inline multi-line prompts; this avoids shell quoting issues and leaves an audit trail.
2. **Launch**: `~/.codex/skills/using-subagents-as-codex/node_modules/.bin/codex-subagent start --role <role> --policy workspace-write --prompt-file task.txt [--output-last last.txt] [--controller-id my-session] [--wait]`. Detached mode is the default—Codex keeps running for minutes/hours while the CLI returns immediately. Add `--wait` only when you need to sit in the session until Codex finishes.
3. **Inspect**: Use `peek --thread <id> [--output-last last.txt]` to fetch the newest unseen assistant message without resuming; it updates `last_pulled_id` so repeated peeks are quiet when nothing changed.
4. **Resume**: When you have follow-up instructions, `send --thread <id> --prompt-file followup.txt [...]`. Policy/role come from the registry; you only supply the new prompt file.
5. **Review history**: `log --thread <id> [--tail 20] [--raw]` prints NDJSON history; grep/pipe as needed.
6. **Watch if needed**: For “any updates yet?” loops, run `watch --thread <id> [--interval-ms 5000] [--controller-id ...]`. It repeatedly runs `peek`; stop with Ctrl+C (or wrap in `timeout` during demos).
7. **Record outcomes**: After each peek/log/watch, paste the relevant sentence back into your main Codex convo so teammates know the status.
8. **Demo sanity check**: On new machines, run `npm run demo` once to ensure `start` + `watch` wiring works locally.

## Quick Reference
| Command | Required | Optional | Notes |
| --- | --- | --- | --- |
| `start` | `--role`, `--policy`, `--prompt-file` | `--output-last`, `--controller-id`, `--root` | Launches new thread; refuses “allow everything”. |
| `send` | `--thread`, `--prompt-file` | `--output-last`, `--controller-id` | Resumes existing thread with new prompt file. |
| `peek` | `--thread` | `--output-last`, `--controller-id` | Reads newest unseen assistant message only. |
| `log` | `--thread` | `--tail <n>`, `--raw`, `--controller-id` | Reads stored NDJSON history. |
| `watch` | `--thread` | `--interval-ms`, `--output-last`, `--controller-id` | Loops `peek` until stopped. |
| `list` | *(none)* | `--controller-id`, `--root` | Shows threads owned by current controller. |

## Common Mistakes + Fixes
| Mistake | Fix |
| --- | --- |
| Forgetting to write prompt to disk | Create `task.txt` *first*, then run CLI; version control it if helpful. |
| Expecting `peek` to resume Codex | `peek`/`log` are read-only; run `send` for actual execution. |
| Multiple Codex terminals stepping on each other | Use distinct `--controller-id` values when you intentionally want to separate/merge thread pools. |
| Leaving `watch` running | Use `Ctrl+C` or wrap `timeout 30 node ... watch ...` during tests. |
| Committing `.codex-subagent` | Leave it ignored unless sharing sample logs on purpose. |

## Verification Snapshot
Baseline testing showed agents launching subagents inline (prompt strings) and forgetting which session owned the thread, causing `thread belongs to a different controller` errors. Following the workflow above (prompt file + controller tagging + peek/log usage) kept state consistent and prevented accidental cross-session access.

## Checklist
- [ ] Prompt written to disk before CLI call.
- [ ] `start` executed with correct role/policy and (if needed) `--controller-id`.
- [ ] `send` only after `peek/log` confirms prior output.
- [ ] `peek`/`log` run before summarizing results back to main chat.
- [ ] `watch` stopped with Ctrl+C or timeout.
- [ ] `.codex-subagent` left untracked unless intentionally shared.
