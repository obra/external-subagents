# Subagent Workflow Follow-Ups

- [x] Make `codex-subagent send` mirror `start` by defaulting to detached mode with an optional `--wait`, so follow-up prompts don’t block the controlling session.
- [x] Adjust `watch` so “no updates yet” exits cleanly (return code 0, optional duration) instead of surfacing exit code 124 which looks like a failure.
- [x] Improve reviewer ergonomics when repos live outside the current cwd—either extend prompts to include explicit `cd /path` instructions or add a `--cwd` flag that the CLI passes to subagents.
- [x] Clarify code review skill usage in prompts (code-reviewer skill isn’t installed; explicitly instruct reviewers to follow the template instead of trying `use-skill code-reviewer`).
- [x] Enhance `list`/thread metadata so it’s easier to filter threads belonging to the current controller (auto-apply controller ID by default, allow friendly task labels).
- [x] Add a verbose peek/log option that shows last activity timestamps even when no assistant message has arrived, so long Codex runs feel less ambiguous.
- [x] Update the using-subagents-as-codex skill to clarify best practices (favor `peek` over long `watch` loops, explicitly include repo paths in prompts, etc.) so operators don’t have to re-learn the patterns we discovered.
- [x] Improve the CLI’s `--help`/interactive guidance with concrete examples (start/send/peek workflows, warning about `watch` exit codes, explanation of `--wait` vs detached) to reduce operator confusion.
- [x] Surfacing running/completed/failed status in `codex-subagent list`, ordering running threads first, and adding a concise `status --thread` command that prints last assistant turn, last activity timestamp, and suggestions (e.g., “No activity for 15m – consider sending a follow-up”).
- [x] Implement `codex-subagent archive` to move completed thread logs/state into `.codex-subagent/archive/<thread>` (with dry-run + confirmation) so the registry stays lean but logs remain accessible.
- [x] Support anthropic-style personas via `--persona <name>` by resolving Markdown agent specs (priority: project `.codex/agents/`, user `~/.codex/agents/`, superpowers `agents/` dir), merging their prompts/skills/policy hints into start/send.
- [x] Map persona `model` aliases (`sonnet`, `haiku`, `opus`, `inherit`) onto appropriate Codex profiles/sandboxes automatically, with warnings when a model can’t be matched.
- [x] Honor persona `skills` by auto-loading the referenced skill files before launching the subagent (if available locally), so personas can enforce their own workflows.
- [x] Extend `help`/docs/skill sections to explain personas, `status`, and `archive`, including examples of using `--persona` together with `--cwd`, `--label`, etc.
- [x] Improve startup diagnostics so failed `start`/`send` attempts surface actionable errors (log runner stderr to `.codex-subagent/state/launch-errors`, show `NOT RUNNING` in `list`, warn via `Launch diagnostics` when a launch never progressed past start).
- [x] Re-run the full Codex real-world test (with sandbox disabled) to confirm the new single-binary workflow writes `.codex-subagent/state/threads.json`, and capture the transcript for docs. (See `docs/examples/2025-11-28-realworld-smoke.log` for the latest run.)
- [x] Document the hidden `worker-start` / `worker-send` subcommands in developer notes so future maintainers understand how detached launches re-enter the CLI.
