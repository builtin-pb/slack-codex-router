from __future__ import annotations

import argparse

from slack_codex_router.codex_runner import CodexRunner
from slack_codex_router.config import load_config
from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectRegistry
from slack_codex_router.slack_app import SlackRouter, build_app
from slack_codex_router.store import RouterStore


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
    config.log_dir.mkdir(parents=True, exist_ok=True)
    registry = ProjectRegistry.from_yaml(config.projects_file)
    store = RouterStore(config.state_db)
    manager = JobManager(
        store=store,
        runner=CodexRunner(thread_id_timeout_seconds=config.thread_id_timeout_seconds),
        global_limit=config.global_concurrency,
        run_timeout_seconds=config.run_timeout_seconds,
    )
    router = SlackRouter(
        allowed_user_id=config.allowed_user_id,
        registry=registry,
        manager=manager,
        store=store,
        bot_token=config.slack_bot_token,
        log_dir=config.log_dir,
    )
    handler = build_app(
        bot_token=config.slack_bot_token,
        app_token=config.slack_app_token,
        router=router,
    )
    handler.start()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
