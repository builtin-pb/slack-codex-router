from __future__ import annotations

import subprocess
from pathlib import Path

from slack_codex_router.job_manager import JobManager
from slack_codex_router.store import RouterStore


class RouterCommands:
    def __init__(self, *, store: RouterStore, manager: JobManager | None = None) -> None:
        self._store = store
        self._manager = manager

    def status(self, thread_ts: str) -> str:
        session = self._store.get_thread_session(thread_ts)
        if session is None:
            return "No task has been started in this thread yet."
        return f"Thread status: {session['status']}"

    def cancel(self, thread_ts: str) -> str:
        if self._manager is None:
            return "Cancel is not configured."

        cancelled = self._manager.cancel_thread(thread_ts)
        if cancelled:
            return "Cancelled the active run."
        return "There is no active run to cancel."

    def what_changed(self, thread_ts: str) -> str:
        summary = self._store.get_latest_result_summary(thread_ts)
        if summary is None:
            return "No completed result is available for this thread yet."
        return summary

    def show_diff(self, project_path: Path) -> str:
        try:
            result = subprocess.run(
                ["git", "-C", str(project_path), "diff", "--stat", "--no-ext-diff"],
                capture_output=True,
                text=True,
                check=False,
            )
        except OSError:
            return "No git diff is available for this project."

        return result.stdout.strip() or "No git diff is available for this project."
