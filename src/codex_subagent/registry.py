from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional


class Registry:
    def __init__(self, state_file: Path) -> None:
        self.state_file = Path(state_file)
        self._threads: Dict[str, dict] = {}
        self._load()

    def list_threads(self) -> List[dict]:
        return list(self._threads.values())

    def get(self, thread_id: str) -> Optional[dict]:
        return self._threads.get(str(thread_id))

    def upsert(self, thread: Dict[str, object]) -> None:
        thread_id = thread.get("thread_id")
        if not thread_id:
            raise ValueError("Thread must include a thread_id")
        self._threads[str(thread_id)] = dict(thread)
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
        except json.JSONDecodeError:
            self._threads = {}
            return
        if not isinstance(data, dict):
            self._threads = {}
            return
        self._threads = {str(key): value for key, value in data.items()}

    def _persist(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with self.state_file.open("w", encoding="utf-8") as handle:
            json.dump(self._threads, handle, indent=2, sort_keys=True)
