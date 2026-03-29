from pathlib import Path

from slack_codex_router.store import RouterStore


def test_upsert_thread_session_persists_codex_thread_id(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")

    store.upsert_thread_session(
        thread_ts="1710000000.100000",
        channel_id="C123",
        codex_thread_id="019d38b3-48fe-7790-a2e3-d9a5f81b450a",
        status="running",
        last_user_message_ts="1710000000.100000",
    )

    store.upsert_thread_session(
        thread_ts="1710000000.100000",
        channel_id="C123",
        codex_thread_id="111d38b3-48fe-7790-a2e3-d9a5f81b450b",
        status="finished",
        last_user_message_ts="1710000000.200000",
    )

    session = store.get_thread_session("1710000000.100000")
    assert session is not None
    assert session["thread_ts"] == "1710000000.100000"
    assert session["codex_thread_id"] == "111d38b3-48fe-7790-a2e3-d9a5f81b450b"
    assert session["status"] == "finished"
    assert session["last_user_message_ts"] == "1710000000.200000"


def test_mark_job_finished_persists_summary(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    job_id = store.start_job(
        thread_ts="1710000000.100000",
        pid=4242,
        log_path=str(tmp_path / "job.log"),
    )

    store.finish_job(job_id=job_id, exit_code=0, interrupted=False, summary="READY")
    job = store.get_latest_job("1710000000.100000")

    assert job["exit_code"] == 0
    assert job["interrupted"] == 0
    assert job["last_result_summary"] == "READY"


def test_get_latest_job_returns_newest_for_thread(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    first_job_id = store.start_job(
        thread_ts="1710000000.100000",
        pid=1000,
        log_path=str(tmp_path / "first.log"),
    )
    second_job_id = store.start_job(
        thread_ts="1710000000.100000",
        pid=1001,
        log_path=str(tmp_path / "second.log"),
    )

    store.finish_job(job_id=first_job_id, exit_code=1, interrupted=True, summary="OLD")
    store.finish_job(job_id=second_job_id, exit_code=0, interrupted=False, summary="NEW")

    job = store.get_latest_job("1710000000.100000")
    assert job is not None
    assert job["job_id"] == second_job_id
    assert "thread_ts" in job.keys()
    assert job["last_result_summary"] == "NEW"
    assert job["interrupted"] == 0
