from __future__ import annotations

import argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="slack-codex-router")
    subcommands = parser.add_subparsers(dest="command")
    run_parser = subcommands.add_parser("run")
    run_parser.set_defaults(command="run")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return 0 if args.command == "run" else 1


if __name__ == "__main__":
    raise SystemExit(main())
