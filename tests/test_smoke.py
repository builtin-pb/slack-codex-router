from slack_codex_router.main import build_parser


def test_build_parser_exposes_run_subcommand() -> None:
    parser = build_parser()
    choices = parser._subparsers._group_actions[0].choices
    assert "run" in choices
