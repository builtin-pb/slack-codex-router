from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class ProjectConfig:
    channel_id: str
    name: str
    path: Path
    max_concurrent_jobs: int


class ProjectRegistry:
    def __init__(self, projects: dict[str, ProjectConfig]) -> None:
        self._projects = projects

    @classmethod
    def from_yaml(cls, path: Path) -> "ProjectRegistry":
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        projects = {
            item["channel_id"]: ProjectConfig(
                channel_id=item["channel_id"],
                name=item["name"],
                path=Path(item["path"]),
                max_concurrent_jobs=item.get("max_concurrent_jobs", 2),
            )
            for item in raw.get("projects", [])
        }
        return cls(projects)

    def by_channel(self, channel_id: str) -> ProjectConfig | None:
        return self._projects.get(channel_id)
