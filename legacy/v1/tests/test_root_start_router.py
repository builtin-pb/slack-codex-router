from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def test_root_start_router_defaults_to_v2_and_only_uses_legacy_when_explicitly_requested(
    tmp_path: Path,
) -> None:
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "scripts"
    legacy_scripts_dir = repo_root / "legacy" / "v1" / "scripts"
    v2_dir = repo_root / "v2"
    fake_bin_dir = repo_root / "fake-bin"
    scripts_dir.mkdir(parents=True)
    legacy_scripts_dir.mkdir(parents=True)
    v2_dir.mkdir()
    fake_bin_dir.mkdir()

    source_script = Path(__file__).resolve().parents[3] / "scripts" / "start-router.sh"
    script_path = scripts_dir / "start-router.sh"
    script_path.write_text(source_script.read_text(encoding="utf-8"), encoding="utf-8")
    script_path.chmod(source_script.stat().st_mode | stat.S_IXUSR)

    (v2_dir / "package.json").write_text('{"name":"slack-codex-router-v2"}\n', encoding="utf-8")
    _write_executable(legacy_scripts_dir / "start-router-v1.sh", "#!/bin/sh\nprintf 'legacy wrapper invoked %s\\n' \"$*\"\n")
    (v2_dir / "dist" / "bin").mkdir(parents=True)
    (v2_dir / "dist" / "bin" / "launcher.js").write_text(
        "console.log(`v2 launcher invoked ${process.argv.slice(2).join(' ')}`.trim())\n",
        encoding="utf-8",
    )
    _write_executable(fake_bin_dir / "npm", "#!/bin/sh\nexit 0\n")
    _write_executable(
        fake_bin_dir / "node",
        "#!/bin/sh\nshift\nprintf 'v2 launcher invoked %s\\n' \"$*\"\n",
    )

    env = {
        "PATH": f"{fake_bin_dir}:{os.environ.get('PATH', '')}",
    }

    default_result = subprocess.run(
        ["/bin/sh", str(script_path), "--flag", "value"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    explicit_flag_result = subprocess.run(
        ["/bin/sh", str(script_path), "--legacy", "--flag", "value"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    explicit_env_result = subprocess.run(
        ["/bin/sh", str(script_path), "--flag", "value"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        env={**env, "SCR_ROUTER_LEGACY": "1"},
        check=False,
    )

    assert default_result.returncode == 0, default_result.stderr
    assert "v2 is not ready yet; delegating to archived legacy/v1 router." not in default_result.stderr
    assert default_result.stdout.strip() == "v2 launcher invoked --flag value"

    assert explicit_flag_result.returncode == 0, explicit_flag_result.stderr
    assert explicit_flag_result.stdout.strip() == "legacy wrapper invoked --flag value"

    assert explicit_env_result.returncode == 0, explicit_env_result.stderr
    assert explicit_env_result.stdout.strip() == "legacy wrapper invoked --flag value"
