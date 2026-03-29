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
            latest_job = self._store.get_latest_job(thread_ts)
            if latest_job is not None and str(latest_job["state"]) == "running":
                self._store.finish_job(
                    job_id=int(latest_job["job_id"]),
                    exit_code=130,
                    interrupted=True,
                    summary="",
                )

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

    def cancel_thread(self, thread_ts: str) -> bool:
        current = self._active_by_thread.get(thread_ts)
        if current is None:
            return False

        self._runner.interrupt(current.run)

        self._store.mark_thread_status(thread_ts, "cancelled")

        return True

    def wait_for_thread(self, thread_ts: str) -> tuple[int, str, bool]:
        active = self._active_by_thread.get(thread_ts)
        if active is None:
            latest_job = self._store.get_latest_job(thread_ts)
            if latest_job is None:
                raise RuntimeError(f"No active job found for thread {thread_ts}")

            exit_code = int(latest_job["exit_code"] or 0)
            summary = str(latest_job["last_result_summary"] or "")
            interrupted = bool(latest_job["interrupted"])
            return (exit_code, summary, interrupted)

        try:
            exit_code, summary = self._runner.wait(active.run, self._run_timeout_seconds)
        except TypeError:
            exit_code, summary = self._runner.wait(active.run)

        if self._active_by_thread.get(thread_ts) is not active:
            raise RuntimeError(f"Thread {thread_ts} is no longer the active run")

        session = self._store.get_thread_session(thread_ts)
        interrupted = session is not None and str(session["status"]) == "cancelled"
        self.complete_thread(
            thread_ts,
            exit_code=exit_code,
            summary=summary,
            interrupted=interrupted,
        )
        return (exit_code, summary, interrupted)

    def complete_thread(
        self,
        thread_ts: str,
        *,
        exit_code: int,
        summary: str,
        interrupted: bool,
    ) -> None:
        latest_job = self._store.get_latest_job(thread_ts)
        if latest_job is None:
            raise RuntimeError(f"No job found for thread {thread_ts}")

        session = self._store.get_thread_session(thread_ts)
        cancelled = session is not None and str(session["status"]) == "cancelled"
        if cancelled:
            interrupted = True

        self._store.finish_job(
            job_id=int(latest_job["job_id"]),
            exit_code=exit_code,
            interrupted=interrupted,
            summary=summary,
        )

        status = "cancelled" if cancelled else ("interrupted" if interrupted else "finished")
        self._store.mark_thread_status(thread_ts, status)

        active = self._active_by_thread.pop(thread_ts, None)
        channel_id = None
        session = self._store.get_thread_session(thread_ts)
        if session is not None:
            channel_id = str(session["channel_id"])

        if channel_id is None:
            return

        project_threads = self._active_by_project.get(channel_id)
        if project_threads is None:
            return

        project_threads.discard(thread_ts)
        if not project_threads:
            self._active_by_project.pop(channel_id, None)
