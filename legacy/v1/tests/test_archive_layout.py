from pathlib import Path


def test_v1_router_is_archived_under_legacy_v1() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    assert (repo_root / "legacy" / "v1" / "src" / "slack_codex_router").is_dir()
    assert (repo_root / "legacy" / "v1" / "scripts" / "start-router-v1.sh").is_file()
    assert (repo_root / "scripts" / "start-router.sh").is_file()
