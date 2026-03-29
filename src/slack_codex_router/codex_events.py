from __future__ import annotations

import json
from collections.abc import Iterable


def parse_event_lines(lines: Iterable[str]) -> list[dict[str, object]]:
    return [json.loads(line) for line in lines if line.strip()]


def extract_thread_id(events: list[dict[str, object]]) -> str | None:
    for event in events:
        if event.get("type") == "thread.started":
            thread_id = event.get("thread_id")
            return str(thread_id) if thread_id is not None else None
    return None
