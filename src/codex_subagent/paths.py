from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class Paths:
    root: Path

    def __post_init__(self) -> None:
        if not isinstance(self.root, Path):
            self.root = Path(self.root)

    @property
    def state_file(self) -> Path:
        return self.root / "state" / "threads.json"

    def ensure(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "state").mkdir(parents=True, exist_ok=True)
        (self.root / "logs").mkdir(parents=True, exist_ok=True)
