import io
import signal
import subprocess
from pathlib import Path

import pytest

from slack_codex_router.codex_runner import CodexRun, CodexRunner, build_exec_command, build_resume_command


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


class FakeLaunchProcess:
    def __init__(self, pid: int) -> None:
        self.pid = pid
        self.stdout = io.StringIO("")

    def poll(self) -> int | None:
        return None


def test_start_stops_spawned_child_when_thread_id_discovery_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    process = FakeLaunchProcess(pid=9876)
    stop_calls: list[tuple[CodexRun, float]] = []

    monkeypatch.setattr(runner, "_spawn", lambda project_path, command, log_path: process)

    def fail_wait_for_thread_id(log_path: Path, proc: FakeLaunchProcess, default_thread_id: str | None = None) -> str:
        del log_path, default_thread_id
        assert proc is process
        raise RuntimeError("Timed out waiting for Codex thread id")

    monkeypatch.setattr(runner, "_wait_for_thread_id", fail_wait_for_thread_id)
    monkeypatch.setattr(
        runner,
        "stop",
        lambda run, timeout_seconds=5.0: stop_calls.append((run, timeout_seconds)) or True,
    )

    with pytest.raises(RuntimeError, match="Timed out waiting for Codex thread id"):
        runner.start(tmp_path, "start task")

    assert len(stop_calls) == 1
    stopped_run, timeout_seconds = stop_calls[0]
    assert stopped_run.pid == process.pid
    assert stopped_run.process is process
    assert stopped_run.output_file.parent == tmp_path / "logs" / "codex-runs"
    assert stopped_run.log_path.parent == tmp_path / "logs" / "codex-runs"
    assert timeout_seconds == 5.0


def test_start_allocates_unique_output_and_log_paths_per_run(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    seen_commands: list[list[str]] = []
    seen_logs: list[Path] = []
    next_pid = iter([1111, 2222])

    def fake_spawn(project_path: Path, command: list[str], log_path: Path) -> FakeLaunchProcess:
        seen_commands.append(command)
        seen_logs.append(log_path)
        return FakeLaunchProcess(next(next_pid))

    monkeypatch.setattr(runner, "_spawn", fake_spawn)
    monkeypatch.setattr(runner, "_wait_for_thread_id", lambda log_path, process, default_thread_id=None: f"thread-{process.pid}")

    first = runner.start(tmp_path, "first prompt")
    second = runner.start(tmp_path, "second prompt")

    assert first.output_file != second.output_file
    assert first.log_path != second.log_path
    assert seen_commands[0][4] != seen_commands[1][4]
    assert seen_logs[0] != seen_logs[1]
    assert first.output_file.parent == tmp_path / "logs" / "codex-runs"
    assert first.log_path.parent == tmp_path / "logs" / "codex-runs"


class FakeTimeoutProcess:
    def __init__(self) -> None:
        self.pid = 4321
        self.stdout = io.StringIO("tail output line\nfinal fragment")
        self._returncode: int | None = None
        self.signals: list[int] = []
        self.terminated = False
        self.killed = False

    def poll(self) -> int | None:
        return self._returncode

    def send_signal(self, sig: int) -> None:
        self.signals.append(sig)

    def wait(self, timeout: float | None = None) -> int:
        if self._returncode is None:
            raise subprocess.TimeoutExpired(cmd="codex", timeout=timeout)
        return self._returncode

    def terminate(self) -> None:
        self.terminated = True
        self._returncode = -15

    def kill(self) -> None:
        self.killed = True
        self._returncode = -9


class FakeNeverExitProcess:
    def __init__(self) -> None:
        self.pid = 7654
        self.stdout = io.StringIO("still running")
        self.signals: list[int] = []
        self.terminated = False
        self.killed = False
        self.wait_timeouts: list[float | None] = []

    def poll(self) -> int | None:
        return None

    def send_signal(self, sig: int) -> None:
        self.signals.append(sig)

    def wait(self, timeout: float | None = None) -> int:
        self.wait_timeouts.append(timeout)
        raise subprocess.TimeoutExpired(cmd="codex", timeout=timeout)

    def terminate(self) -> None:
        self.terminated = True

    def kill(self) -> None:
        self.killed = True


def test_wait_timeout_terminates_process_before_return_and_drains_log(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    process = FakeTimeoutProcess()
    output_file = tmp_path / "last.txt"
    log_path = tmp_path / "codex.log"
    log_path.write_text("", encoding="utf-8")
    run = CodexRun(
        thread_id="session-1",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=output_file,
        log_path=log_path,
    )

    monotonic_values = iter([0.0, 1.0, 1.0, 1.0, 1.0])
    monkeypatch.setattr("slack_codex_router.codex_runner.time.monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr(runner, "_read_ready_lines", lambda stream, timeout_seconds: [])

    result = runner.wait(run, timeout_seconds=0)

    assert result == (124, "Codex run timed out before completion.")
    assert process.signals == [signal.SIGINT]
    assert process.poll() is not None
    assert process.terminated is True or process.killed is True
    assert log_path.read_text(encoding="utf-8") == "tail output line\nfinal fragment"


def test_wait_timeout_returns_without_draining_when_process_refuses_to_stop(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    process = FakeNeverExitProcess()
    run = CodexRun(
        thread_id="session-2",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=tmp_path / "codex.log",
    )

    monkeypatch.setattr("slack_codex_router.codex_runner.time.monotonic", lambda: 0.0)
    monkeypatch.setattr(runner, "_read_ready_lines", lambda stream, timeout_seconds: [])
    monkeypatch.setattr(
        runner,
        "_drain_remaining_output",
        lambda run: (_ for _ in ()).throw(AssertionError("drain should not be called while child is live")),
    )

    result = runner.wait(run, timeout_seconds=0)

    assert result == (124, "Codex run timed out before completion.")
    assert process.signals == [signal.SIGINT]
    assert process.terminated is True
    assert process.killed is True
    assert len(process.wait_timeouts) == 3
