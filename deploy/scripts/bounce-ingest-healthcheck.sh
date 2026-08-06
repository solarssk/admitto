#!/bin/sh
# Docker HEALTHCHECK for bounce-ingest: heartbeat must be fresh within 2× tick + slack.
# Reads the same env vars as bounce-ingest-loop.sh.

set -eu

HEARTBEAT_PATH="${BOUNCE_INGEST_HEARTBEAT_PATH:-/tmp/bounce-ingest-heartbeat}"

if [ -n "${BOUNCE_INGEST_TICK_SECONDS:-}" ]; then
  TICK="$BOUNCE_INGEST_TICK_SECONDS"
elif [ -n "${BOUNCE_INGEST_INTERVAL_SECONDS:-}" ]; then
  TICK="$BOUNCE_INGEST_INTERVAL_SECONDS"
else
  TICK=60
fi

if ! printf '%s' "$TICK" | grep -Eq '^[1-9][0-9]*$'; then
  exit 1
fi

MAX_AGE=$((2 * TICK + 120))
MAX_MIN=$(( (MAX_AGE + 59) / 60 ))

[ -f "$HEARTBEAT_PATH" ] || exit 1
find "$HEARTBEAT_PATH" -mmin "-${MAX_MIN}" | grep -q .
