from pathlib import Path

from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectConfig, ProjectRegistry
from slack_codex_router.slack_app import SlackRouter
from slack_codex_router.store import RouterStore


class FakeRunner:
    def start(self, project_path: Path, prompt: str):
        output_file = project_path / ".codex-last.txt"
        output_file.write_text("Final summary from Codex", encoding="utf-8")
        return type(
            "Run",
            (),
            {
                "thread_id": "session-1",
                "pid": 1001,
                "process": None,
                "output_file": output_file,
                "log_path": project_path / ".codex-run.log",
            },
        )()

    def resume(self, project_path: Path, session_id: str, prompt: str):
        output_file = project_path / ".codex-last.txt"
        output_file.write_text("Updated final summary from Codex", encoding="utf-8")
        return type(
            "Run",
            (),
            {
                "thread_id": session_id,
                "pid": 1002,
                "process": None,
                "output_file": output_file,
                "log_path": project_path / ".codex-run.log",
            },
        )()

    def interrupt(self, run) -> None:
        return None

    def wait(self, run) -> tuple[int, str]:
        return (0, run.output_file.read_text(encoding="utf-8"))


def test_publish_completion_posts_summary_back_into_thread(tmp_path: Path) -> None:
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
    manager = JobManager(store=store, runner=FakeRunner(), global_limit=4, run_timeout_seconds=1800)
    router = SlackRouter(allowed_user_id="U123", registry=registry, manager=manager, store=store)
    replies: list[str] = []

    router.handle_message(
        {
            "user": "U123",
            "channel": "C123",
            "ts": "1710000000.100000",
            "text": "inspect this repo",
        },
        replies.append,
    )
    manager.complete_thread(
        "1710000000.100000",
        exit_code=0,
        summary="Final summary from Codex",
        interrupted=False,
    )
    router.publish_completion(
        channel_id="C123",
        thread_ts="1710000000.100000",
        summary="Final summary from Codex",
        interrupted=False,
        reply=replies.append,
    )

    assert replies[-1] == "Finished Codex run.\n\nFinal summary from Codex"
