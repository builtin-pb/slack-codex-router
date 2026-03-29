#!/bin/zsh
set -euo pipefail

cd /Users/builtin.pb/Desktop/Template

load_env_file() {
  local env_file="$1"
  local line key value

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"

    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == export[[:space:]]* ]] && line="${line#export }"
    [[ "$line" == *=* ]] || continue

    key="${line%%=*}"
    value="${line#*=}"

    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    [[ "$key" == [A-Za-z_][A-Za-z0-9_]* ]] || continue
    export "$key=$value"
  done < "$env_file"
}

if [[ ! -f .env ]]; then
  echo "Missing .env" >&2
  exit 1
fi

load_env_file .env

exec /Users/builtin.pb/.local/bin/uv run python -m slack_codex_router.main run
