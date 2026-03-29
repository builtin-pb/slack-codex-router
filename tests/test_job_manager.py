from dataclasses import dataclass
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
