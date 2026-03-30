from __future__ import annotations

import select
import signal
import subprocess
import time
from dataclasses import dataclass
from io import TextIOBase
from pathlib import Path
from uuid import uuid4

from slack_codex_router.codex_events import extract_thread_id, parse_event_lines


@dataclass
class CodexRun:
    thread_id: str
    pid: int
    process: subprocess.Popen[str]
    output_file: Path
    log_path: Path


def _build_image_args(image_paths: tuple[Path, ...] | list[Path]) -> list[str]:
    args: list[str] = []
    for image_path in image_paths:
        args.extend(["-i", str(image_path)])
    return args


def build_exec_command(
    prompt: str,
    output_file: Path,
    *,
    image_paths: tuple[Path, ...] | list[Path] = (),
) -> list[str]:
    command = [
        "codex",
        "exec",
        "--json",
    ]
    command.extend(_build_image_args(image_paths))
    command.extend([
        "--output-last-message",
        str(output_file),
    ])
    command.append(prompt)
    return command


def build_resume_command(
    session_id: str,
    prompt: str,
    output_file: Path,
    *,
    image_paths: tuple[Path, ...] | list[Path] = (),
) -> list[str]:
    command = [
        "codex",
        "exec",
        "resume",
        "--json",
    ]
    command.extend(_build_image_args(image_paths))
    command.extend([
        "--output-last-message",
        str(output_file),
    ])
    command.extend([session_id, prompt])
    return command


class CodexRunner:
    def __init__(
        self,
        *,
        artifact_dir: str = "logs/codex-runs",
        output_file_name: str = "codex-last.txt",
        log_file_name: str = "codex-run.log",
        thread_id_timeout_seconds: float = 5.0,
    ) -> None:
        self._artifact_dir = Path(artifact_dir)
        self._output_file_name = output_file_name
        self._log_file_name = log_file_name
        self._thread_id_timeout_seconds = thread_id_timeout_seconds

    def start(
        self,
        project_path: Path,
        prompt: str,
        *,
        image_paths: tuple[Path, ...] | list[Path] = (),
    ) -> CodexRun:
        output_file, log_path = self._allocate_run_paths(project_path)
        return self._launch(
            project_path,
            build_exec_command(prompt, output_file, image_paths=image_paths),
            output_file,
            log_path,
        )

    def resume(
        self,
        project_path: Path,
        session_id: str,
        prompt: str,
        *,
        image_paths: tuple[Path, ...] | list[Path] = (),
    ) -> CodexRun:
        output_file, log_path = self._allocate_run_paths(project_path)
        return self._launch(
            project_path,
            build_resume_command(session_id, prompt, output_file, image_paths=image_paths),
            output_file,
            log_path,
            default_thread_id=session_id,
        )

    def interrupt(self, run: CodexRun) -> None:
        if run.process.poll() is not None:
            return
        try:
            run.process.send_signal(signal.SIGINT)
        except ProcessLookupError:
            return

    def stop(self, run: CodexRun, timeout_seconds: float = 5.0) -> bool:
        if run.process.poll() is not None:
            self._drain_remaining_output(run)
            return True

        deadline = time.monotonic() + max(timeout_seconds, 0.0)
        self.interrupt(run)
        if self._wait_for_exit(run.process, timeout_seconds=self._remaining_timeout(deadline)):
            self._drain_remaining_output(run)
            return True

        try:
            run.process.terminate()
        except ProcessLookupError:
            return self._drain_if_exited(run)

        if self._wait_for_exit(run.process, timeout_seconds=self._remaining_timeout(deadline)):
            self._drain_remaining_output(run)
            return True

        try:
            run.process.kill()
        except ProcessLookupError:
            return self._drain_if_exited(run)

        if self._wait_for_exit(run.process, timeout_seconds=self._remaining_timeout(deadline)):
            self._drain_remaining_output(run)
            return True
        return False

    def wait(self, run: CodexRun, timeout_seconds: int) -> tuple[int, str]:
        deadline = time.monotonic() + timeout_seconds
        stdout = run.process.stdout

        while run.process.poll() is None:
            if stdout is not None:
                ready_lines = self._read_ready_lines(stdout, timeout_seconds=0.05)
                if ready_lines:
                    self._append_log_lines(run.log_path, ready_lines)

            if time.monotonic() >= deadline:
                self._stop_timed_out_process(run)
                return (124, "Codex run timed out before completion.")

        self._drain_remaining_output(run)
        exit_code = run.process.wait()
        summary = ""
        if run.output_file.exists():
            summary = run.output_file.read_text(encoding="utf-8")
        return (exit_code, summary)

    def _launch(
        self,
        project_path: Path,
        command: list[str],
        output_file: Path,
        log_path: Path,
        *,
        default_thread_id: str | None = None,
    ) -> CodexRun:
        process = self._spawn(project_path, command, log_path)
        provisional_run = CodexRun(
            thread_id=default_thread_id or "",
            pid=process.pid,
            process=process,
            output_file=output_file,
            log_path=log_path,
        )
        try:
            thread_id = self._wait_for_thread_id(log_path, process, default_thread_id=default_thread_id)
        except Exception:
            try:
                self.stop(provisional_run)
            except Exception:
                pass
            raise
        return CodexRun(
            thread_id=thread_id,
            pid=process.pid,
            process=process,
            output_file=output_file,
            log_path=log_path,
        )

    def _allocate_run_paths(self, project_path: Path) -> tuple[Path, Path]:
        run_id = uuid4().hex
        artifact_root = project_path / self._artifact_dir
        return (
            artifact_root / self._build_artifact_name(self._output_file_name, run_id),
            artifact_root / self._build_artifact_name(self._log_file_name, run_id),
        )

    def _spawn(self, project_path: Path, command: list[str], log_path: Path) -> subprocess.Popen[str]:
        project_path.mkdir(parents=True, exist_ok=True)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("", encoding="utf-8")
        return subprocess.Popen(
            command,
            cwd=project_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

    def _wait_for_thread_id(
        self,
        log_path: Path,
        process: subprocess.Popen[str],
        *,
        default_thread_id: str | None = None,
    ) -> str:
        deadline = time.monotonic() + self._thread_id_timeout_seconds
        captured_lines: list[str] = []
        stdout = process.stdout

        while time.monotonic() < deadline:
            if stdout is not None:
                ready_lines = self._read_ready_lines(stdout, timeout_seconds=0.05)
                if ready_lines:
                    self._append_log_lines(log_path, ready_lines)
                    captured_lines.extend(line.rstrip("\n") for line in ready_lines)

            if captured_lines:
                events = parse_event_lines(captured_lines)
                thread_id = extract_thread_id(events)
                if thread_id is not None:
                    return thread_id

            if default_thread_id is not None:
                return default_thread_id

            if process.poll() is not None:
                break

        if stdout is not None and process.poll() is not None:
            remaining_output = stdout.read()
            if remaining_output:
                remaining_lines = remaining_output.splitlines()
                self._append_log_lines(log_path, [f"{line}\n" for line in remaining_lines])
                captured_lines.extend(remaining_lines)

        if captured_lines:
            events = parse_event_lines(captured_lines)
            thread_id = extract_thread_id(events)
            if thread_id is not None:
                return thread_id

        raise RuntimeError(f"Timed out waiting for Codex thread id in {log_path}")

    def _append_log_lines(self, log_path: Path, lines: list[str]) -> None:
        with log_path.open("a", encoding="utf-8") as handle:
            handle.writelines(lines)

    def _stop_timed_out_process(self, run: CodexRun) -> bool:
        return self.stop(run, timeout_seconds=3.0)

    def _drain_remaining_output(self, run: CodexRun) -> None:
        stdout = run.process.stdout
        if stdout is None:
            return

        tail = stdout.read()
        if not tail:
            return

        lines = tail.splitlines(keepends=True)
        if tail and not tail.endswith("\n"):
            lines = tail.splitlines(keepends=True)
        self._append_log_lines(run.log_path, lines)

    def _wait_for_exit(self, process: subprocess.Popen[str], *, timeout_seconds: float) -> bool:
        try:
            process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            return False
        return True

    def _drain_if_exited(self, run: CodexRun) -> bool:
        if run.process.poll() is None:
            return False
        self._drain_remaining_output(run)
        return True

    def _remaining_timeout(self, deadline: float) -> float:
        return max(0.0, deadline - time.monotonic())

    def _build_artifact_name(self, base_name: str, run_id: str) -> str:
        path = Path(base_name)
        suffix = "".join(path.suffixes)
        stem = base_name[: -len(suffix)] if suffix else base_name
        return f"{stem}-{run_id}{suffix}"

    def _read_ready_lines(self, stream: TextIOBase, *, timeout_seconds: float) -> list[str]:
        lines: list[str] = []
        ready, _, _ = select.select([stream], [], [], timeout_seconds)
        while ready:
            line = stream.readline()
            if line == "":
                break
            lines.append(line)
            ready, _, _ = select.select([stream], [], [], 0)
        return lines
