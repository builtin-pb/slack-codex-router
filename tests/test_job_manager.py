from dataclasses import dataclass
import threading
from pathlib import Path

import pytest

from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectConfig
from slack_codex_router.store import RouterStore


@dataclass
class FakeRun:
    thread_id: str
    pid: int
    interrupted: bool = False
    output_file: Path | None = None
    log_path: Path | None = None
    process: object | None = None


class FakeRunner:
    def __init__(self) -> None:
        self.exec_calls: list[tuple[Path, str]] = []
        self.resume_calls: list[tuple[Path, str, str]] = []
        self.current = FakeRun(thread_id="session-1", pid=1001)

    def start(self, project_path: Path, prompt: str) -> FakeRun:
        self.exec_calls.append((project_path, prompt))
        self.current = FakeRun(
            thread_id="session-1",
            pid=1001,
            output_file=project_path / ".codex-last.txt",
            log_path=project_path / ".codex-run.log",
        )
        return self.current

    def resume(self, project_path: Path, session_id: str, prompt: str) -> FakeRun:
        self.resume_calls.append((project_path, session_id, prompt))
        self.current = FakeRun(
            thread_id=session_id,
            pid=1002,
            output_file=project_path / ".codex-last.txt",
            log_path=project_path / ".codex-run.log",
        )
        return self.current

    def interrupt(self, run: FakeRun) -> None:
        run.interrupted = True


class BlockingRunner(FakeRunner):
    def __init__(self) -> None:
        super().__init__()
        self.interrupt_called = threading.Event()
        self.wait_started = threading.Event()
        self.release_wait = threading.Event()
        self.wait_calls: list[tuple[object, int | None]] = []

    def interrupt(self, run: FakeRun) -> None:
        super().interrupt(run)
        self.interrupt_called.set()

    def wait(self, run: FakeRun, timeout_seconds: int | None = None) -> tuple[int, str]:
        self.wait_calls.append((run, timeout_seconds))
        self.wait_started.set()
        self.release_wait.wait(timeout=1)
        return (130, "Cancelled run summary")


class FailingResumeRunner(FakeRunner):
    def resume(self, project_path: Path, session_id: str, prompt: str) -> FakeRun:
        self.resume_calls.append((project_path, session_id, prompt))
        raise RuntimeError("resume failed")


class StopBeforeResumeRunner(FakeRunner):
    def __init__(self) -> None:
        super().__init__()
        self.stop_calls: list[tuple[FakeRun, float]] = []
        self.resume_seen_stopped = False

    def stop(self, run: FakeRun, timeout_seconds: float) -> bool:
        run.interrupted = True
        self.stop_calls.append((run, timeout_seconds))
        return True

    def resume(self, project_path: Path, session_id: str, prompt: str) -> FakeRun:
        self.resume_seen_stopped = self.current.interrupted
        return super().resume(project_path, session_id, prompt)


class StopFailureRunner(FakeRunner):
    def __init__(self) -> None:
        super().__init__()
        self.stop_calls: list[tuple[FakeRun, float]] = []
        self.wait_calls: list[tuple[FakeRun, int | None]] = []

    def stop(self, run: FakeRun, timeout_seconds: float) -> bool:
        self.stop_calls.append((run, timeout_seconds))
        return False

    def wait(self, run: FakeRun, timeout_seconds: int | None = None) -> tuple[int, str]:
        self.wait_calls.append((run, timeout_seconds))
        return (0, "Original run completed")


class BlockingStopFailureRunner(FakeRunner):
    def __init__(self) -> None:
        super().__init__()
        self.stop_started = threading.Event()
        self.release_stop = threading.Event()
        self.wait_calls: list[tuple[FakeRun, int | None]] = []

    def stop(self, run: FakeRun, timeout_seconds: float) -> bool:
        del run, timeout_seconds
        self.stop_started.set()
        self.release_stop.wait(timeout=1)
        return False

    def wait(self, run: FakeRun, timeout_seconds: int | None = None) -> tuple[int, str]:
        self.wait_calls.append((run, timeout_seconds))
        return (0, "Original run completed after transition")


class BlockingStopSuccessRunner(FakeRunner):
    def __init__(self) -> None:
        super().__init__()
        self.stop_started = threading.Event()
        self.release_stop = threading.Event()
        self.wait_calls: list[tuple[FakeRun, int | None]] = []

    def stop(self, run: FakeRun, timeout_seconds: float) -> bool:
        del run, timeout_seconds
        self.stop_started.set()
        self.release_stop.wait(timeout=1)
        return True

    def wait(self, run: FakeRun, timeout_seconds: int | None = None) -> tuple[int, str]:
        self.wait_calls.append((run, timeout_seconds))
        return (0, f"Summary for pid {run.pid}")


def test_follow_up_interrupts_active_run_and_reuses_same_session(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = FakeRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=2)

    original_run = manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="initial request",
        project=project,
    )
    manager.handle_follow_up(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000001.100000",
        prompt="latest request",
        project=project,
    )

    latest_job = store.get_latest_job("1710000000.100000")
    session = store.get_thread_session("1710000000.100000")

    assert runner.resume_calls == [(tmp_path, "session-1", "latest request")]
    assert original_run.run.interrupted is True
    assert latest_job["pid"] == 1002
    assert session["codex_thread_id"] == "session-1"


def test_follow_up_waits_for_previous_run_to_stop_before_resume(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = StopBeforeResumeRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=2)

    original_run = manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="initial request",
        project=project,
    )

    manager.handle_follow_up(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000001.100000",
        prompt="latest request",
        project=project,
    )

    latest_job = store.get_latest_job("1710000000.100000")

    assert runner.stop_calls == [(original_run.run, 5.0)]
    assert runner.resume_seen_stopped is True
    assert latest_job is not None
    assert latest_job["pid"] == 1002


def test_follow_up_stop_failure_keeps_original_run_and_watcher_authoritative(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = StopFailureRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=2)

    manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="initial request",
        project=project,
    )

    with pytest.raises(RuntimeError, match="Timed out stopping active Codex run"):
        manager.handle_follow_up(
            channel_id="C123",
            thread_ts="1710000000.100000",
            user_message_ts="1710000001.100000",
            prompt="latest request",
            project=project,
        )

    session = store.get_thread_session("1710000000.100000")
    latest_job = store.get_latest_job("1710000000.100000")

    assert runner.resume_calls == []
    assert runner.stop_calls[0][1] == 5.0
    assert manager.active_thread_count() == 1
    assert session is not None
    assert session["status"] == "running"
    assert session["last_user_message_ts"] == "1710000000.100000"
    assert latest_job is not None
    assert latest_job["state"] == "running"
    assert latest_job["interrupted"] == 0

    result = manager.wait_for_thread("1710000000.100000", expected_message_ts="1710000000.100000")

    assert result == (0, "Original run completed", False)
    assert len(runner.wait_calls) == 1


def test_authoritative_watcher_waits_through_transition_when_stop_fails(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = BlockingStopFailureRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=2)

    manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="initial request",
        project=project,
    )

    follow_up_error: dict[str, Exception] = {}
    watcher_result: dict[str, tuple[int, str, bool]] = {}
    watcher_error: dict[str, Exception] = {}

    def follow_up() -> None:
        try:
            manager.handle_follow_up(
                channel_id="C123",
                thread_ts="1710000000.100000",
                user_message_ts="1710000001.100000",
                prompt="latest request",
                project=project,
            )
        except Exception as exc:
            follow_up_error["value"] = exc

    def watch_original() -> None:
        try:
            watcher_result["value"] = manager.wait_for_thread(
                "1710000000.100000",
                expected_message_ts="1710000000.100000",
            )
        except Exception as exc:
            watcher_error["value"] = exc

    follow_up_thread = threading.Thread(target=follow_up)
    follow_up_thread.start()
    assert runner.stop_started.wait(timeout=1)

    watcher_thread = threading.Thread(target=watch_original)
    watcher_thread.start()
    watcher_thread.join(timeout=0.05)
    assert watcher_thread.is_alive()

    runner.release_stop.set()
    follow_up_thread.join(timeout=1)
    watcher_thread.join(timeout=1)

    assert isinstance(follow_up_error["value"], RuntimeError)
    assert "transitioning" not in str(watcher_error.get("value", ""))
    assert "value" not in watcher_error
    assert watcher_result["value"] == (0, "Original run completed after transition", False)
    assert len(runner.wait_calls) == 1


def test_cancel_thread_during_failed_transition_cancels_restored_original_run(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = BlockingStopFailureRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=2)

    manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="initial request",
        project=project,
    )

    follow_up_error: dict[str, Exception] = {}

    def follow_up() -> None:
        try:
            manager.handle_follow_up(
                channel_id="C123",
                thread_ts="1710000000.100000",
                user_message_ts="1710000001.100000",
                prompt="latest request",
                project=project,
            )
        except Exception as exc:
            follow_up_error["value"] = exc

    follow_up_thread = threading.Thread(target=follow_up)
    follow_up_thread.start()
    assert runner.stop_started.wait(timeout=1)

    cancel_error: dict[str, Exception] = {}
    cancel_result: dict[str, bool] = {}

    def cancel_during_transition() -> None:
        try:
            cancel_result["value"] = manager.cancel_thread("1710000000.100000")
        except Exception as exc:
            cancel_error["value"] = exc

    cancel_thread = threading.Thread(target=cancel_during_transition)
    cancel_thread.start()
    cancel_thread.join(timeout=0.05)
    assert cancel_thread.is_alive()

    runner.release_stop.set()
    follow_up_thread.join(timeout=1)
    cancel_thread.join(timeout=1)

    session = store.get_thread_session("1710000000.100000")

    assert "value" not in cancel_error
    assert cancel_result["value"] is True
    assert isinstance(follow_up_error["value"], RuntimeError)
    assert session is not None
    assert session["status"] == "cancelled"


def test_stale_watcher_entering_during_successful_transition_never_waits_on_replacement_run(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = BlockingStopSuccessRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=2)

    manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="initial request",
        project=project,
    )

    follow_up_error: dict[str, Exception] = {}
    watcher_error: dict[str, Exception] = {}

    def follow_up() -> None:
        try:
            manager.handle_follow_up(
                channel_id="C123",
                thread_ts="1710000000.100000",
                user_message_ts="1710000001.100000",
                prompt="latest request",
                project=project,
            )
        except Exception as exc:
            follow_up_error["value"] = exc

    def watch_stale() -> None:
        try:
            manager.wait_for_thread(
                "1710000000.100000",
                expected_message_ts="1710000000.100000",
            )
        except Exception as exc:
            watcher_error["value"] = exc

    follow_up_thread = threading.Thread(target=follow_up)
    follow_up_thread.start()
    assert runner.stop_started.wait(timeout=1)

    stale_watcher = threading.Thread(target=watch_stale)
    stale_watcher.start()
    stale_watcher.join(timeout=0.05)
    assert stale_watcher.is_alive()

    runner.release_stop.set()
    follow_up_thread.join(timeout=1)
    stale_watcher.join(timeout=1)

    assert "value" not in follow_up_error
    assert isinstance(watcher_error["value"], RuntimeError)
    assert "obsolete" in str(watcher_error["value"])
    assert runner.wait_calls == []

    result = manager.wait_for_thread("1710000000.100000", expected_message_ts="1710000001.100000")

    assert result == (0, "Summary for pid 1002", False)
    assert [run.pid for run, _ in runner.wait_calls] == [1002]


def test_cancel_thread_during_successful_transition_cancels_resolved_replacement_run(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = BlockingStopSuccessRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=2)

    manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="initial request",
        project=project,
    )

    follow_up_error: dict[str, Exception] = {}

    def follow_up() -> None:
        try:
            manager.handle_follow_up(
                channel_id="C123",
                thread_ts="1710000000.100000",
                user_message_ts="1710000001.100000",
                prompt="latest request",
                project=project,
            )
        except Exception as exc:
            follow_up_error["value"] = exc

    follow_up_thread = threading.Thread(target=follow_up)
    follow_up_thread.start()
    assert runner.stop_started.wait(timeout=1)

    cancel_error: dict[str, Exception] = {}
    cancel_result: dict[str, bool] = {}

    def cancel_during_transition() -> None:
        try:
            cancel_result["value"] = manager.cancel_thread("1710000000.100000")
        except Exception as exc:
            cancel_error["value"] = exc

    cancel_thread = threading.Thread(target=cancel_during_transition)
    cancel_thread.start()
    cancel_thread.join(timeout=0.05)
    assert cancel_thread.is_alive()

    runner.release_stop.set()
    follow_up_thread.join(timeout=1)
    cancel_thread.join(timeout=1)

    session = store.get_thread_session("1710000000.100000")
    latest_job = store.get_latest_job("1710000000.100000")
    active = manager._active_by_thread["1710000000.100000"]

    assert "value" not in follow_up_error
    assert "value" not in cancel_error
    assert cancel_result["value"] is True
    assert session is not None
    assert session["status"] == "cancelled"
    assert session["last_user_message_ts"] == "1710000001.100000"
    assert latest_job is not None
    assert latest_job["pid"] == 1002
    assert getattr(active, "run").interrupted is True


def test_project_concurrency_limit_blocks_second_top_level_thread(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = FakeRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=1)

    manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="first task",
        project=project,
    )

    with pytest.raises(RuntimeError, match="Project concurrency limit reached"):
        manager.start_new_thread(
            channel_id="C123",
            thread_ts="1710000002.100000",
            user_message_ts="1710000002.100000",
            prompt="second task",
            project=project,
        )


def test_cancel_thread_preserves_cancelled_state_until_wait_for_thread_finishes(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = BlockingRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=1)

    manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="first task",
        project=project,
    )

    wait_result: dict[str, tuple[int, str, bool]] = {}

    def watch_thread() -> None:
        wait_result["value"] = manager.wait_for_thread("1710000000.100000")

    watcher = threading.Thread(target=watch_thread)
    watcher.start()

    assert runner.wait_started.wait(timeout=1)

    cancel_result: dict[str, bool] = {}

    def cancel_thread() -> None:
        cancel_result["value"] = manager.cancel_thread("1710000000.100000")

    cancel_worker = threading.Thread(target=cancel_thread)
    cancel_worker.start()
    cancel_worker.join(timeout=1)

    assert runner.interrupt_called.wait(timeout=1)
    assert cancel_result["value"] is True
    with pytest.raises(RuntimeError, match="Project concurrency limit reached"):
        manager.start_new_thread(
            channel_id="C123",
            thread_ts="1710000001.100000",
            user_message_ts="1710000001.100000",
            prompt="second task",
            project=project,
        )

    session = store.get_thread_session("1710000000.100000")
    assert session is not None
    assert session["status"] == "cancelled"

    runner.release_wait.set()
    watcher.join(timeout=1)

    assert wait_result["value"] == (130, "Cancelled run summary", True)
    session = store.get_thread_session("1710000000.100000")
    assert session is not None
    assert session["status"] == "cancelled"
    latest_job = store.get_latest_job("1710000000.100000")
    assert latest_job is not None
    assert latest_job["interrupted"] == 1
    assert len(runner.wait_calls) == 1

    manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000002.100000",
        user_message_ts="1710000002.100000",
        prompt="third task",
        project=project,
    )


def test_follow_up_resume_failure_cleans_up_active_tracking_and_frees_capacity(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = FailingResumeRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=1)

    original_run = manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="initial request",
        project=project,
    )

    with pytest.raises(RuntimeError, match="resume failed"):
        manager.handle_follow_up(
            channel_id="C123",
            thread_ts="1710000000.100000",
            user_message_ts="1710000001.100000",
            prompt="latest request",
            project=project,
        )

    session = store.get_thread_session("1710000000.100000")
    latest_job = store.get_latest_job("1710000000.100000")

    assert runner.resume_calls == [(tmp_path, "session-1", "latest request")]
    assert original_run.run.interrupted is True
    assert manager.active_thread_count() == 0
    assert session is not None
    assert session["status"] == "interrupted"
    assert latest_job is not None
    assert latest_job["state"] == "interrupted"
    assert latest_job["interrupted"] == 1

    manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000002.100000",
        user_message_ts="1710000002.100000",
        prompt="third task",
        project=project,
    )
