# Codex Subagent CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide a CLI (`codex-subagent`) that launches, tracks, and interacts with Codex `exec` threads so the main agent can run asynchronous, sandboxed subagents without bloating the active context.

**Architecture:** A Python CLI (argparse + stdlib) stores thread metadata as JSON under `.codex-subagent/state` and conversation logs as newline-delimited JSON. Each command shells out to `codex exec --json --skip-git-repo-check ...` with explicit policy flags, parses the resulting JSON, and updates the registry. Commands remain thin wrappers so future automation layers can reuse the modules.

**Tech Stack:** Python 3.11+, `argparse`, `subprocess`, `json`, `pathlib`, `pytest` for tests, fixture files for mock `codex exec` output.

---

### Task 1: Project Scaffolding & Utilities

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

### Task 3: CLI Skeleton + `list` Command

**Files:**
- Create: `src/codex_subagent/cli.py`
- Modify: `pyproject.toml` (add entry point)
- Create: `tests/test_cli_list.py`

**Step 1: Write failing CLI test**

```python
# tests/test_cli_list.py
from pathlib import Path
from subprocess import run, PIPE

def test_list_shows_threads(tmp_path):
    state_dir = tmp_path / ".codex-subagent" / "state"
    state_dir.mkdir(parents=True)
    (state_dir / "threads.json").write_text(
        '{"abc":{"thread_id":"abc","role":"research","status":"running"}}'
    )
    result = run(
        ["python", "-m", "codex_subagent.cli", "list", f"--root={tmp_path / '.codex-subagent'}"],
        stdout=PIPE,
        text=True,
        check=False,
    )
    assert "abc" in result.stdout
```

**Step 2:** Run test, expect `ModuleNotFoundError`.

**Step 3: Implement CLI skeleton**

```python
# src/codex_subagent/cli.py
import argparse
from codex_subagent.paths import Paths
from codex_subagent.registry import Registry

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="codex-subagent")
    parser.add_argument("command", choices=["list"], help="Command to execute")
    parser.add_argument("--root", default=".codex-subagent", dest="root")
    return parser


def cmd_list(paths: Paths) -> None:
    reg = Registry(paths.state_file)
    for thread in reg.list_threads():
        print(f"{thread['thread_id']}\t{thread['role']}\t{thread.get('status','?')}")


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    paths = Paths(Path(args.root))
    paths.ensure()
    if args.command == "list":
        cmd_list(paths)

if __name__ == "__main__":
    main()
```

**Step 4:** `pytest tests/test_cli_list.py -q`

**Step 5:** `git add src/codex_subagent/cli.py tests/test_cli_list.py pyproject.toml && git commit -m "feat: add CLI list command"`

---

### Task 4: `start` Command (launch codex exec)

**Files:**
- Modify: `src/codex_subagent/cli.py`
- Create: `src/codex_subagent/exec_runner.py`
- Create: `tests/test_cli_start.py`
- Add fixture file: `tests/fixtures/exec_start.json`

**Step 1: Write failing test**

```python
# tests/test_cli_start.py
import json
from pathlib import Path
from subprocess import run, PIPE

FIXTURE = Path(__file__).parent / "fixtures" / "exec_start.json"


def test_start_records_thread(tmp_path, monkeypatch):
    (tmp_path / "fixtures").mkdir(exist_ok=True)

    def fake_run(cmd, capture_output, text, check):
        return subprocess.CompletedProcess(cmd, 0, FIXTURE.read_text(), "")

    monkeypatch.setattr(exec_runner, "run_exec", fake_run)

    result = run([...], stdout=PIPE, text=True)
    state = json.loads((tmp_path / ".codex-subagent/state/threads.json").read_text())
    assert state["thread-123"]["role"] == "researcher"
```

(Include actual argv invoking `start` with role + prompt.)

**Step 2:** Run test → FAIL because `start` not implemented.

**Step 3: Implement `exec_runner.run_exec` that shells out to `codex exec --json --skip-git-repo-check ...` and parse JSON. Update CLI to accept `start --role <role> --policy <policy> --output-last <file> --prompt "..."`.**

```python
# src/codex_subagent/exec_runner.py
import json
import subprocess
from pathlib import Path
from typing import Sequence

CMD_BASE = ["codex", "exec", "--json", "--skip-git-repo-check"]


def run_exec(prompt: str, extra_args: Sequence[str] = ()) -> dict:
    proc = subprocess.run(
        [*CMD_BASE, prompt, *extra_args], capture_output=True, text=True, check=True
    )
    return json.loads(proc.stdout)
```

CLI `start` subcommand parses fields, writes new thread entry `{thread_id, role, policy, status: "running", last_message_id}` and prints thread ID.

**Step 4:** `pytest tests/test_cli_start.py -q`

**Step 5:** Commit.

---

### Task 5: `send` + `pull` + Log Appends

**Files:**
- Modify: `src/codex_subagent/cli.py`
- Modify: `src/codex_subagent/registry.py` (add update helpers)
- Create: `tests/test_cli_send.py`, `tests/test_cli_pull.py`
- Add fixtures: `tests/fixtures/exec_resume_reply.json`

**Step 1:** Write failing send test verifying message appended to log file and registry `last_message_id` updated. Write failing pull test verifying command ignores unchanged message IDs.

**Step 2:** Run targeted pytest, expect FAIL.

**Step 3:** Implement send/pull commands.
- `send` loads thread, calls `exec_runner.run_exec(message, ["resume", thread_id])`, records assistant response in `.codex-subagent/logs/<thread>.ndjson`.
- `pull` call uses empty prompt (""), resume thread, compares response `message_id`. If new, append to log and update registry `last_message_id`.

**Step 4:** Rerun tests.

**Step 5:** Commit.

---

### Task 6: `show-log` Command & Smoke Test Script

**Files:**
- Modify: `src/codex_subagent/cli.py`
- Create: `tests/test_cli_show_log.py`
- Create: `scripts/demo_start_and_pull.sh`

**Step 1:** Write failing test verifying `show-log` prints NDJSON entries in order.

**Step 2:** Run pytest fail.

**Step 3:** Implement simple pretty-printer.

**Step 4:** Run `pytest` for new tests + `scripts/demo_start_and_pull.sh` (manual) to exercise real `codex exec` call with harmless prompt `"What's 2+2?"`.

**Step 5:** Commit.

---

### Task 7: Documentation & README

**Files:**
- Create: `README.md`
- Create: `docs/codex-subagent-workflow.md`

**Step 1:** Document usage scenarios, mention guardrails (never "allow everything").

**Step 2:** `git add README.md docs/codex-subagent-workflow.md && git commit -m "docs: outline codex-subagent workflow"`

---

### Verification & Next Steps

1. Run `pytest -q` (expect all green).
2. Run `codex-subagent start --role researcher --policy research-readonly --prompt "Look up the latest AI safety report."` (manual) then `pull` to ensure logging works. Capture outputs for later PR.
3. Tag todo items for polishing (watch mode, multi-agent dashboards) but keep MVP focused.
