from __future__ import annotations

from dataclasses import dataclass

from slack_codex_router.registry import ProjectConfig
from slack_codex_router.store import RouterStore


@dataclass
class ActiveRun:
    thread_ts: str
    session_id: str
    pid: int
    run: object


class JobManager:
    def __init__(self, *, store: RouterStore, runner, global_limit: int, run_timeout_seconds: int) -> None:
        self._store = store
        self._runner = runner
        self._global_limit = global_limit
        self._run_timeout_seconds = run_timeout_seconds
        self._active_by_thread: dict[str, ActiveRun] = {}
        self._active_by_project: dict[str, set[str]] = {}

    def start_new_thread(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        user_message_ts: str,
        prompt: str,
        project: ProjectConfig,
    ) -> ActiveRun:
        if len(self._active_by_thread) >= self._global_limit:
            raise RuntimeError("Global concurrency limit reached")

        active_threads = self._active_by_project.setdefault(project.channel_id, set())
        if len(active_threads) >= project.max_concurrent_jobs:
            raise RuntimeError("Project concurrency limit reached")

        run = self._runner.start(project.path, prompt)
        self._store.upsert_thread_session(
            thread_ts=thread_ts,
            channel_id=channel_id,
            codex_thread_id=run.thread_id,
            status="running",
            last_user_message_ts=user_message_ts,
        )
        self._store.start_job(thread_ts=thread_ts, pid=run.pid, log_path=str(run.log_path))

        active = ActiveRun(thread_ts=thread_ts, session_id=run.thread_id, pid=run.pid, run=run)
        self._active_by_thread[thread_ts] = active
        active_threads.add(thread_ts)
        return active

    def handle_follow_up(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        user_message_ts: str,
        prompt: str,
        project: ProjectConfig,
    ) -> ActiveRun:
        current = self._active_by_thread.get(thread_ts)
        if current is not None:
            self._runner.interrupt(current.run)

        session = self._store.get_thread_session(thread_ts)
        if session is None:
            raise RuntimeError(f"No thread session found for thread {thread_ts}")

        session_id = str(session["codex_thread_id"])
        run = self._runner.resume(project.path, session_id, prompt)
        self._store.upsert_thread_session(
            thread_ts=thread_ts,
            channel_id=channel_id,
            codex_thread_id=session_id,
            status="running",
            last_user_message_ts=user_message_ts,
        )
        self._store.start_job(thread_ts=thread_ts, pid=run.pid, log_path=str(run.log_path))

        active = ActiveRun(thread_ts=thread_ts, session_id=session_id, pid=run.pid, run=run)
        self._active_by_thread[thread_ts] = active
        self._active_by_project.setdefault(project.channel_id, set()).add(thread_ts)
        return active
