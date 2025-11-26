from pathlib import Path

from codex_subagent.paths import Paths
from codex_subagent.registry import Registry

sample_thread = {
    "thread_id": "123",
    "role": "researcher",
    "status": "running",
    "title": "Exploratory thread",
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
    assert reg.get("123")
    assert reg.get("123")["role"] == "researcher"
    reg2 = Registry(paths.state_file)
    assert reg2.get("123")["status"] == "running"


def test_registry_returns_copy_when_mutated(tmp_path):
    paths = Paths(tmp_path / ".codex-subagent")
    paths.ensure()
    reg = Registry(paths.state_file)
    reg.upsert(sample_thread)
    fetched = reg.get("123")
    fetched["status"] = "stopped"
    assert reg.get("123")["status"] == "running"
    listed = reg.list_threads()
    listed[0]["role"] = "changed"
    assert reg.get("123")["role"] == "researcher"


def test_registry_handles_corrupt_files(tmp_path):
    paths = Paths(tmp_path / ".codex-subagent")
    paths.ensure()
    state_file = paths.state_file
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text("{not-json", encoding="utf-8")
    reg = Registry(state_file)
    assert reg.list_threads() == []


def test_registry_handles_oserror(monkeypatch, tmp_path):
    paths = Paths(tmp_path / ".codex-subagent")
    paths.ensure()
    state_file = paths.state_file
    state_file.write_text("{}", encoding="utf-8")
    real_open = Path.open

    def boom(self, *args, **kwargs):
        if self == state_file:
            raise OSError("boom")
        return real_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", boom)
    reg = Registry(state_file)
    assert reg.list_threads() == []
