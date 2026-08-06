#!/bin/sh
# Bounce / NDR IMAP ingest loop - same shape as nightly-db-backup-loop.sh.
# Runs compiled Admitto CLI on the app image (entrypoint overridden in compose).
# Sleep is a wake tick; per-event Check every (poll_interval_minutes) gates due work.

set -eu

HEARTBEAT_PATH="${BOUNCE_INGEST_HEARTBEAT_PATH:-/tmp/bounce-ingest-heartbeat}"

# Prefer explicit tick. Legacy BOUNCE_INGEST_INTERVAL_SECONDS still accepted as the tick.
if [ -n "${BOUNCE_INGEST_TICK_SECONDS:-}" ]; then
  SLEEP_SECONDS="${BOUNCE_INGEST_TICK_SECONDS}"
elif [ -n "${BOUNCE_INGEST_INTERVAL_SECONDS:-}" ]; then
  SLEEP_SECONDS="${BOUNCE_INGEST_INTERVAL_SECONDS}"
else
  SLEEP_SECONDS=60
fi

log() {
  message="$1"
  printf '%s\n' "$message"
}

# Positive integer only (reject empty, zero, leading zeros, decimals, non-digits).
if ! printf '%s' "$SLEEP_SECONDS" | grep -Eq '^[1-9][0-9]*$'; then
  log "[bounce-ingest] error: BOUNCE_INGEST_TICK_SECONDS (or BOUNCE_INGEST_INTERVAL_SECONDS) must be a positive integer (got: ${SLEEP_SECONDS})"
  exit 1
fi

write_heartbeat() {
  # ISO timestamp; Docker HEALTHCHECK compares file mtime freshness.
  date -u +%Y-%m-%dT%H:%M:%SZ >"$HEARTBEAT_PATH"
}

run_once() {
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! out="$(node packages/mail-delivery/dist/cli.js ingest-bounces 2>&1)"; then
    log "[bounce-ingest] ${ts} FAILED (${out})"
    return 1
  fi
  log "[bounce-ingest] ${ts} OK"
  if [ -n "$out" ]; then
    printf '%s\n' "$out"
  fi
  return 0
}

cd /app

# Seed heartbeat so HEALTHCHECK can pass before the first successful tick completes.
write_heartbeat

while true; do
  if run_once; then
    write_heartbeat
  fi
  sleep "$SLEEP_SECONDS"
done
