from __future__ import annotations

import subprocess
from pathlib import Path

from slack_codex_router.commands import RouterCommands
from slack_codex_router.store import RouterStore


class FakeManager:
    def __init__(self, cancelled: bool = False) -> None:
        self.cancelled = cancelled
        self.cancel_calls: list[str] = []

    def cancel_thread(self, thread_ts: str) -> bool:
        self.cancel_calls.append(thread_ts)
        return self.cancelled


def test_status_reports_missing_thread(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    commands = RouterCommands(store=store)

    assert commands.status("1710000000.100000") == "No task has been started in this thread yet."


def test_status_reports_existing_thread_state(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    store.upsert_thread_session(
        thread_ts="1710000000.100000",
        channel_id="C123",
        codex_thread_id="session-1",
        status="running",
        last_user_message_ts="1710000000.100000",
    )
    commands = RouterCommands(store=store)

    assert commands.status("1710000000.100000") == "Thread status: running"


def test_cancel_reports_unconfigured_manager(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    commands = RouterCommands(store=store)

    assert commands.cancel("1710000000.100000") == "Cancel is not configured."


def test_cancel_reports_no_active_run_when_manager_returns_false(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    manager = FakeManager(cancelled=False)
    commands = RouterCommands(store=store, manager=manager)

    assert commands.cancel("1710000000.100000") == "There is no active run to cancel."
    assert manager.cancel_calls == ["1710000000.100000"]


def test_cancel_reports_cancellation_when_active_run_exists(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    manager = FakeManager(cancelled=True)
    commands = RouterCommands(store=store, manager=manager)

    assert commands.cancel("1710000000.100000") == "Cancelled the active run."
    assert manager.cancel_calls == ["1710000000.100000"]


def test_show_diff_uses_git_diff_stat(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    commands = RouterCommands(store=store)

    called = {}

    def fake_run(args, *, capture_output, text, check):  # type: ignore[no-untyped-def]
        called["args"] = args
        called["capture_output"] = capture_output
        called["text"] = text
        called["check"] = check
        return subprocess.CompletedProcess(args=args, returncode=0, stdout=" M app.py\n")

    from slack_codex_router import commands as commands_module

    original_run = commands_module.subprocess.run
    commands_module.subprocess.run = fake_run  # type: ignore[assignment]
    try:
        assert commands.show_diff(tmp_path) == "M app.py"
    finally:
        commands_module.subprocess.run = original_run  # type: ignore[assignment]

    assert called["args"] == ["git", "-C", str(tmp_path), "diff", "--stat", "--no-ext-diff"]
    assert called["capture_output"] is True
    assert called["text"] is True
    assert called["check"] is False


def test_show_diff_returns_fallback_when_repo_is_clean(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    commands = RouterCommands(store=store)

    from slack_codex_router import commands as commands_module

    original_run = commands_module.subprocess.run
    commands_module.subprocess.run = lambda *args, **kwargs: subprocess.CompletedProcess(  # type: ignore[assignment]
        args=args[0],
        returncode=0,
        stdout="",
    )
    try:
        assert commands.show_diff(tmp_path) == "No git diff is available for this project."
    finally:
        commands_module.subprocess.run = original_run  # type: ignore[assignment]


def test_what_changed_returns_latest_summary(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    job_id = store.start_job(thread_ts="1710000000.100000", pid=4242, log_path=str(tmp_path / "job.log"))
    store.finish_job(job_id=job_id, exit_code=0, interrupted=False, summary="Updated README.md and app.py")

    commands = RouterCommands(store=store)

    assert commands.what_changed("1710000000.100000") == "Updated README.md and app.py"
