from pathlib import Path

import pytest
from slack_bolt import App as BoltApp

from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectConfig, ProjectRegistry
import slack_codex_router.slack_app as slack_app_module
from slack_codex_router.slack_app import SlackRouter, build_app
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


def test_top_level_message_starts_new_thread_and_follow_up_resumes(tmp_path: Path) -> None:
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
    watch_calls: list[tuple[str, str, str]] = []

    router.start_completion_watch = lambda *, channel_id, thread_ts, expected_message_ts, reply: watch_calls.append(  # type: ignore[method-assign]
        (channel_id, thread_ts, expected_message_ts)
    )

    router.handle_message(
        {
            "user": "U123",
            "channel": "C123",
            "ts": "1710000000.100000",
            "text": "inspect this repo",
        },
        replies.append,
    )
    router.handle_message(
        {
            "user": "U123",
            "channel": "C123",
            "thread_ts": "1710000000.100000",
            "ts": "1710000001.100000",
            "text": "only touch docs",
        },
        replies.append,
    )

    session = store.get_thread_session("1710000000.100000")
    assert session["codex_thread_id"] == "session-1"
    assert watch_calls == [
        ("C123", "1710000000.100000", "1710000000.100000"),
        ("C123", "1710000000.100000", "1710000001.100000"),
    ]
    assert replies == [
        "Started Codex task for project `demo`.",
        "Interrupted prior run and resumed the Codex session with the latest message.",
    ]


def test_handle_message_rejects_invalid_requests_and_surfaces_limit_errors(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    registry = ProjectRegistry(
        {
            "C123": ProjectConfig(
                channel_id="C123",
                name="demo",
                path=tmp_path,
                max_concurrent_jobs=1,
            )
        }
    )
    manager = JobManager(store=store, runner=FakeRunner(), global_limit=4, run_timeout_seconds=1800)
    router = SlackRouter(allowed_user_id="U123", registry=registry, manager=manager, store=store)
    invalid_replies: list[str] = []
    limit_replies: list[str] = []

    router.start_completion_watch = lambda *, channel_id, thread_ts, expected_message_ts, reply: None  # type: ignore[method-assign]

    router.handle_message(
        {
            "user": "U999",
            "channel": "C123",
            "ts": "1710000000.100000",
            "text": "inspect this repo",
        },
        invalid_replies.append,
    )
    router.handle_message(
        {
            "user": "U123",
            "channel": "C999",
            "ts": "1710000000.100000",
            "text": "inspect this repo",
        },
        invalid_replies.append,
    )
    router.handle_message(
        {
            "user": "U123",
            "channel": "C123",
            "ts": "1710000000.100000",
            "text": "   ",
        },
        invalid_replies.append,
    )

    assert invalid_replies == [
        "User is not allowed to control this router.",
        "This channel is not registered to a project.",
        "Send a non-empty message to start or continue a task.",
    ]

    router.handle_message(
        {
            "user": "U123",
            "channel": "C123",
            "ts": "1710000000.100000",
            "text": "first task",
        },
        limit_replies.append,
    )

    with pytest.raises(RuntimeError, match="Project concurrency limit reached"):
        router.handle_message(
            {
                "user": "U123",
                "channel": "C123",
                "ts": "1710000001.100000",
                "text": "second task",
            },
            limit_replies.append,
        )

    assert limit_replies == ["Started Codex task for project `demo`."]


def test_threaded_reply_without_stored_session_is_rejected(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    registry = ProjectRegistry(
        {
            "C123": ProjectConfig(
                channel_id="C123",
                name="demo",
                path=tmp_path,
                max_concurrent_jobs=1,
            )
        }
    )
    manager = JobManager(store=store, runner=FakeRunner(), global_limit=4, run_timeout_seconds=1800)
    router = SlackRouter(allowed_user_id="U123", registry=registry, manager=manager, store=store)
    replies: list[str] = []
    watch_calls: list[tuple[str, str, str]] = []

    router.start_completion_watch = lambda *, channel_id, thread_ts, expected_message_ts, reply: watch_calls.append(  # type: ignore[method-assign]
        (channel_id, thread_ts, expected_message_ts)
    )

    router.handle_message(
        {
            "user": "U123",
            "channel": "C123",
            "thread_ts": "1710000000.100000",
            "ts": "1710000001.100000",
            "text": "follow up",
        },
        replies.append,
    )

    assert replies == ["This thread has no stored Codex session yet."]
    assert watch_calls == []


def test_build_app_ignores_subtypes_and_events_without_user(monkeypatch: pytest.MonkeyPatch) -> None:
    created_apps: dict[str, BoltApp] = {}

    def app_factory(*, token: str) -> BoltApp:
        app = BoltApp(
            token=token,
            token_verification_enabled=False,
            request_verification_enabled=False,
        )
        created_apps["app"] = app
        return app

    monkeypatch.setattr(slack_app_module, "App", app_factory)

    class RecordingRouter:
        def __init__(self) -> None:
            self.events: list[dict[str, object]] = []

        def handle_message(self, event, reply) -> None:
            self.events.append(dict(event))
            reply("routed")

    router = RecordingRouter()
    handler = build_app(bot_token="x", app_token="y", router=router)
    listener = created_apps["app"]._listeners[0]
    replies: list[dict[str, str]] = []

    listener.ack_function(
        {
            "subtype": "message_changed",
            "user": "U123",
            "channel": "C123",
            "ts": "1710000000.100000",
            "text": "ignore me",
        },
        lambda **kwargs: replies.append(kwargs),
    )
    listener.ack_function(
        {
            "channel": "C123",
            "ts": "1710000001.100000",
            "text": "also ignore me",
        },
        lambda **kwargs: replies.append(kwargs),
    )
    listener.ack_function(
        {
            "user": "U123",
            "channel": "C123",
            "ts": "1710000002.100000",
            "text": "route me",
        },
        lambda **kwargs: replies.append(kwargs),
    )

    assert handler.app is created_apps["app"]
    assert router.events == [
        {
            "user": "U123",
            "channel": "C123",
            "ts": "1710000002.100000",
            "text": "route me",
        }
    ]
    assert replies == [{"text": "routed", "thread_ts": "1710000002.100000"}]
