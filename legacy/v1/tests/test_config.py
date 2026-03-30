from pathlib import Path

import pytest

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
        thread_id_timeout_seconds=15.0,
    )


def test_load_config_resolves_relative_paths_from_root_dir(tmp_path: Path, monkeypatch) -> None:
    root_dir = tmp_path / "repo"
    config_dir = root_dir / "config"
    state_dir = root_dir / "state"
    log_dir = root_dir / "logs"
    config_dir.mkdir(parents=True)
    state_dir.mkdir()
    log_dir.mkdir()
    projects_file = config_dir / "projects.yaml"
    state_db = state_dir / "router.sqlite3"
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
    monkeypatch.setenv("SCR_ROOT_DIR", str(root_dir))
    monkeypatch.setenv("SCR_PROJECTS_FILE", "config/projects.yaml")
    monkeypatch.setenv("SCR_STATE_DB", "state/router.sqlite3")
    monkeypatch.setenv("SCR_LOG_DIR", "logs")

    config = load_config()

    assert config.projects_file == projects_file
    assert config.state_db == state_db
    assert config.log_dir == log_dir


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


def test_project_registry_resolves_relative_paths_from_registry_file(tmp_path: Path) -> None:
    projects_file = tmp_path / "config" / "projects.yaml"
    project_path = tmp_path / "demo"
    project_path.mkdir()
    projects_file.parent.mkdir()
    projects_file.write_text(
        "projects:\n"
        "  - channel_id: C123\n"
        "    name: demo\n"
        "    path: ../demo\n"
        "    max_concurrent_jobs: 2\n",
        encoding="utf-8",
    )

    registry = ProjectRegistry.from_yaml(projects_file)
    project = registry.by_channel("C123")

    assert project is not None
    assert project.path == project_path


def test_project_registry_rejects_duplicate_channel_ids(tmp_path: Path) -> None:
    projects_file = tmp_path / "projects.yaml"
    project_one = tmp_path / "project_one"
    project_two = tmp_path / "project_two"
    project_one.mkdir()
    project_two.mkdir()
    projects_file.write_text(
        "projects:\n"
        "  - channel_id: C123\n"
        "    name: first\n"
        f"    path: {project_one}\n"
        "    max_concurrent_jobs: 2\n"
        "  - channel_id: C123\n"
        "    name: second\n"
        f"    path: {project_two}\n"
        "    max_concurrent_jobs: 2\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Duplicate channel_id 'C123'"):
        ProjectRegistry.from_yaml(projects_file)


def test_project_registry_rejects_missing_project_path(tmp_path: Path) -> None:
    projects_file = tmp_path / "projects.yaml"
    project_path = tmp_path / "missing"
    projects_file.write_text(
        "projects:\n"
        "  - channel_id: C404\n"
        "    name: missing\n"
        f"    path: {project_path}\n"
        "    max_concurrent_jobs: 2\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="does not exist"):
        ProjectRegistry.from_yaml(projects_file)


def test_project_registry_rejects_file_path_for_project(tmp_path: Path) -> None:
    projects_file = tmp_path / "projects.yaml"
    project_file = tmp_path / "demo.txt"
    project_file.write_text("not a directory", encoding="utf-8")
    projects_file.write_text(
        "projects:\n"
        "  - channel_id: CFILE\n"
        "    name: file\n"
        f"    path: {project_file}\n"
        "    max_concurrent_jobs: 2\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="is not a directory"):
        ProjectRegistry.from_yaml(projects_file)
