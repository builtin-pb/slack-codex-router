#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LEGACY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ROOT_DIR=$(CDPATH= cd -- "$LEGACY_DIR/../.." && pwd)
V1_SRC_DIR="$LEGACY_DIR/src"
ENV_FILE=${SCR_ENV_FILE:-"$ROOT_DIR/.env"}
SERVICE_NAME="slack-codex-router"
SERVICE_LABEL="com.slack-codex-router"

load_env_file() {
  env_file=$1

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"

    case "$line" in
      ""|\#*)
        continue
        ;;
      export\ *)
        line=${line#export }
        ;;
    esac

    case "$line" in
      *=*)
        ;;
      *)
        continue
        ;;
    esac

    key=${line%%=*}
    value=${line#*=}

    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    case "$key" in
      [A-Za-z_][A-Za-z0-9_]*)
        export "$key=$value"
        ;;
    esac
  done < "$env_file"
}

require_env() {
  key=$1
  eval "value=\${$key-}"
  if [ -z "${value:-}" ]; then
    echo "Missing required env var: $key" >&2
    exit 1
  fi
}

default_env() {
  key=$1
  default_value=$2
  eval "value=\${$key-}"
  if [ -z "${value:-}" ]; then
    export "$key=$default_value"
  fi
}

require_command() {
  command_name=$1
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

resolve_path() {
  path_value=$1
  case "$path_value" in
    /*)
      printf '%s\n' "$path_value"
      ;;
    *)
      printf '%s\n' "$ROOT_DIR/$path_value"
      ;;
  esac
}

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\&apos;/g"
}

write_launchd_plist() {
  plist_path=$1
  uv_bin=$2
  stdout_log=$3
  stderr_log=$4
  command_string="cd $(shell_quote "$ROOT_DIR") && export SCR_ROOT_DIR=$(shell_quote "$ROOT_DIR") && export PYTHONPATH=$(shell_quote "$V1_SRC_DIR") && exec $(shell_quote "$uv_bin") run python -m slack_codex_router.main run"

  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$SERVICE_LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-lc</string>
    <string>$(xml_escape "$command_string")</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$ROOT_DIR")</string>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$stdout_log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$stderr_log")</string>
</dict>
</plist>
EOF
}

write_systemd_unit() {
  unit_path=$1
  uv_bin=$2
  command_string="cd $(shell_quote "$ROOT_DIR") && export SCR_ROOT_DIR=$(shell_quote "$ROOT_DIR") && export PYTHONPATH=$(shell_quote "$V1_SRC_DIR") && exec $(shell_quote "$uv_bin") run python -m slack_codex_router.main run"

  cat > "$unit_path" <<EOF
[Unit]
Description=Slack Codex Router
After=default.target

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
Environment=SCR_ROOT_DIR=$ROOT_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/bin/sh -lc $(shell_quote "$command_string")
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing .env at $ENV_FILE" >&2
  exit 1
fi

load_env_file "$ENV_FILE"

default_env "SCR_PROJECTS_FILE" "config/projects.yaml"
default_env "SCR_STATE_DB" "state/router.sqlite3"
default_env "SCR_LOG_DIR" "logs"
default_env "SCR_GLOBAL_CONCURRENCY" "4"
default_env "SCR_RUN_TIMEOUT_SECONDS" "1800"
default_env "SCR_THREAD_ID_TIMEOUT_SECONDS" "15"
export SCR_ROOT_DIR="$ROOT_DIR"

require_env "SLACK_BOT_TOKEN"
require_env "SLACK_APP_TOKEN"
require_env "SLACK_ALLOWED_USER_ID"
require_env "SCR_PROJECTS_FILE"
require_env "SCR_STATE_DB"
require_env "SCR_LOG_DIR"
require_env "SCR_GLOBAL_CONCURRENCY"
require_env "SCR_RUN_TIMEOUT_SECONDS"

require_command "uv"
UV_BIN=$(command -v uv)
LOG_DIR_PATH=$(resolve_path "$SCR_LOG_DIR")
STATE_DB_PATH=$(resolve_path "$SCR_STATE_DB")

mkdir -p "$LOG_DIR_PATH" "$(dirname "$STATE_DB_PATH")"

OS_NAME=$(uname -s)

case "$OS_NAME" in
  Darwin)
    require_command "launchctl"
    PLIST_DEST="$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    write_launchd_plist "$PLIST_DEST" "$UV_BIN" "$LOG_DIR_PATH/launchd.stdout.log" "$LOG_DIR_PATH/launchd.stderr.log"

    launchctl setenv SLACK_BOT_TOKEN "$SLACK_BOT_TOKEN"
    launchctl setenv SLACK_APP_TOKEN "$SLACK_APP_TOKEN"
    launchctl setenv SLACK_ALLOWED_USER_ID "$SLACK_ALLOWED_USER_ID"
    launchctl setenv SCR_ROOT_DIR "$SCR_ROOT_DIR"
    launchctl setenv SCR_PROJECTS_FILE "$SCR_PROJECTS_FILE"
    launchctl setenv SCR_STATE_DB "$SCR_STATE_DB"
    launchctl setenv SCR_LOG_DIR "$SCR_LOG_DIR"
    launchctl setenv SCR_GLOBAL_CONCURRENCY "$SCR_GLOBAL_CONCURRENCY"
    launchctl setenv SCR_RUN_TIMEOUT_SECONDS "$SCR_RUN_TIMEOUT_SECONDS"
    launchctl setenv SCR_THREAD_ID_TIMEOUT_SECONDS "$SCR_THREAD_ID_TIMEOUT_SECONDS"

    launchctl bootout "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" >/dev/null 2>&1 || launchctl load "$PLIST_DEST"
    launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL"

    echo "Started $SERVICE_LABEL with launchd"
    ;;
  Linux)
    if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
      UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
      UNIT_PATH="$UNIT_DIR/$SERVICE_NAME.service"
      mkdir -p "$UNIT_DIR"
      write_systemd_unit "$UNIT_PATH" "$UV_BIN"

      systemctl --user daemon-reload
      systemctl --user enable --now "$SERVICE_NAME.service"

      echo "Started $SERVICE_NAME with systemd --user"
    else
      echo "systemd --user not available; running in foreground" >&2
      cd "$ROOT_DIR"
      export PYTHONPATH="$V1_SRC_DIR${PYTHONPATH:+:$PYTHONPATH}"
      exec "$UV_BIN" run python -m slack_codex_router.main run
    fi
    ;;
  *)
    echo "Unsupported operating system: $OS_NAME" >&2
    exit 1
    ;;
esac
