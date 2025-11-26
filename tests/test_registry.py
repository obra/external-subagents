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
