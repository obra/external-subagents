from __future__ import annotations

import copy
import json
import os
import tempfile
from pathlib import Path
from typing import Dict, List, Optional


class RegistryLoadError(RuntimeError):
    """Raised when the registry cannot be loaded safely from disk."""


class Registry:
    def __init__(self, state_file: Path) -> None:
        self.state_file = Path(state_file)
        self._threads: Dict[str, dict] = {}
        self._load()

    def list_threads(self) -> List[dict]:
        return [copy.deepcopy(thread) for thread in self._threads.values()]

    def get(self, thread_id: str) -> Optional[dict]:
        found = self._threads.get(str(thread_id))
        if found is None:
            return None
        return copy.deepcopy(found)

    def upsert(self, thread: Dict[str, object]) -> None:
        thread_id = thread.get("thread_id")
        if not thread_id:
            raise ValueError("Thread must include a thread_id")
        self._threads[str(thread_id)] = copy.deepcopy(thread)
        self._persist()

    def _load(self) -> None:
        if not self.state_file.exists():
            self._threads = {}
            return
        try:
            with self.state_file.open("r", encoding="utf-8") as handle:
                raw = handle.read().strip()
                if not raw:
                    self._threads = {}
                    return
                data = json.loads(raw)
        except FileNotFoundError:
            self._threads = {}
            return
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RegistryLoadError(
                f"Failed to load registry from {self.state_file}: {exc}"
            ) from exc
        if not isinstance(data, dict):
            self._threads = {}
            return
        self._threads = {str(key): value for key, value in data.items()}

    def _persist(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            dir=self.state_file.parent,
            prefix=f".{self.state_file.name}.",
            suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(self._threads, handle, indent=2, sort_keys=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_path, self.state_file)
            dir_fd = None
            directory_flag = getattr(os, "O_DIRECTORY", None)
            if directory_flag is not None:
                try:
                    dir_fd = os.open(self.state_file.parent, directory_flag)
                    os.fsync(dir_fd)
                except OSError:
                    pass
                finally:
                    if dir_fd is not None:
                        os.close(dir_fd)
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
