---
name: using-subagents-as-codex
description: Enables subagents for codex. Use when Codex needs parallel or long-running subagents or subtasks. Provides codex-subagent workflow patterns, thread lifecycle management.
---

# Using Subagents as Codex

## Overview

`codex-subagent` offloads work to background threads so your main context stays lean. Threads run detached by default; use `wait`/`peek` to check results.

**Critical rules**:
1. You cannot send to a running thread. Always wait before sending follow-ups.
2. Use the relative path: `scripts/codex-subagent.js`
3. Use Codex's built-in policies: `read-only` or `workspace-write` (not `workspace-read`)

For detailed workflow documentation, see [reference/workflow.md](reference/workflow.md).

## When to Use

| Situation | Why subagents help |
|-----------|-------------------|
| Parallel research tasks | Multiple threads run simultaneously |
| Context would bloat | Research stays in separate thread |
| Long-running work | Detached execution, check later |
| Reproducible prompts | Prompt files create audit trail |

**Don't use for**: Quick inline questions, tightly-coupled work needing your current state.

## Core Workflow

```
1. Write prompt → file     (never inline multi-line prompts)
2. start → launches thread (detached by default)
3. wait/peek → check result
4. send → resume with follow-up (ONLY after thread stops)
5. archive/clean → lifecycle management
```

## The Running Thread Rule

**You CANNOT send to a running thread.** This is the #1 mistake.

```bash
# WRONG - thread might still be running
scripts/codex-subagent.js send thread-abc -f followup.txt

# RIGHT - wait first, then send
scripts/codex-subagent.js wait --threads thread-abc
scripts/codex-subagent.js send thread-abc -f followup.txt
```

Resumable statuses: `completed`, `failed`, `stopped`, `waiting`

## Quick Reference

| Command | Purpose | Key flags |
|---------|---------|-----------|
| `start` | Launch new thread | `--role`, `--policy`, `-f`/`--prompt-file`, `-w`/`--wait`, `--label` |
| `send` | Resume stopped thread | `<thread-id>` or `-t`, `-f`, `-w` |
| `peek` | Read newest unseen message | `<thread-id>`, `--save-response` |
| `log` | Full history | `<thread-id>`, `--tail`, `--json` |
| `status` | Thread summary | `<thread-id>` |
| `wait` | Block until threads stop | `--threads`, `--labels`, `--all`, `--follow-last` |
| `list` | Show threads | `--status`, `--label`, `--role` |
| `archive` | Move completed to archive | `--completed`, `--yes`, `--dry-run` |
| `clean` | Delete old archives | `--older-than-days`, `--yes` |

**Short flags**: `-t` (thread), `-w` (wait), `-f` (prompt-file)

**Positional thread IDs**: `peek abc123` works like `peek -t abc123`

## Common Patterns

### Parallel research
```bash
# Launch multiple researchers
scripts/codex-subagent.js start \
  --role researcher --policy read-only \
  --label "API: Stripe" -f stripe-task.txt
scripts/codex-subagent.js start \
  --role researcher --policy read-only \
  --label "API: Twilio" -f twilio-task.txt

# Wait for all, see results
scripts/codex-subagent.js wait --labels "API:" --follow-last
```

### Quick blocking task
```bash
# -w blocks until Codex finishes (may take 2-5+ minutes!)
# Shows heartbeat every 30s with elapsed time and event count
scripts/codex-subagent.js start \
  --role researcher --policy read-only \
  -f task.txt -w --save-response result.txt
cat result.txt
```

**Warning**: `-w` blocks the shell for as long as Codex runs. For long tasks, prefer detached mode and use `wait --follow-last` to check later.

### Cleanup old work
```bash
# Two-phase: archive completed, then clean old archives
scripts/codex-subagent.js archive --completed --yes
scripts/codex-subagent.js clean --older-than-days 30 --yes
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "command not found" | Tool not in PATH | Use relative path `scripts/codex-subagent.js` |
| "profile does not exist" | Wrong policy name | Use `read-only` or `workspace-write` (not `workspace-read`) |
| "not resumable" error | Thread still running | `wait` first, then `send` |
| "different controller" | Wrong session | Use `--controller-id` or check `list` |
| Launch failed (ENOENT) | codex not in PATH | Verify `which codex` works |
| Thread disappeared | Was archived | Check archive dir or re-run task |

## Checklist

- [ ] Using relative path `scripts/codex-subagent.js`
- [ ] Policy is `read-only` or `workspace-write` (not `workspace-read`)
- [ ] Prompt written to file before CLI call
- [ ] `start` has role, policy, prompt-file, and label
- [ ] `wait` before `send` (never send to running thread)
- [ ] Results captured with `--save-response` or `peek`
- [ ] Old threads archived/cleaned periodically
