from pathlib import Path

from slack_codex_router.codex_events import extract_thread_id, parse_event_lines


def test_extract_thread_id_from_exec_jsonl_fixture() -> None:
    fixture = Path("tests/fixtures/codex_exec_sample.jsonl")
    events = parse_event_lines(fixture.read_text(encoding="utf-8").splitlines())

    assert extract_thread_id(events) == "019d38b3-48fe-7790-a2e3-d9a5f81b450a"


def test_parse_event_lines_ignores_blank_and_malformed_lines() -> None:
    events = parse_event_lines(["", "not json", '{"type":"thread.started"}', "[1, 2, 3]"])

    assert events == [{"type": "thread.started"}]


def test_extract_thread_id_returns_none_when_thread_started_is_missing() -> None:
    events = parse_event_lines(['{"type":"turn.started"}'])

    assert extract_thread_id(events) is None


def test_extract_thread_id_returns_none_for_non_string_thread_id() -> None:
    events = parse_event_lines(['{"type":"thread.started","thread_id":123}'])

    assert extract_thread_id(events) is None
