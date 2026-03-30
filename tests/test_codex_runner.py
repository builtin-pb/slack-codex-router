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


def test_build_exec_command_includes_images_before_prompt(tmp_path: Path) -> None:
    output_file = tmp_path / "last.txt"
    first_image = tmp_path / "first.png"
    second_image = tmp_path / "second.jpg"
    command = build_exec_command(
        "Reply with READY.",
        output_file,
        image_paths=(first_image, second_image),
    )
    assert command == [
        "codex",
        "exec",
        "--json",
        "-i",
        str(first_image),
        "-i",
        str(second_image),
        "--output-last-message",
        str(output_file),
        "Reply with READY.",
    ]


def test_build_resume_command_includes_images_before_session_id(tmp_path: Path) -> None:
    output_file = tmp_path / "last.txt"
    image = tmp_path / "image.png"
    command = build_resume_command(
        "019d38b3-48fe-7790-a2e3-d9a5f81b450a",
        "status",
        output_file,
        image_paths=(image,),
    )
    assert command == [
        "codex",
        "exec",
        "resume",
        "--json",
        "-i",
        str(image),
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


class FakeExitedProcess:
    def __init__(self, returncode: int = 0, stdout: io.StringIO | None = None) -> None:
        self.pid = 2468
        self.stdout = stdout
        self.returncode = returncode
        self.signals: list[int] = []
        self.wait_calls: list[float | None] = []

    def poll(self) -> int | None:
        return self.returncode

    def send_signal(self, sig: int) -> None:
        self.signals.append(sig)

    def wait(self, timeout: float | None = None) -> int:
        self.wait_calls.append(timeout)
        return self.returncode


class FakeLookupErrorProcess:
    def __init__(self) -> None:
        self.pid = 3579
        self.stdout = io.StringIO("")
        self.killed = False
        self.terminated = False
        self.signals: list[int] = []

    def poll(self) -> int | None:
        return None

    def send_signal(self, sig: int) -> None:
        self.signals.append(sig)
        raise ProcessLookupError()

    def wait(self, timeout: float | None = None) -> int:
        raise subprocess.TimeoutExpired(cmd="codex", timeout=timeout)

    def terminate(self) -> None:
        self.terminated = True
        raise ProcessLookupError()

    def kill(self) -> None:
        self.killed = True
        raise ProcessLookupError()


class FakeRunningProcess:
    def __init__(self, stdout: io.StringIO | None = None, pid: int = 5555) -> None:
        self.pid = pid
        self.stdout = stdout
        self.returncode: int | None = None
        self.signals: list[int] = []
        self.wait_calls: list[float | None] = []
        self.terminated = False
        self.killed = False

    def poll(self) -> int | None:
        return self.returncode

    def send_signal(self, sig: int) -> None:
        self.signals.append(sig)

    def wait(self, timeout: float | None = None) -> int:
        self.wait_calls.append(timeout)
        if self.returncode is None:
            raise subprocess.TimeoutExpired(cmd="codex", timeout=timeout)
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True

    def kill(self) -> None:
        self.killed = True


class FakeKillLookupProcess(FakeRunningProcess):
    def kill(self) -> None:
        self.killed = True
        raise ProcessLookupError()


class FakeInterruptExitProcess(FakeRunningProcess):
    def send_signal(self, sig: int) -> None:
        super().send_signal(sig)
        self.returncode = 0


def test_resume_uses_session_id_as_default_thread_id(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    captured: dict[str, object] = {}
    launched_run = CodexRun(
        thread_id="resume-session",
        pid=3210,
        process=FakeExitedProcess(),  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=tmp_path / "codex.log",
    )

    def fake_launch(
        project_path: Path,
        command: list[str],
        output_file: Path,
        log_path: Path,
        *,
        default_thread_id: str | None = None,
    ) -> CodexRun:
        captured["project_path"] = project_path
        captured["command"] = command
        captured["output_file"] = output_file
        captured["log_path"] = log_path
        captured["default_thread_id"] = default_thread_id
        return launched_run

    monkeypatch.setattr(runner, "_launch", fake_launch)

    result = runner.resume(tmp_path, "resume-session", "status update", image_paths=(tmp_path / "screenshot.png",))

    assert result is launched_run
    assert captured["project_path"] == tmp_path
    assert captured["default_thread_id"] == "resume-session"
    assert captured["command"] == [
        "codex",
        "exec",
        "resume",
        "--json",
        "-i",
        str(tmp_path / "screenshot.png"),
        "--output-last-message",
        str(captured["output_file"]),
        "resume-session",
        "status update",
    ]
    assert Path(captured["output_file"]) != Path(captured["log_path"])


def test_interrupt_returns_without_signaling_exited_process(tmp_path: Path) -> None:
    runner = CodexRunner()
    process = FakeExitedProcess(stdout=io.StringIO("done\n"))
    run = CodexRun(
        thread_id="thread-1",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=tmp_path / "codex.log",
    )

    runner.interrupt(run)

    assert process.signals == []


def test_interrupt_ignores_process_lookup_error(tmp_path: Path) -> None:
    runner = CodexRunner()
    process = FakeLookupErrorProcess()
    run = CodexRun(
        thread_id="thread-2",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=tmp_path / "codex.log",
    )

    runner.interrupt(run)

    assert process.signals == [signal.SIGINT]


def test_stop_drains_and_returns_true_when_process_already_exited(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    process = FakeExitedProcess(stdout=io.StringIO("finished\n"))
    run = CodexRun(
        thread_id="thread-3",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=tmp_path / "codex.log",
    )
    drained: list[CodexRun] = []
    monkeypatch.setattr(runner, "_drain_remaining_output", lambda value: drained.append(value))

    result = runner.stop(run)

    assert result is True
    assert drained == [run]
    assert process.signals == []
    assert process.wait_calls == []


def test_stop_returns_true_when_process_exits_after_interrupt(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    process = FakeInterruptExitProcess(stdout=io.StringIO(""))
    run = CodexRun(
        thread_id="thread-4",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=tmp_path / "codex.log",
    )
    drained: list[CodexRun] = []

    monotonic_values = iter([10.0, 10.2])
    monkeypatch.setattr("slack_codex_router.codex_runner.time.monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr(runner, "_drain_remaining_output", lambda value: drained.append(value))

    result = runner.stop(run, timeout_seconds=2.5)

    assert result is True
    assert process.signals == [signal.SIGINT]
    assert drained == [run]
    assert process.wait_calls == [pytest.approx(2.3)]
    assert process.terminated is False
    assert process.killed is False


def test_stop_returns_drain_result_when_terminate_raises_lookup_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    process = FakeLookupErrorProcess()
    run = CodexRun(
        thread_id="thread-5",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=tmp_path / "codex.log",
    )
    monkeypatch.setattr("slack_codex_router.codex_runner.time.monotonic", lambda: 100.0)
    monkeypatch.setattr(runner, "_wait_for_exit", lambda proc, *, timeout_seconds: False)
    monkeypatch.setattr(runner, "_drain_if_exited", lambda value: value is run)

    result = runner.stop(run)

    assert result is True
    assert process.terminated is True
    assert process.killed is False


def test_stop_returns_drain_result_when_kill_raises_lookup_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    process = FakeKillLookupProcess(stdout=io.StringIO(""), pid=4680)
    run = CodexRun(
        thread_id="thread-6",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=tmp_path / "codex.log",
    )
    monkeypatch.setattr("slack_codex_router.codex_runner.time.monotonic", lambda: 100.0)
    wait_results = iter([False, False])
    monkeypatch.setattr(runner, "_wait_for_exit", lambda proc, *, timeout_seconds: next(wait_results))
    monkeypatch.setattr(runner, "_drain_if_exited", lambda value: value is run)

    result = runner.stop(run)

    assert result is True
    assert process.terminated is True
    assert process.killed is True


def test_wait_returns_exit_code_and_summary_after_normal_completion(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    output_file = tmp_path / "last.txt"
    output_file.write_text("final answer", encoding="utf-8")
    log_path = tmp_path / "codex.log"
    log_path.write_text("", encoding="utf-8")
    process = FakeRunningProcess(stdout=io.StringIO("trailing output\n"), pid=6001)
    process_states = iter([None, 0])
    process.poll = lambda: next(process_states)  # type: ignore[assignment]
    process.returncode = 0
    run = CodexRun(
        thread_id="thread-7",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=output_file,
        log_path=log_path,
    )

    monkeypatch.setattr(runner, "_read_ready_lines", lambda stream, timeout_seconds: ["stream line\n"])

    result = runner.wait(run, timeout_seconds=5)

    assert result == (0, "final answer")
    assert log_path.read_text(encoding="utf-8") == "stream line\ntrailing output\n"
    assert process.wait_calls == [None]


def test_wait_returns_empty_summary_when_output_file_is_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    log_path = tmp_path / "codex.log"
    log_path.write_text("", encoding="utf-8")
    process = FakeExitedProcess(returncode=7, stdout=io.StringIO(""))
    run = CodexRun(
        thread_id="thread-8",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "missing.txt",
        log_path=log_path,
    )
    drain_calls: list[CodexRun] = []
    monkeypatch.setattr(runner, "_drain_remaining_output", lambda value: drain_calls.append(value))

    result = runner.wait(run, timeout_seconds=1)

    assert result == (7, "")
    assert drain_calls == [run]


def test_launch_preserves_original_error_when_cleanup_also_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    process = FakeLaunchProcess(pid=9753)
    output_file = tmp_path / "last.txt"
    log_path = tmp_path / "codex.log"
    stop_calls: list[tuple[CodexRun, float]] = []

    monkeypatch.setattr(runner, "_spawn", lambda project_path, command, path: process)
    monkeypatch.setattr(
        runner,
        "_wait_for_thread_id",
        lambda log_path, proc, default_thread_id=None: (_ for _ in ()).throw(RuntimeError("thread id missing")),
    )

    def fake_stop(run: CodexRun, timeout_seconds: float = 5.0) -> bool:
        stop_calls.append((run, timeout_seconds))
        raise RuntimeError("cleanup failed")

    monkeypatch.setattr(runner, "stop", fake_stop)

    with pytest.raises(RuntimeError, match="thread id missing"):
        runner._launch(tmp_path, ["codex"], output_file, log_path)

    assert len(stop_calls) == 1
    stopped_run, timeout_seconds = stop_calls[0]
    assert stopped_run.process is process
    assert stopped_run.output_file == output_file
    assert stopped_run.log_path == log_path
    assert timeout_seconds == 5.0


def test_spawn_creates_parent_directories_and_clears_log_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner()
    project_path = tmp_path / "project"
    log_path = tmp_path / "logs" / "codex.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text("stale output", encoding="utf-8")
    captured: dict[str, object] = {}

    def fake_popen(*args: object, **kwargs: object) -> FakeLaunchProcess:
        captured["args"] = args
        captured["kwargs"] = kwargs
        return FakeLaunchProcess(pid=8642)

    monkeypatch.setattr("slack_codex_router.codex_runner.subprocess.Popen", fake_popen)

    process = runner._spawn(project_path, ["codex", "exec"], log_path)

    assert isinstance(process, FakeLaunchProcess)
    assert project_path.is_dir()
    assert log_path.read_text(encoding="utf-8") == ""
    assert captured["args"] == (["codex", "exec"],)
    assert captured["kwargs"] == {
        "cwd": project_path,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "bufsize": 1,
    }


def test_wait_for_thread_id_returns_detected_id_from_stream(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner(thread_id_timeout_seconds=5.0)
    log_path = tmp_path / "codex.log"
    log_path.write_text("", encoding="utf-8")
    process = FakeRunningProcess(stdout=io.StringIO(""), pid=7001)
    monotonic_values = iter([0.0, 0.1, 0.2])
    monkeypatch.setattr("slack_codex_router.codex_runner.time.monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr(
        runner,
        "_read_ready_lines",
        lambda stream, timeout_seconds: [
            '{"id":"1","type":"thread.started","thread_id":"thread-abc"}\n',
        ],
    )

    thread_id = runner._wait_for_thread_id(log_path, process)  # type: ignore[arg-type]

    assert thread_id == "thread-abc"
    assert log_path.read_text(encoding="utf-8") == '{"id":"1","type":"thread.started","thread_id":"thread-abc"}\n'


def test_wait_for_thread_id_returns_default_after_process_exits_with_no_events(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner(thread_id_timeout_seconds=5.0)
    log_path = tmp_path / "codex.log"
    log_path.write_text("", encoding="utf-8")
    process = FakeExitedProcess(stdout=io.StringIO("non-json output\n"))
    monotonic_values = iter([0.0, 0.1])
    monkeypatch.setattr("slack_codex_router.codex_runner.time.monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr(runner, "_read_ready_lines", lambda stream, timeout_seconds: [])

    thread_id = runner._wait_for_thread_id(log_path, process, default_thread_id="fallback-thread")  # type: ignore[arg-type]

    assert thread_id == "fallback-thread"


def test_wait_for_thread_id_raises_when_no_thread_id_is_found(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = CodexRunner(thread_id_timeout_seconds=0.5)
    log_path = tmp_path / "codex.log"
    log_path.write_text("", encoding="utf-8")
    process = FakeExitedProcess(stdout=io.StringIO("plain text only\n"))
    monotonic_values = iter([0.0, 1.0, 1.0])
    monkeypatch.setattr("slack_codex_router.codex_runner.time.monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr(runner, "_read_ready_lines", lambda stream, timeout_seconds: [])

    with pytest.raises(RuntimeError, match=str(log_path)):
        runner._wait_for_thread_id(log_path, process)  # type: ignore[arg-type]

    assert log_path.read_text(encoding="utf-8") == "plain text only\n"


def test_drain_remaining_output_returns_when_stdout_is_none(tmp_path: Path) -> None:
    runner = CodexRunner()
    process = FakeExitedProcess(stdout=None)
    run = CodexRun(
        thread_id="thread-9",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=tmp_path / "codex.log",
    )

    runner._drain_remaining_output(run)

    assert not run.log_path.exists()


def test_drain_remaining_output_returns_when_tail_is_empty(tmp_path: Path) -> None:
    runner = CodexRunner()
    log_path = tmp_path / "codex.log"
    log_path.write_text("", encoding="utf-8")
    process = FakeExitedProcess(stdout=io.StringIO(""))
    run = CodexRun(
        thread_id="thread-10",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=log_path,
    )

    runner._drain_remaining_output(run)

    assert log_path.read_text(encoding="utf-8") == ""


def test_drain_if_exited_returns_false_for_running_process(tmp_path: Path) -> None:
    runner = CodexRunner()
    process = FakeRunningProcess(stdout=io.StringIO(""))
    run = CodexRun(
        thread_id="thread-11",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=tmp_path / "codex.log",
    )

    assert runner._drain_if_exited(run) is False


def test_drain_if_exited_drains_log_for_exited_process(tmp_path: Path) -> None:
    runner = CodexRunner()
    log_path = tmp_path / "codex.log"
    log_path.write_text("", encoding="utf-8")
    process = FakeExitedProcess(stdout=io.StringIO("tail line\n"))
    run = CodexRun(
        thread_id="thread-12",
        pid=process.pid,
        process=process,  # type: ignore[arg-type]
        output_file=tmp_path / "last.txt",
        log_path=log_path,
    )

    assert runner._drain_if_exited(run) is True
    assert log_path.read_text(encoding="utf-8") == "tail line\n"


def test_read_ready_lines_reads_until_select_reports_no_more_data(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = CodexRunner()
    stream = io.StringIO("first line\nsecond line\n")
    readiness = iter([([stream], [], []), ([stream], [], []), ([], [], [])])
    monkeypatch.setattr("slack_codex_router.codex_runner.select.select", lambda *args: next(readiness))

    lines = runner._read_ready_lines(stream, timeout_seconds=0.25)

    assert lines == ["first line\n", "second line\n"]
