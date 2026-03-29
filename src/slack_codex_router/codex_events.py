from __future__ import annotations

import json
from collections.abc import Iterable


def parse_event_lines(lines: Iterable[str]) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for line in lines:
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def extract_thread_id(events: list[dict[str, object]]) -> str | None:
    for event in events:
        if event.get("type") == "thread.started":
            thread_id = event.get("thread_id")
            if isinstance(thread_id, str):
                return thread_id
            return None
    return None
