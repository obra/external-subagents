# Thread Snapshot CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone CLI that summarizes Codex subagent thread logs (latest status, last assistant turn, error flags) so the main session can check background helpers without reading whole NDJSON files.

**Architecture:** Node.js TypeScript CLI packaged with tsup; it reads `.codex-subagent/state/threads.json` and associated `logs/<thread>.ndjson`, computes per-thread summaries (status, last assistant message timestamp, whether last turn errored), and prints a table or JSON.

**Tech Stack:** Node 20+, TypeScript, tsup bundler, vitest for tests, eslint+prettier, prek for git hygiene (reusing codex-standard tooling).

---

### Task 1: Bootstrap temp workspace

**Files:**
- Create: `/tmp/thread-snapshot-cli/package.json`
- Create: `/tmp/thread-snapshot-cli/tsconfig.json`
- Create: `/tmp/thread-snapshot-cli/src/index.ts`
- Create: `/tmp/thread-snapshot-cli/tests/index.test.ts`

**Step 1: Initialize project**
Run: `mkdir -p /tmp/thread-snapshot-cli && cd /tmp/thread-snapshot-cli && npm init -y`
Expected: package.json created with default fields.

**Step 2: Install toolchain**
Run: `npm install typescript tsup vitest @types/node eslint prettier prek --save-dev`
Expected: Dependencies listed in package.json.

**Step 3: Add npm scripts**
Update package.json scripts to include `build`, `lint`, `format`, `test`, `typecheck`, `prepare` (runs `node scripts/run-prek-install.mjs`), and `start` pointing to `node dist/index.js`.

**Step 4: Configure TypeScript**
Write `tsconfig.json` targeting Node 20 (ES2022), `strict: true`, `module: ESNext`, `moduleResolution: bundler`, `outDir: dist`.

**Step 5: Add basic source/test placeholders**
- `src/index.ts` exports a stub function `run()` returning 0.
- `tests/index.test.ts` ensures `run()` returns 0 using vitest.

**Step 6: Set up lint/format configs**
Add ESLint config (flat) enabling TypeScript plugin, Prettier compatibility. Add `.prettierrc` with 100-char print width.

**Step 7: Wire prek**
Add `scripts/run-prek-install.mjs` that invokes `npx prek install` when dependencies change; run `npm run prepare` once to install hooks.

**Step 8: Baseline build & tests**
Run sequentially inside /tmp/thread-snapshot-cli:
- `npm run lint`
- `npm run format`
- `npm run typecheck`
- `npm test`
- `npm run build`
All should pass with stub code.

**Step 9: Commit**
`git init && git add . && git commit -m "chore: scaffold project"`

---

### Task 2: Implement thread registry loader

**Files:**
- Modify: `src/index.ts`
- Create: `src/lib/registry.ts`
- Create: `tests/registry.test.ts`

**Step 1: Write failing tests**
In `tests/registry.test.ts`, cover:
- Loading `threads.json` with multiple entries filters by controller ID when provided.
- Missing file yields empty list.
- Entries missing required fields raise descriptive errors.
Run: `npm test -- registry.test.ts`
Expected: FAIL (module not implemented).

**Step 2: Implement registry reader**
`src/lib/registry.ts` exports `loadRegistry(root: string, controllerId?: string)` that reads JSON, validates shape `{thread_id, role, policy, status, controller_id}`, filters by controller when supplied, returns array sorted by `thread_id`.
Update `src/index.ts` to CLI skeleton calling `loadRegistry` (still stub output).

**Step 3: Re-run tests**
`npm test -- registry.test.ts` should PASS. Run full `npm test`, `npm run lint`, `npm run typecheck` to ensure clean.

**Step 4: Commit**
`git add src tests && git commit -m "feat: load subagent registry"`

---

### Task 3: Parse log files and compute summaries

**Files:**
- Create: `src/lib/log-reader.ts`
- Modify: `src/index.ts`
- Create: `tests/log-reader.test.ts`

**Step 1: Write failing tests**
Cover scenarios:
- When `.codex-subagent/logs/<thread>.ndjson` contains assistant messages, capture latest assistant content, timestamp, and detect `message.metadata.error === true`.
- If log missing, summary notes `missingLog: true`.
- Gracefully skip malformed JSON lines with warning flag.
Run targeted vitest to watch failure.

**Step 2: Implement log parsing**
`log-reader.ts` exports `summarizeLog(logPath: string)` returning `{ lastAssistantMessage: string | null, lastTimestamp: string | null, errored: boolean, missingLog: boolean, warnings: string[] }`.
Update `src/index.ts` to iterate registry entries, call `summarizeLog` per thread, build combined data structure.

**Step 3: Tests + lint**
`npm test -- log-reader.test.ts` should pass. Run full `npm test`, lint, typecheck.

**Step 4: Commit**
`git add src tests && git commit -m "feat: summarize thread logs"`

---

### Task 4: CLI presentation + UX polish

**Files:**
- Modify: `src/index.ts`
- Create: `src/cli.ts`
- Create: `tests/cli.test.ts`
- Update: `package.json` (set `bin` entry, `type: module`)
- Update: `README.md`

**Step 1: Define CLI behavior**
Test cases for CLI (using vitest + `execa`):
- Default `threads snapshot --root <path>` prints table with columns (Thread, Status, Role, Last Assistant, Last Timestamp, Flags).
- `--json` outputs machine-friendly JSON.
- `--controller-id` filters threads.
- Missing `.codex-subagent` yields helpful message and exit code 1.

**Step 2: Implement CLI**
`src/cli.ts` handles argument parsing, calls `loadRegistry` + `summarizeLog`, prints table (use `console.table` or manual formatting) and optional JSON.
`src/index.ts` exports library functions; `src/cli.ts` is entrypoint invoked via `bin` script that imports `runCli()`.

**Step 3: Build + package**
Update `package.json` `bin` to `"thread-snapshot": "dist/cli.js"`. Ensure tsup config bundles both `src/cli.ts` and `src/index.ts`. Run `npm run build`, then `node dist/cli.js --help` to verify.

**Step 4: Docs + README**
Add README describing usage, install (local npm link), example output screenshot text.

**Step 5: Verification suite**
Run `npm run format`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

**Step 6: Commit**
`git add . && git commit -m "feat: add CLI entrypoint"`

---

### Task 5: Integration smoke with sample data

**Files:**
- Create: `/tmp/thread-snapshot-cli/sample/.codex-subagent/state/threads.json`
- Create: `/tmp/thread-snapshot-cli/sample/.codex-subagent/logs/*.ndjson`
- Update: `README.md` (add real output snippet)

**Step 1: Generate sample data**
Create minimal registry/log files representing two threads (one running, one failed) following actual codex-subagent schema.

**Step 2: Run CLI**
`node dist/cli.js --root sample/.codex-subagent` to produce table; capture output for README snippet.

**Step 3: JSON mode**
`node dist/cli.js --root sample/.codex-subagent --json` should output valid JSON array; optionally pipe through `jq` to demonstrate.

**Step 4: Update README**
Embed sample outputs and document flags.

**Step 5: Final verification**
Full suite again + `npm pack` to ensure package tarball builds.

**Step 6: Commit**
`git add . && git commit -m "docs: add sample data and usage"`

---

### Task 6: Tag + share

**Files:**
- Create: `/tmp/thread-snapshot-cli/CHANGELOG.md`

**Step 1: Write changelog entry**
Document initial release features.

**Step 2: Tag**
`git tag v0.1.0`

**Step 3: Archive instructions**
In README, add section describing how to install from local path (`npm install -g /tmp/thread-snapshot-cli`).

**Step 4: Final verification**
`git status` should be clean, tests pass.

**Step 5: Optional publish (local)**
`npm pack` to ensure bundle portability.

**Outcome**: Ready-to-run CLI plus documentation to help Codex operators inspect subagent fleets quickly.
