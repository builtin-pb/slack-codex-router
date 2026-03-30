#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/builtin.pb/Desktop/Template"
ENV_FILE="$ROOT_DIR/.env"
PLIST_SOURCE="$ROOT_DIR/ops/com.builtin.pb.slack-codex-router.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.builtin.pb.slack-codex-router.plist"
SERVICE_LABEL="com.builtin.pb.slack-codex-router"

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

require_env() {
  local key="$1"
  if [[ -z "${(P)key:-}" ]]; then
    echo "Missing required env var: $key" >&2
    exit 1
  fi
}

cd "$ROOT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env at $ENV_FILE" >&2
  exit 1
fi

load_env_file "$ENV_FILE"

require_env "SLACK_BOT_TOKEN"
require_env "SLACK_APP_TOKEN"
require_env "SLACK_ALLOWED_USER_ID"
require_env "SCR_PROJECTS_FILE"
require_env "SCR_STATE_DB"
require_env "SCR_LOG_DIR"
require_env "SCR_GLOBAL_CONCURRENCY"
require_env "SCR_RUN_TIMEOUT_SECONDS"

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT_DIR/logs" "$ROOT_DIR/state"

launchctl setenv SLACK_BOT_TOKEN "$SLACK_BOT_TOKEN"
launchctl setenv SLACK_APP_TOKEN "$SLACK_APP_TOKEN"
launchctl setenv SLACK_ALLOWED_USER_ID "$SLACK_ALLOWED_USER_ID"
launchctl setenv SCR_PROJECTS_FILE "$SCR_PROJECTS_FILE"
launchctl setenv SCR_STATE_DB "$SCR_STATE_DB"
launchctl setenv SCR_LOG_DIR "$SCR_LOG_DIR"
launchctl setenv SCR_GLOBAL_CONCURRENCY "$SCR_GLOBAL_CONCURRENCY"
launchctl setenv SCR_RUN_TIMEOUT_SECONDS "$SCR_RUN_TIMEOUT_SECONDS"

cp "$PLIST_SOURCE" "$PLIST_DEST"

launchctl bootout "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1 || true
launchctl unload "$PLIST_DEST" >/dev/null 2>&1 || true
launchctl load "$PLIST_DEST"
launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL"

echo "Started $SERVICE_LABEL"
