from __future__ import annotations

import argparse

from slack_codex_router.config import load_config
from slack_codex_router.registry import ProjectRegistry


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="slack-codex-router")
    subcommands = parser.add_subparsers(dest="command")
    run_parser = subcommands.add_parser("run")
    run_parser.set_defaults(command="run")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.command != "run":
        return 1

    config = load_config()
    ProjectRegistry.from_yaml(config.projects_file)
    config.log_dir.mkdir(parents=True, exist_ok=True)
    config.state_db.parent.mkdir(parents=True, exist_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
