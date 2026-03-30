from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def test_start_router_installs_systemd_user_unit_from_repo_relative_paths(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "scripts"
    config_dir = repo_root / "config"
    fake_bin = tmp_path / "fake-bin"
    home_dir = tmp_path / "home"
    systemctl_log = tmp_path / "systemctl.log"
    scripts_dir.mkdir(parents=True)
    config_dir.mkdir()
    fake_bin.mkdir()
    home_dir.mkdir()

    source_script = Path(__file__).resolve().parents[1] / "scripts" / "start-router.sh"
    script_path = scripts_dir / "start-router.sh"
    script_path.write_text(source_script.read_text(encoding="utf-8"), encoding="utf-8")
    script_path.chmod(source_script.stat().st_mode | stat.S_IXUSR)

    (repo_root / ".env").write_text(
        "SLACK_BOT_TOKEN=xoxb-test\n"
        "SLACK_APP_TOKEN=xapp-test\n"
        "SLACK_ALLOWED_USER_ID=U123\n"
        "SCR_PROJECTS_FILE=config/projects.yaml\n"
        "SCR_STATE_DB=state/router.sqlite3\n"
        "SCR_LOG_DIR=logs\n"
        "SCR_GLOBAL_CONCURRENCY=4\n"
        "SCR_RUN_TIMEOUT_SECONDS=1800\n",
        encoding="utf-8",
    )
    (config_dir / "projects.yaml").write_text("projects: []\n", encoding="utf-8")

    _write_executable(fake_bin / "uname", "#!/bin/sh\necho Linux\n")
    _write_executable(fake_bin / "uv", "#!/bin/sh\nexit 0\n")
    _write_executable(
        fake_bin / "systemctl",
        f"#!/bin/sh\necho \"$@\" >> {systemctl_log}\nexit 0\n",
    )

    env = os.environ.copy()
    env["HOME"] = str(home_dir)
    env["PATH"] = f"{fake_bin}:{env['PATH']}"

    result = subprocess.run(
        ["/bin/sh", str(script_path)],
        cwd=repo_root,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr

    unit_file = home_dir / ".config" / "systemd" / "user" / "slack-codex-router.service"
    assert unit_file.exists()
    unit_text = unit_file.read_text(encoding="utf-8")
    assert f"WorkingDirectory={repo_root}" in unit_text
    assert f"Environment=SCR_ROOT_DIR={repo_root}" in unit_text
    assert f"EnvironmentFile={repo_root / '.env'}" in unit_text
    assert f"ExecStart={fake_bin / 'uv'} run slack-codex-router run" in unit_text

    systemctl_lines = systemctl_log.read_text(encoding="utf-8").splitlines()
    assert systemctl_lines == [
        "--user show-environment",
        "--user daemon-reload",
        "--user enable --now slack-codex-router.service",
    ]
