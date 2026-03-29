from __future__ import annotations

import time
from dataclasses import dataclass

from slack_codex_router.registry import ProjectConfig
from slack_codex_router.store import RouterStore


_TRANSITIONING = object()


class StaleWatcherError(RuntimeError):
    pass


@dataclass
class ActiveRun:
    thread_ts: str
    session_id: str
    pid: int
    run: object


class JobManager:
    def __init__(
        self,
        *,
        store: RouterStore,
        runner,
        global_limit: int,
        run_timeout_seconds: int,
        follow_up_stop_timeout_seconds: float = 5.0,
    ) -> None:
        self._store = store
        self._runner = runner
        self._global_limit = global_limit
        self._run_timeout_seconds = run_timeout_seconds
        self._follow_up_stop_timeout_seconds = follow_up_stop_timeout_seconds
        self._active_by_thread: dict[str, ActiveRun | object] = {}
        self._active_by_project: dict[str, set[str]] = {}

    def active_thread_count(self) -> int:
        return len(self._active_by_thread)

    def _assert_current_watcher(self, thread_ts: str, expected_message_ts: str | None) -> None:
        if expected_message_ts is None:
            return

        session = self._store.get_thread_session(thread_ts)
        if session is None:
            raise RuntimeError(f"No thread session found for thread {thread_ts}")

        if str(session["last_user_message_ts"]) != expected_message_ts:
            raise StaleWatcherError(f"Watcher for thread {thread_ts} is obsolete")

    def _remove_active_tracking(self, thread_ts: str, channel_id: str) -> None:
        self._active_by_thread.pop(thread_ts, None)
        project_threads = self._active_by_project.get(channel_id)
        if project_threads is None:
            return

        project_threads.discard(thread_ts)
        if not project_threads:
            self._active_by_project.pop(channel_id, None)

    def _resolve_active_for_wait(
        self,
        thread_ts: str,
        *,
        expected_message_ts: str | None,
        wait_for_transition_without_owner: bool = False,
    ) -> ActiveRun | None:
        deadline = time.monotonic() + self._follow_up_stop_timeout_seconds
        while True:
            active = self._active_by_thread.get(thread_ts)
            if active is None:
                if expected_message_ts is not None:
                    self._assert_current_watcher(thread_ts, expected_message_ts)
                return None
            if isinstance(active, ActiveRun):
                if expected_message_ts is not None:
                    self._assert_current_watcher(thread_ts, expected_message_ts)
                return active
            if expected_message_ts is None and not wait_for_transition_without_owner:
                raise RuntimeError(f"Thread {thread_ts} is transitioning between Codex runs")
            if expected_message_ts is not None:
                self._assert_current_watcher(thread_ts, expected_message_ts)
            if time.monotonic() >= deadline:
                raise RuntimeError(f"Timed out waiting for thread {thread_ts} transition to resolve")
            time.sleep(0.01)

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
        try:
            self._store.upsert_thread_session(
                thread_ts=thread_ts,
                channel_id=channel_id,
                codex_thread_id=run.thread_id,
                status="running",
                last_user_message_ts=user_message_ts,
            )
            self._store.start_job(thread_ts=thread_ts, pid=run.pid, log_path=str(run.log_path))
        except Exception:
            self._stop_launched_run(run, thread_ts=thread_ts)
            self._store.mark_thread_status(
                thread_ts,
                "interrupted",
                last_user_message_ts=user_message_ts,
            )
            self._remove_active_tracking(thread_ts, project.channel_id)
            raise

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
        session = self._store.get_thread_session(thread_ts)
        if session is None:
            raise RuntimeError(f"No thread session found for thread {thread_ts}")

        session_id = str(session["codex_thread_id"])
        current = self._active_by_thread.get(thread_ts)
        if current is not None:
            if not isinstance(current, ActiveRun):
                raise RuntimeError(f"Thread {thread_ts} is transitioning between Codex runs")
            self._active_by_thread[thread_ts] = _TRANSITIONING
            stop_run = getattr(self._runner, "stop", None)
            try:
                if stop_run is not None:
                    stopped = stop_run(current.run, self._follow_up_stop_timeout_seconds)
                    if not stopped:
                        self._active_by_thread[thread_ts] = current
                        raise RuntimeError(f"Timed out stopping active Codex run for thread {thread_ts}")
                else:
                    self._runner.interrupt(current.run)
            except Exception:
                self._active_by_thread[thread_ts] = current
                raise
            latest_job = self._store.get_latest_job(thread_ts)
            if latest_job is not None and str(latest_job["state"]) == "running":
                self._store.finish_job(
                    job_id=int(latest_job["job_id"]),
                    exit_code=130,
                    interrupted=True,
                    summary="",
                )

        self._store.mark_thread_status(
            thread_ts,
            str(session["status"]),
            last_user_message_ts=user_message_ts,
        )

        run = None
        try:
            run = self._runner.resume(project.path, session_id, prompt)
            self._store.upsert_thread_session(
                thread_ts=thread_ts,
                channel_id=channel_id,
                codex_thread_id=session_id,
                status="running",
                last_user_message_ts=user_message_ts,
            )
            self._store.start_job(thread_ts=thread_ts, pid=run.pid, log_path=str(run.log_path))
        except Exception:
            if run is not None:
                self._stop_launched_run(run, thread_ts=thread_ts)
            self._remove_active_tracking(thread_ts, project.channel_id)
            self._store.mark_thread_status(thread_ts, "interrupted")
            raise

        active = ActiveRun(thread_ts=thread_ts, session_id=session_id, pid=run.pid, run=run)
        self._active_by_thread[thread_ts] = active
        self._active_by_project.setdefault(project.channel_id, set()).add(thread_ts)
        return active

    def cancel_thread(self, thread_ts: str) -> bool:
        try:
            current = self._resolve_active_for_wait(
                thread_ts,
                expected_message_ts=None,
                wait_for_transition_without_owner=True,
            )
        except RuntimeError:
            return False
        if current is None:
            return False

        self._runner.interrupt(current.run)

        self._store.mark_thread_status(thread_ts, "cancelled")

        return True

    def wait_for_thread(
        self,
        thread_ts: str,
        *,
        expected_message_ts: str | None = None,
    ) -> tuple[int, str, bool]:
        self._assert_current_watcher(thread_ts, expected_message_ts)
        active = self._resolve_active_for_wait(thread_ts, expected_message_ts=expected_message_ts)
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

        self._assert_current_watcher(thread_ts, expected_message_ts)
        if self._active_by_thread.get(thread_ts) is not active:
            raise StaleWatcherError(f"Watcher for thread {thread_ts} is obsolete")

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

        session = self._store.get_thread_session(thread_ts)
        if session is None:
            return

        self._remove_active_tracking(thread_ts, str(session["channel_id"]))

    def _stop_launched_run(self, run: object, *, thread_ts: str) -> None:
        stop_run = getattr(self._runner, "stop", None)
        if stop_run is not None:
            stopped = stop_run(run, self._follow_up_stop_timeout_seconds)
            if stopped:
                return
            raise RuntimeError(
                f"Timed out stopping launched Codex run for thread {thread_ts} after persistence failure"
            )
        self._runner.interrupt(run)
