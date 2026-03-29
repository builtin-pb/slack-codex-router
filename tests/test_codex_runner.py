from pathlib import Path

from slack_codex_router.codex_runner import build_exec_command, build_resume_command


def test_build_exec_command_includes_json_and_output_file(tmp_path: Path) -> None:
    output_file = tmp_path / "last.txt"
    command = build_exec_command("Reply with READY.", output_file)
    assert command == [
        "codex",
        "exec",
        "--json",
        "--output-last-message",
        str(output_file),
        "Reply with READY.",
    ]


def test_build_resume_command_places_session_id_before_prompt(tmp_path: Path) -> None:
    output_file = tmp_path / "last.txt"
    command = build_resume_command("019d38b3-48fe-7790-a2e3-d9a5f81b450a", "status", output_file)
    assert command == [
        "codex",
        "exec",
        "resume",
        "--json",
        "--output-last-message",
        str(output_file),
        "019d38b3-48fe-7790-a2e3-d9a5f81b450a",
        "status",
    ]
