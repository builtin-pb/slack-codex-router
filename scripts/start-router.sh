#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

if [ "${1:-}" = "--legacy" ]; then
  shift
  exec "$ROOT_DIR/legacy/v1/scripts/start-router-v1.sh" "$@"
fi

if [ "${SCR_ROUTER_LEGACY:-0}" = "1" ]; then
  exec "$ROOT_DIR/legacy/v1/scripts/start-router-v1.sh" "$@"
fi

cd "$ROOT_DIR"
npm --prefix "$ROOT_DIR/v2" run build >/dev/null
exec node "$ROOT_DIR/v2/dist/bin/launcher.js" "$@"
