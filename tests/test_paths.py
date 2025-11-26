from codex_subagent.paths import Paths


def test_paths_create_directories(tmp_path):
    base = tmp_path / ".codex-subagent"
    paths = Paths(base)
    paths.ensure()
    assert (base / "state").is_dir()
    assert (base / "logs").is_dir()
