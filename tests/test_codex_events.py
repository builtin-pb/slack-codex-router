from pathlib import Path

from slack_codex_router.codex_events import extract_thread_id, parse_event_lines


def test_extract_thread_id_from_exec_jsonl_fixture() -> None:
    fixture = Path("tests/fixtures/codex_exec_sample.jsonl")
    events = parse_event_lines(fixture.read_text(encoding="utf-8").splitlines())

    assert extract_thread_id(events) == "019d38b3-48fe-7790-a2e3-d9a5f81b450a"
