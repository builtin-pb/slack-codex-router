from __future__ import annotations

import sqlite3
from pathlib import Path


class RouterStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS thread_sessions (
                    thread_ts TEXT PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    codex_thread_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    last_user_message_ts TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS jobs (
                    job_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_ts TEXT NOT NULL,
                    pid INTEGER NOT NULL,
                    state TEXT NOT NULL DEFAULT 'running',
                    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    ended_at TEXT,
                    exit_code INTEGER,
                    interrupted INTEGER NOT NULL DEFAULT 0,
                    log_path TEXT NOT NULL,
                    last_result_summary TEXT
                );
                """
            )

    def upsert_thread_session(
        self,
        *,
        thread_ts: str,
        channel_id: str,
        codex_thread_id: str,
        status: str,
        last_user_message_ts: str,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO thread_sessions (
                    thread_ts, channel_id, codex_thread_id, status, last_user_message_ts
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(thread_ts) DO UPDATE SET
                    channel_id = excluded.channel_id,
                    codex_thread_id = excluded.codex_thread_id,
                    status = excluded.status,
                    last_user_message_ts = excluded.last_user_message_ts,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (thread_ts, channel_id, codex_thread_id, status, last_user_message_ts),
            )

    def get_thread_session(self, thread_ts: str) -> sqlite3.Row | None:
        with self._connect() as connection:
            return connection.execute(
                "SELECT * FROM thread_sessions WHERE thread_ts = ?",
                (thread_ts,),
            ).fetchone()

    def mark_thread_status(self, thread_ts: str, status: str, last_user_message_ts: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE thread_sessions
                SET status = ?, last_user_message_ts = ?, updated_at = CURRENT_TIMESTAMP
                WHERE thread_ts = ?
                """,
                (status, last_user_message_ts, thread_ts),
            )

    def start_job(self, *, thread_ts: str, pid: int, log_path: str) -> int:
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO jobs (thread_ts, pid, log_path) VALUES (?, ?, ?)",
                (thread_ts, pid, log_path),
            )
            return int(cursor.lastrowid)

    def finish_job(self, *, job_id: int, exit_code: int, interrupted: bool, summary: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE jobs
                SET state = ?, ended_at = CURRENT_TIMESTAMP, exit_code = ?, interrupted = ?, last_result_summary = ?
                WHERE job_id = ?
                """,
                ("interrupted" if interrupted else "finished", exit_code, int(interrupted), summary, job_id),
            )

    def get_latest_job(self, thread_ts: str) -> sqlite3.Row | None:
        with self._connect() as connection:
            return connection.execute(
                """
                SELECT * FROM jobs
                WHERE thread_ts = ?
                ORDER BY job_id DESC
                LIMIT 1
                """,
                (thread_ts,),
            ).fetchone()
