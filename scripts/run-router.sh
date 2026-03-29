#!/bin/zsh
set -euo pipefail

cd /Users/builtin.pb/Desktop/Template

if [[ ! -f .env ]]; then
  echo "Missing .env" >&2
  exit 1
fi

set -a
source .env
set +a

exec uv run python -m slack_codex_router.main run
