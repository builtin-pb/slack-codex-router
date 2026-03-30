from __future__ import annotations

import stat
import subprocess
from pathlib import Path


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def test_root_start_router_delegates_to_legacy_v1_even_when_v2_workspace_exists(tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    scripts_dir = repo_root / "scripts"
    legacy_scripts_dir = repo_root / "legacy" / "v1" / "scripts"
    v2_dir = repo_root / "v2"
    scripts_dir.mkdir(parents=True)
    legacy_scripts_dir.mkdir(parents=True)
    v2_dir.mkdir()

    source_script = Path(__file__).resolve().parents[3] / "scripts" / "start-router.sh"
    script_path = scripts_dir / "start-router.sh"
    script_path.write_text(source_script.read_text(encoding="utf-8"), encoding="utf-8")
    script_path.chmod(source_script.stat().st_mode | stat.S_IXUSR)

    (v2_dir / "package.json").write_text('{"name":"slack-codex-router-v2"}\n', encoding="utf-8")
    _write_executable(
        legacy_scripts_dir / "start-router-v1.sh",
        "#!/bin/sh\nprintf 'legacy wrapper invoked %s\\n' \"$*\"\n",
    )

    result = subprocess.run(
        ["/bin/sh", str(script_path), "--flag", "value"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "v2 is not ready yet; delegating to archived legacy/v1 router." in result.stderr
    assert result.stdout.strip() == "legacy wrapper invoked --flag value"
