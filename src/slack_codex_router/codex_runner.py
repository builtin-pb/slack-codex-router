from __future__ import annotations

import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from slack_codex_router.codex_events import extract_thread_id, parse_event_lines


@dataclass
class CodexRun:
    thread_id: str
    pid: int
    process: subprocess.Popen[str]
    output_file: Path
    log_path: Path


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


class CodexRunner:
    def __init__(
        self,
        *,
        output_file_name: str = ".codex-last.txt",
        log_file_name: str = ".codex-run.log",
        thread_id_timeout_seconds: float = 5.0,
    ) -> None:
        self._output_file_name = output_file_name
        self._log_file_name = log_file_name
        self._thread_id_timeout_seconds = thread_id_timeout_seconds

    def start(self, project_path: Path, prompt: str) -> CodexRun:
        output_file = project_path / self._output_file_name
        log_path = project_path / self._log_file_name
        process = self._spawn(project_path, build_exec_command(prompt, output_file), log_path)
        thread_id = self._wait_for_thread_id(log_path, process)
        return CodexRun(
            thread_id=thread_id,
            pid=process.pid,
            process=process,
            output_file=output_file,
            log_path=log_path,
        )

    def resume(self, project_path: Path, session_id: str, prompt: str) -> CodexRun:
        output_file = project_path / self._output_file_name
        log_path = project_path / self._log_file_name
        process = self._spawn(project_path, build_resume_command(session_id, prompt, output_file), log_path)
        return CodexRun(
            thread_id=session_id,
            pid=process.pid,
            process=process,
            output_file=output_file,
            log_path=log_path,
        )

    def interrupt(self, run: CodexRun) -> None:
        if run.process.poll() is not None:
            return
        try:
            run.process.send_signal(signal.SIGINT)
        except ProcessLookupError:
            return

    def _spawn(self, project_path: Path, command: list[str], log_path: Path) -> subprocess.Popen[str]:
        project_path.mkdir(parents=True, exist_ok=True)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_handle = log_path.open("w", encoding="utf-8")
        try:
            return subprocess.Popen(
                command,
                cwd=project_path,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                text=True,
            )
        finally:
            log_handle.close()

    def _wait_for_thread_id(self, log_path: Path, process: subprocess.Popen[str]) -> str:
        deadline = time.monotonic() + self._thread_id_timeout_seconds
        while time.monotonic() < deadline:
            if log_path.exists():
                events = parse_event_lines(log_path.read_text(encoding="utf-8").splitlines())
                thread_id = extract_thread_id(events)
                if thread_id is not None:
                    return thread_id
            if process.poll() is not None:
                break
            time.sleep(0.05)

        if log_path.exists():
            events = parse_event_lines(log_path.read_text(encoding="utf-8").splitlines())
            thread_id = extract_thread_id(events)
            if thread_id is not None:
                return thread_id

        raise RuntimeError(f"Timed out waiting for Codex thread id in {log_path}")
