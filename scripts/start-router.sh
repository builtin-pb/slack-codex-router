#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

echo "v2 is not ready yet; delegating to archived legacy/v1 router." >&2
exec "$ROOT_DIR/legacy/v1/scripts/start-router-v1.sh" "$@"
