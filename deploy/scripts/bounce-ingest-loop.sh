#!/bin/sh
# Bounce / NDR IMAP ingest loop - same shape as nightly-db-backup-loop.sh.
# Runs compiled Admitto CLI on the app image (entrypoint overridden in compose).
# Sleep is a wake tick; per-event Check every (poll_interval_minutes) gates due work.

set -eu

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

run_once() {
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! out="$(node packages/mail-delivery/dist/cli.js ingest-bounces 2>&1)"; then
    log "[bounce-ingest] ${ts} FAILED (${out})"
    return 1
  fi
  # Prefer a compact OK line; full JSON remains in container logs via the CLI stdout above.
  log "[bounce-ingest] ${ts} OK"
  if [ -n "$out" ]; then
    printf '%s\n' "$out"
  fi
  return 0
}

cd /app

while true; do
  run_once || true
  sleep "$SLEEP_SECONDS"
done
