from __future__ import annotations

from pathlib import Path

from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectConfig, ProjectRegistry
from slack_codex_router.slack_app import SlackRouter
from slack_codex_router.store import RouterStore


class RecordingRunner:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.interruptions = 0

    def start(self, project_path: Path, prompt: str):
        self.calls.append(("start", prompt))
        return type(
            "Run",
            (),
            {
                "thread_id": "session-1",
                "pid": 1001,
                "process": None,
                "log_path": project_path / ".codex-run.log",
            },
        )()

    def resume(self, project_path: Path, session_id: str, prompt: str):
        self.calls.append(("resume", prompt))
        return type(
            "Run",
            (),
            {
                "thread_id": session_id,
                "pid": 1002,
                "process": None,
                "log_path": project_path / ".codex-run.log",
            },
        )()

    def interrupt(self, run) -> None:
        del run
        self.interruptions += 1


def test_new_thread_then_follow_up_reuses_same_session(tmp_path: Path) -> None:
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

    router.start_completion_watch = lambda *, channel_id, thread_ts, reply: None  # type: ignore[method-assign]

    router.handle_message(
        {"user": "U123", "channel": "C123", "ts": "1710000000.100000", "text": "inspect repo"},
        replies.append,
    )
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
