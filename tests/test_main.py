from pathlib import Path

import slack_codex_router.main as main_module
from slack_codex_router.config import AppConfig
from slack_codex_router.registry import ProjectConfig, ProjectRegistry


def test_main_creates_log_dir_before_starting_handler(
    tmp_path: Path,
    monkeypatch,
) -> None:
    projects_file = tmp_path / "projects.yaml"
    state_db = tmp_path / "state" / "router.sqlite3"
    log_dir = tmp_path / "logs"
    registry = ProjectRegistry(
        {
            "C123": ProjectConfig(
                channel_id="C123",
                name="demo",
                path=tmp_path / "project",
                max_concurrent_jobs=2,
            )
        }
    )
    started: list[bool] = []

    class FakeHandler:
        def start(self) -> None:
            started.append(True)

    monkeypatch.setattr(
        main_module,
        "load_config",
        lambda: AppConfig(
            slack_bot_token="xoxb-test",
            slack_app_token="xapp-test",
            allowed_user_id="U123",
            projects_file=projects_file,
            state_db=state_db,
            log_dir=log_dir,
            global_concurrency=4,
            run_timeout_seconds=1800,
        ),
    )
    monkeypatch.setattr(main_module.ProjectRegistry, "from_yaml", lambda path: registry)
    monkeypatch.setattr(main_module, "build_app", lambda *, bot_token, app_token, router: FakeHandler())
    monkeypatch.setattr(main_module, "build_parser", lambda: type("Parser", (), {"parse_args": lambda self: type("Args", (), {"command": "run"})()})())

    assert not log_dir.exists()

    result = main_module.main()

    assert result == 0
    assert log_dir.is_dir()
    assert started == [True]
