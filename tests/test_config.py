from pathlib import Path

from slack_codex_router.config import AppConfig, load_config
from slack_codex_router.registry import ProjectRegistry


def test_load_config_reads_required_environment(tmp_path: Path, monkeypatch) -> None:
    projects_file = tmp_path / "projects.yaml"
    state_db = tmp_path / "router.sqlite3"
    log_dir = tmp_path / "logs"
    projects_file.write_text(
        "projects:\n"
        "  - channel_id: C123\n"
        "    name: demo\n"
        "    path: /tmp/demo\n"
        "    max_concurrent_jobs: 2\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_APP_TOKEN", "xapp-test")
    monkeypatch.setenv("SLACK_ALLOWED_USER_ID", "U123")
    monkeypatch.setenv("SCR_PROJECTS_FILE", str(projects_file))
    monkeypatch.setenv("SCR_STATE_DB", str(state_db))
    monkeypatch.setenv("SCR_LOG_DIR", str(log_dir))

    config = load_config()

    assert config == AppConfig(
        slack_bot_token="xoxb-test",
        slack_app_token="xapp-test",
        allowed_user_id="U123",
        projects_file=projects_file,
        state_db=state_db,
        log_dir=log_dir,
        global_concurrency=4,
        run_timeout_seconds=1800,
    )


def test_project_registry_returns_project_by_channel(tmp_path: Path) -> None:
    projects_file = tmp_path / "projects.yaml"
    project_path = tmp_path / "demo"
    project_path.mkdir()
    projects_file.write_text(
        "projects:\n"
        "  - channel_id: C123\n"
        "    name: demo\n"
        f"    path: {project_path}\n"
        "    max_concurrent_jobs: 2\n",
        encoding="utf-8",
    )

    registry = ProjectRegistry.from_yaml(projects_file)
    project = registry.by_channel("C123")

    assert project is not None
    assert project.name == "demo"
    assert project.path == project_path
    assert project.max_concurrent_jobs == 2
