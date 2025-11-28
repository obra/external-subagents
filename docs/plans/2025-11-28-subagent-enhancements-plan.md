# Subagent CLI Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface thread status/age, add status/archive/persona support, and improve docs/UX so Codex can manage long-running subagents cleanly.

**Architecture:** Build atop existing registry/log helpers. New commands (`status`, `archive`) leverage the same file-based state. Persona support reads Markdown definitions from multiple roots, maps model aliases to Codex profiles, and injects instructions/skills into start/send workflows. Help/docs reflect the new features.

**Tech Stack:** Node 20, TypeScript, Vitest, tsup, npm.

---

### Task 1: Enhance `list` output and add `status` command

**Files:**
- Modify: `src/commands/list.ts`
- Create: `src/commands/status.ts`
- Modify: `src/bin/codex-subagent.ts`
- Update tests: `tests/list-command.test.ts`, `tests/status-command.test.ts`

**Steps:**
1. Write failing tests covering:
   - `list` orders running threads first, shows `(label)` when present, and displays `running · updated 2m ago` style text.
   - New `status` command prints last assistant turn (without advancing `last_pulled_id`), thread status, last activity age, and suggests sending a follow-up if idle > configurable threshold.
2. Implement `formatRelativeTime` helper and update `listCommand` accordingly.
3. Implement `statusCommand` (reads registry + log tail, avoids `peek` mutation, supports `--tail`/`--raw`).
4. Wire CLI parsing/help for `status`.
5. Run `npm test -- tests/list-command.test.ts tests/status-command.test.ts`, then full suite.
6. Commit: `feat: add list status and status command`.

---

### Task 2: Implement `archive` command for completed threads

**Files:**
- Create: `src/commands/archive.ts`
- Modify: `src/bin/codex-subagent.ts`
- Update: `src/lib/paths.ts` (add archive helpers)
- Tests: `tests/archive-command.test.ts`

**Steps:**
1. Write failing tests verifying:
   - `archive --thread <id>` moves log + registry entry to `.codex-subagent/archive/<id>/` and leaves a tombstone, unless `--dry-run`.
   - Attempting to archive running threads prompts an error.
   - `archive --completed --yes` archives all completed threads.
2. Implement archive logic (ensure idempotency, safe directories, prompt/confirmation via `--yes`).
3. Update CLI help/docs with usage examples.
4. `npm test -- tests/archive-command.test.ts`, then full suite.
5. Commit: `feat: add archive command`.

---

### Task 3: Persona discovery & prompt/model integration

**Files:**
- Create: `src/lib/personas.ts`
- Modify: `src/commands/start.ts`, `src/commands/send.ts`, `src/lib/start-thread.ts`, `src/lib/send-thread.ts`, `src/bin/codex-subagent.ts`
- Tests: `tests/persona-loader.test.ts`, adjust `tests/start-command.test.ts`/`tests/send-command.test.ts`

**Steps:**
1. Write persona loader tests covering priority order (project `.codex/agents`, user `~/.codex/agents`, superpowers `agents/`), YAML parsing, inheritance of tools/skills/models.
2. Implement `loadPersona(name, roots)` returning structured data (prompt, skills, tool list, model alias, permission mode).
3. Map `model` aliases to Codex policies/profiles (e.g., `sonnet -> workspace-write`, `haiku -> read-only`, `opus -> high-resource profile`); emit warning if unmapped.
4. Extend start/send parsing with `--persona` flag. When provided:
   - Merge persona prompt + `--cwd` instruction + user prompt via `transformPrompt`.
   - Auto-load persona `skills` (emit warning if missing) before launching subagent (update skill docs accordingly).
   - Adjust sandbox/profile per model alias.
5. Ensure persona metadata is stored on the registry entry (`persona` field) for list/status display.
6. Update tests for prompt augmentation and model mapping.
7. Commit: `feat: add persona support for start/send`.

---

### Task 4: Documentation & help updates

**Files:**
- `README.md`
- `docs/codex-subagent-workflow.md`
- `.codex/skills/using-subagents-as-codex/SKILL.md`
- `src/bin/codex-subagent.ts` help text

**Steps:**
1. Document new commands (`status`, `archive`, `label`) and persona usage (flag, directory priority, model mapping).
2. Add note about auto-loading persona skills + `--cwd` best practices.
3. Include example flows for archiving completed threads and checking status.
4. Verify docs lint (if any) and stage changes.
5. Commit: `docs: describe status/archive/persona workflows`.

---

### Task 5: Integration tests & polish

**Files:**
- `tests/cli.integration.test.ts` (new)
- Sample persona fixtures under `tests/fixtures/agents/`

**Steps:**
1. Write an integration test that spins up a temporary `.codex-subagent` root with fake logs, runs `node dist/bin/codex-subagent.js status ...` and `archive ...` to ensure wiring works end-to-end.
2. Add persona fixture files and ensure the CLI resolves them in tests.
3. Run `npm run format`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
4. Commit: `test: add cli integration coverage`.

---

### Task 6: Final verification & TODO cleanup

**Steps:**
1. Ensure `TODO.md` entries are updated/checked off.
2. Manually run `~/.codex/skills/using-subagents-as-codex/codex-subagent --help` to confirm new flags appear.
3. Optional: archive one of the demo threads to validate real-world behavior.
4. Summarize changes for Jesse; prep next steps (Task 5/6 of thread-snapshot project, or upstream PR).
