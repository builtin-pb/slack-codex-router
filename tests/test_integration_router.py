from __future__ import annotations

import threading
from pathlib import Path

from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectConfig, ProjectRegistry
from slack_codex_router.slack_app import SlackRouter
from slack_codex_router.store import RouterStore


class ControlledRun:
    def __init__(self, *, thread_id: str, pid: int, log_path: Path, summary: str) -> None:
        self.thread_id = thread_id
        self.pid = pid
        self.log_path = log_path
        self.summary = summary
        self.process = None
        self.interrupted = False
        self.wait_started = threading.Event()
        self.release_wait = threading.Event()


class RecordingRunner:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.interruptions = 0
        self.runs: list[ControlledRun] = []

    def start(self, project_path: Path, prompt: str):
        self.calls.append(("start", prompt))
        run = ControlledRun(
            thread_id="session-1",
            pid=1001,
            log_path=project_path / ".codex-run.log",
            summary="Initial summary",
        )
        self.runs.append(run)
        return run

    def resume(self, project_path: Path, session_id: str, prompt: str):
        self.calls.append(("resume", prompt))
        run = ControlledRun(
            thread_id=session_id,
            pid=1002,
            log_path=project_path / ".codex-run.log",
            summary="Updated final summary from Codex",
        )
        self.runs.append(run)
        return run

    def interrupt(self, run) -> None:
        self.interruptions += 1
        run.interrupted = True
        run.release_wait.set()

    def wait(self, run, timeout_seconds: int | None = None) -> tuple[int, str]:
        del timeout_seconds
        run.wait_started.set()
        if not run.release_wait.wait(timeout=1):
            raise TimeoutError("Timed out waiting for test-controlled run completion")
        if run.interrupted:
            return (130, "")
        return (0, run.summary)


def test_new_thread_then_follow_up_reuses_same_session_and_cleans_up_after_completion(
    tmp_path: Path,
) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    registry = ProjectRegistry(
        {
            "C123": ProjectConfig(
                channel_id="C123",
                name="demo",
                path=tmp_path,
                max_concurrent_jobs=2,
            )
        }
    )
    runner = RecordingRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    router = SlackRouter(allowed_user_id="U123", registry=registry, manager=manager, store=store)
    replies: list[str] = []
    watchers: list[threading.Thread] = []

    original_start_completion_watch = router.start_completion_watch

    def record_completion_watch(*, channel_id: str, thread_ts: str, reply):
        watcher = original_start_completion_watch(channel_id=channel_id, thread_ts=thread_ts, reply=reply)
        watchers.append(watcher)
        return watcher

    router.start_completion_watch = record_completion_watch  # type: ignore[method-assign]

    router.handle_message(
        {"user": "U123", "channel": "C123", "ts": "1710000000.100000", "text": "inspect repo"},
        replies.append,
    )
    assert runner.runs[0].wait_started.wait(timeout=1)

    router.handle_message(
        {
            "user": "U123",
            "channel": "C123",
            "ts": "1710000001.100000",
            "thread_ts": "1710000000.100000",
            "text": "only touch docs",
        },
        replies.append,
    )
    assert runner.runs[1].wait_started.wait(timeout=1)

    session = store.get_thread_session("1710000000.100000")
    latest_job = store.get_latest_job("1710000000.100000")
    active_jobs = store.list_active_jobs()

    assert runner.calls == [("start", "inspect repo"), ("resume", "only touch docs")]
    assert runner.interruptions == 1
    assert manager.active_thread_count() == 1
    assert session is not None
    assert session["codex_thread_id"] == "session-1"
    assert latest_job is not None
    assert latest_job["pid"] == 1002
    assert latest_job["state"] == "running"
    assert [job["thread_ts"] for job in active_jobs] == ["1710000000.100000"]
    assert replies[-1] == "Interrupted prior run and resumed the Codex session with the latest message."

    runner.runs[1].release_wait.set()

    for watcher in watchers:
        watcher.join(timeout=1)

    session = store.get_thread_session("1710000000.100000")
    latest_job = store.get_latest_job("1710000000.100000")

    assert all(not watcher.is_alive() for watcher in watchers)
    assert manager.active_thread_count() == 0
    assert store.list_active_jobs() == []
    assert session is not None
    assert session["status"] == "finished"
    assert latest_job is not None
    assert latest_job["pid"] == 1002
    assert latest_job["state"] == "finished"
    assert latest_job["last_result_summary"] == "Updated final summary from Codex"
    assert replies == [
        "Started Codex task for project `demo`.",
        "Interrupted prior run and resumed the Codex session with the latest message.",
        "Finished Codex run.\n\nUpdated final summary from Codex",
    ]
