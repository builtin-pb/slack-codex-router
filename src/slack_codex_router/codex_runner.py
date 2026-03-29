from __future__ import annotations

from pathlib import Path


def build_exec_command(prompt: str, output_file: Path) -> list[str]:
    return [
        "codex",
        "exec",
        "--json",
        "--output-last-message",
        str(output_file),
        prompt,
    ]


def build_resume_command(session_id: str, prompt: str, output_file: Path) -> list[str]:
    return [
        "codex",
        "exec",
        "resume",
        "--json",
        "--output-last-message",
        str(output_file),
        session_id,
        prompt,
    ]
