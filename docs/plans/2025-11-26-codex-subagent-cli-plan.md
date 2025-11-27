# Codex Subagent CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide a CLI (`codex-subagent`) that launches, tracks, and interacts with Codex `exec` threads so the main agent can run asynchronous, sandboxed subagents without bloating the active context.

**Architecture:** A TypeScript CLI (Node 20+, bundled via `tsup` into a single executable JS file) stores thread metadata as JSON under `.codex-subagent/state` and conversation logs as newline-delimited JSON. Each command shells out to `codex exec --json --skip-git-repo-check ...` with explicit policy flags, parses the resulting JSON, and updates the registry. Commands remain thin wrappers so future automation layers can reuse the modules. Distribution is via `npm` scripts with lint/format/test automation and `prek` enforced pre-commit checks.

**Tech Stack:** TypeScript 5.x, Node 20+, `tsup` for bundling, `eslint` + `@typescript-eslint`, `prettier`, `vitest` for unit tests, `tsx` for local dev, `npm` as the package manager, and `prek` for lint/test/format enforcement.

---

## Current State (2025-11-26)

- Python scaffolding (`Paths`, `Registry`, pytest coverage) is merged and green under `pytest -q`.
- TypeScript toolchain (Node 20+, npm, tsup bundle, Vitest, ESLint flat config, Prettier, `prek`) is wired with passing `npm run format:fix && npm run lint && npm run typecheck && npm run test`.
- CLI entry (`codex-subagent`) currently exposes only the `list` command; it lists threads without mutating state and surfaces registry errors to stderr.
- CLI entry (`codex-subagent`) now includes `start`, `send`, `peek`, and `log`; stateful commands validate metadata, stream logs as NDJSON, and forbid "allow everything" policies.
- CLI entry (`codex-subagent`) now includes `start`, `send`, `peek`, `log`, and `watch`; stateful commands validate metadata, stream logs as NDJSON, tag threads with a controller ID, and forbid "allow everything" policies.
- Registry/paths helpers never create directories on read, use atomic writes, and protect against malformed JSON (raising `RegistryLoadError`).
- Manual dry runs of `codex exec` informed the need for prompt files, bootstrap hints, and immediate thread ID tracking; these requirements feed directly into Task 4.

---

### Task 1: Project Scaffolding & Utilities

**Status (2025-11-26):** ✅ Completed. Python scaffolding (pyproject + `Paths` helper + first pytest) is in `main`; tests pass via `pytest tests/test_paths.py -q`.

**Files:**

- Create: `pyproject.toml`
- Create: `src/codex_subagent/__init__.py`
- Create: `src/codex_subagent/paths.py`
- Create: `tests/test_paths.py`

**Step 1: Write the failing test**

```python
# tests/test_paths.py
from codex_subagent.paths import Paths

def test_paths_create_directories(tmp_path):
    base = tmp_path / ".codex-subagent"
    paths = Paths(base)
    paths.ensure()
    assert (base / "state").is_dir()
    assert (base / "logs").is_dir()
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_paths.py -q`
Expected: FAIL because `Paths` missing.

**Step 3: Write minimal implementation**

```python
# src/codex_subagent/paths.py
from dataclasses import dataclass
from pathlib import Path

@dataclass
class Paths:
    root: Path

    @property
    def state_file(self) -> Path:
        return self.root / "state" / "threads.json"

    def ensure(self) -> None:
        (self.root / "state").mkdir(parents=True, exist_ok=True)
        (self.root / "logs").mkdir(parents=True, exist_ok=True)
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_paths.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add pyproject.toml src/codex_subagent tests/test_paths.py
git commit -m "chore: scaffold codex-subagent project"
```

**Field notes after manual subagent dry run**

- Every fresh `codex exec` thread immediately asked for bootstrap + plan context. Future commands (Task 4 onward) MUST package the relevant task snippet automatically so subagents can act without extra clarification.
- Inline prompts with quotes/backticks confused the shell. The CLI should always write prompt bodies to a temp file (or equivalent) before invoking `codex exec` to prevent glob/quote issues.
- We need to pass an explicit “bootstrap already satisfied” hint inside the prompt to keep subagents from re-running it every turn.
- Thread IDs are unwieldy to juggle manually; when Task 4 stores metadata it should record thread IDs immediately and allow follow-up commands to default to the most recent thread unless overridden.

---

### Task 2: Thread Registry Module

**Status (2025-11-26):** ✅ Completed with hardened loader/upsert semantics. Python registry now raises `RegistryLoadError` for malformed JSON, deep-copies thread metadata, and enforces `thread_id`. Verified by `pytest tests/test_registry.py -q` plus follow-up safety tests.

**Files:**

- Create: `src/codex_subagent/registry.py`
- Create: `tests/test_registry.py`

**Step 1: Write failing tests**

```python
# tests/test_registry.py
from codex_subagent.registry import Registry
from codex_subagent.paths import Paths

sample_thread = {
    "thread_id": "123",
    "role": "researcher",
    "policy": "research-readonly",
    "status": "running",
}


def test_registry_loads_blank_file(tmp_path, monkeypatch):
    paths = Paths(tmp_path / ".codex-subagent")
    paths.ensure()
    reg = Registry(paths.state_file)
    assert reg.list_threads() == []


def test_registry_upsert_and_persist(tmp_path):
    paths = Paths(tmp_path / ".codex-subagent")
    paths.ensure()
    reg = Registry(paths.state_file)
    reg.upsert(sample_thread)
    assert reg.get("123")["role"] == "researcher"
    reg2 = Registry(paths.state_file)
    assert reg2.get("123")["status"] == "running"
```

**Step 2:** `pytest tests/test_registry.py -q` → FAIL (Registry missing).

**Step 3: Implement minimal code**

```python
# src/codex_subagent/registry.py
import json
from pathlib import Path
from typing import Dict, List

class Registry:
    def __init__(self, state_file: Path):
        self.state_file = state_file
        self._data = self._load()

    def _load(self) -> Dict[str, Dict]:
        if not self.state_file.exists():
            return {}
        return json.loads(self.state_file.read_text() or "{}")

    def _save(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.state_file.write_text(json.dumps(self._data, indent=2))

    def upsert(self, thread: Dict) -> None:
        self._data[thread["thread_id"]] = thread
        self._save()

    def get(self, thread_id: str) -> Dict | None:
        return self._data.get(thread_id)

    def list_threads(self) -> List[Dict]:
        return list(self._data.values())
```

**Step 4:** `pytest tests/test_registry.py -q` → PASS.

**Step 5:** `git add src/codex_subagent/registry.py tests/test_registry.py && git commit -m "feat: add registry persistence"`

---

### Task 3: TypeScript Project Scaffolding & `list` CLI Skeleton

**Status (2025-11-26):** ✅ Completed on branch `t1-paths-scaffolding` (commits `4511ad5` + `d0ab456`). Node/TS toolchain (npm scripts, tsup bundle, vitest, ESLint flat config, Prettier, `.prek.toml`) is live. TS ports for `Paths`/`Registry`, CLI entry (`codex-subagent`) and the `list` command ship with Vitest coverage (`tests/list-command.test.ts`, `tests/registry.test.ts`). Latest verification:

```
npm run format:fix
npm run lint
npm run typecheck
npm run test
```

All succeed under Node 24.8 / npm 11.6.

**Files:**

- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`
- Create: `src/bin/codex-subagent.ts` (entrypoint)
- Create: `src/lib/paths.ts`, `src/lib/registry.ts` (TypeScript ports of existing logic)
- Create: `src/commands/list.ts`
- Create: `tests/list-command.test.ts` (vitest)
- Config: `.eslintrc.cjs`, `.prettierrc`, `.npmrc`, `.editorconfig`
- Pre-commit: `.prek.toml`

**Step 1:** Initialize `package.json` via `npm init -y`, then edit to add scripts:

```json
{
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/bin/codex-subagent.ts",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --check .",
    "format:fix": "prettier --write .",
    "test": "vitest",
    "typecheck": "tsc --noEmit",
    "prepare": "prek install"
  },
  "type": "module"
}
```

**Step 2:** Install dev deps with npm: `npm install --save-dev typescript tsup tsx vitest @vitest/coverage-istanbul eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier eslint-config-prettier eslint-plugin-jest npm-run-all chokidar prek`. Also install runtime deps if needed (`npm install execa fs-extra zod` as we add features).

**Step 3:** Add `tsconfig.json` targeting Node 20 (`moduleResolution": "nodeNext"`, `rootDir": "src"`, `outDir": "dist"`). Configure `tsup.config.ts` for single-file CLI bundle with shebang, externalizing `node_modules`.

**Step 4:** Port `Paths`/`Registry` helpers into TypeScript (`src/lib/paths.ts`, `src/lib/registry.ts`) mirroring the Python behavior (include unit tests later). Add `src/bin/codex-subagent.ts` that wires `commander`-style manual parsing (or minimal custom parser) but for now only supports `list` command delegating to `src/commands/list.ts`.

**Step 5:** Write `tests/list-command.test.ts` using vitest + temp dirs to assert `list` prints thread IDs from `.codex-subagent/state/threads.json`. Run `npm run test` (expect failure until implementation done), implement command, rerun expecting pass.

**Step 6:** Configure ESLint, Prettier, and `prek` (`.prek.toml` referencing `npm run lint`, `npm run format`, `npm run test`, `npm run typecheck`). Add `npm run format:fix` to format code before first commit. Commit scaffolding.

---

### Task 4: `start` Command + Exec Runner (TypeScript)

**Status (2025-11-26):** ✅ Completed – `start` now shells through `execRunner` (execa) with NDJSON logging, registry upsert, and CLI flag parsing for role/policy/prompt/output.

**Latest verification (2025-11-26 15:25 local):**

```
npm run format:fix
npm run lint
npm run typecheck
npm run test
```

**Files:**

- Modify: `src/bin/codex-subagent.ts`
- Create: `src/lib/exec-runner.ts`
- Create: `tests/start-command.test.ts`
- Fixtures: `tests/fixtures/exec-start.json`

**Step 1:** Write vitest covering `codex-subagent start --role researcher --policy research-readonly --prompt-file prompt.txt --output-last message.txt`, stubbing `execRunner.runExec` to return fixture JSON. Assert registry updated + log file path stored.

**Step 2:** Implement `execRunner` using `execa` to call `codex exec --json --skip-git-repo-check ...`, returning parsed JSON + capturing `thread_id`. Ensure prompts are read from files (per earlier pain point). Add `--no-bootstrap-needed` hint to prompt body.

**Step 3:** Update CLI to support `start` flags, including defaulting `--root` to `.codex-subagent`, writing logs/registry via TS helpers, printing assigned thread ID.

**Step 4:** `npm run test -- start-command.test.ts` (fail → implement → pass). Lint + typecheck. Commit.

---

### Task 5: `send`, `peek`, and `log` Commands with Logging

**Status (2025-11-26):** ✅ Completed – `start`/`send` share the exec runner, append NDJSON logs, and keep `last_message_id` in sync via a new `Registry.updateThread` helper. Manual smoke (2025-11-26 15:45 local) confirmed `start`/`send` flows work end-to-end against the real Codex CLI. The read-only side is now split into:

- `peek` (new name for the earlier `pull` concept) which only surfaces the newest unseen assistant message for a thread, writes it to `--output-last`, prints “No updates …” when nothing changed, and never resumes Codex. Registry tracks `last_pulled_id` (aka `last_peeked_id`) per thread so repeated peeks stay O(1).
- `log` (planned follow-up) that prints NDJSON history with filters (`--tail`, `--since`, `--raw`). Unlike `peek`, it doesn’t touch registry state.

We still have the option to add a future `poll` command if Codex ever supports a true “resume-without-prompt” flow.

**Files:**

- Modify: `src/bin/codex-subagent.ts`
- Add: `src/commands/send.ts`, `src/commands/peek.ts`, `src/commands/log.ts`
- Add tests: `tests/send-command.test.ts`, `tests/peek-command.test.ts`, `tests/log-command.test.ts`
- Add fixtures for resume responses.

**Step 1:** Write failing tests verifying `send` appends NDJSON to `logs/<thread>.ndjson` and updates `last_message_id`. `peek` should read the existing log and surface only the latest unseen assistant message, updating `last_pulled_id`, while `log` streams formatted or raw history (`--tail`, `--raw`).

**Step 2:** Implement send/peek/log commands. `send` continues to invoke `execRunner.runExec` with `resume <thread>`. `peek` and `log` never hit Codex—they strictly read the NDJSON log and registry state, keeping output focused and reproducible.

**Step 3:** Expand `Registry` TS module with `updateThread` helper (mirroring Python behavior). Rerun targeted tests, plus `npm run lint` and `npm run typecheck`. Commit once green.

---

### Task 6: Watch Mode + Demo Script

**Status (2025-11-26):** ✅ Completed – `watch` reuses `peek` in a loop with abort-safe intervals, plus `scripts/demo-watch.ts` (`npm run demo`) to exercise start+watch end to end.

**Files:**

- Add `src/commands/watch.ts`
- Tests: `tests/watch-command.test.ts`
- Scripts: `scripts/demo-watch.ts`, `scripts/demo-watch-prompt.txt` + `npm run demo`

**Step 1:** Write vitest ensuring `watch` polls `peek`-style output on an interval (fake timers/mocks), respects ctrl-c, and supports `--tail`/`--since` options for initial display.

**Step 2:** Implement the `watch` command, reusing `peek` logic without spamming Codex, and add a demo script that spawns a harmless thread then tails updates via `watch`.

**Step 3:** Wire the demo into package.json (`npm run demo`) and document expected output.

---

### Task 7: Documentation, npm Scripts, and Verification

**Status (2025-11-26):** ⏳ In progress – README + workflow doc drafted; final manual smoke + polish pending.

**Files:**

- Update `README.md` with install/build/test instructions, CLI usage examples, and policies about never using “allow everything.”
- Add `docs/codex-subagent-workflow.md` describing async subagent lifecycle.
- Ensure `package-lock.json` committed.

**Step 1:** Document standard flows (start/send/peek/log/watch), mention `--output-last-message`, `--policy` presets, and `npm run lint/test/format` expectations.

**Step 2:** Run `npm run format:fix && npm run lint && npm run typecheck && npm run test`. Update `README` with verification output snippet.

**Step 3:** Commit docs + lockfile. Plan for integration into upstream superpowers repo.

---

### Verification & Next Steps

1. Run `npm run lint && npm run typecheck && npm run test && npm run build`.
2. Execute manual smoke: `node dist/codex-subagent.js start ...` followed by `node dist/codex-subagent.js list/peek/log` against a test thread; capture outputs for future PR.
3. Tag future enhancements (multi-thread dashboards, JSON export) but keep MVP lean.
