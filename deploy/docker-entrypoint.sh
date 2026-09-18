#!/bin/sh
set -eu

SCHEMA="packages/db/prisma/schema.prisma"
CONFIG="packages/db/prisma.config.ts"

log() {
  printf '%s\n' "$*" >&2
}

# Every service runs as the unprivileged `node` user (UID 1000). Compose creates missing bind-mount
# paths as root-owned; validate (or create when the parent allows) before emergency CLI export runs.
ensure_emergency_export_dir_writable() {
  export_dir="${EMERGENCY_EXPORT_DIR:-/app/emergency-exports}"
  if [ ! -d "$export_dir" ] && ! mkdir -p "$export_dir" 2>/dev/null; then
    log "error: emergency export directory does not exist and could not be created: $export_dir"
    log "hint: on the Docker host run: cd deploy && ./scripts/init-host-dirs.sh"
    log "hint: or: mkdir -p emergency-exports uploads && chown 1000:1000 emergency-exports uploads && chmod 700 emergency-exports"
    exit 1
  fi
  if [ ! -w "$export_dir" ]; then
    log "error: emergency export directory is not writable by the app user: $export_dir"
    log "hint: on the Docker host run: cd deploy && ./scripts/init-host-dirs.sh"
    log "hint: or: chown 1000:1000 emergency-exports && chmod 700 emergency-exports"
    exit 1
  fi
}

# A corporate/self-hosted deployment with its own MaxMind GeoLite2 license key can set
# MAXMIND_LICENSE_KEY to fetch a fresh copy directly from MaxMind, without rebuilding the image
# (deploy/README.md). Downloaded into a SEPARATE directory from the image's own baked-in
# node-geolite2-redist dataset (/app/data/geoip) - never bind-mount over that path directly: an
# empty host directory there would shadow the baked-in data for everyone who hasn't set a key,
# which is the common case. The marker file avoids re-downloading ~60MB on every restart when the
# key hasn't changed; a failed fetch falls back to the last good download (or, on a first-ever
# failed fetch, to the image's baked-in dataset) rather than breaking app startup.
MAXMIND_DATA_DIR="/app/data/geoip-custom"
MAXMIND_KEY_MARKER="$MAXMIND_DATA_DIR/.maxmind-key-sha256"

maybe_refresh_geoip_from_maxmind() {
  key="${MAXMIND_LICENSE_KEY:-}"
  [ -n "$key" ] || return 0
  key_hash="$(printf '%s' "$key" | sha256sum | cut -d' ' -f1)"
  if [ -f "$MAXMIND_KEY_MARKER" ] && [ "$(cat "$MAXMIND_KEY_MARKER")" = "$key_hash" ]; then
    log "geoip: MAXMIND_LICENSE_KEY unchanged - reusing the already-downloaded dataset"
    export ILA_DATA_DIR="$MAXMIND_DATA_DIR"
    return 0
  fi
  log "geoip: MAXMIND_LICENSE_KEY set - fetching the GeoLite2 City database from MaxMind"
  mkdir -p "$MAXMIND_DATA_DIR"
  if ILA_LICENSE_KEY="$key" ILA_FIELDS=country,city ILA_DATA_DIR="$MAXMIND_DATA_DIR" ILA_AUTO_UPDATE=false \
      node apps/web/scripts/prefetch-geo-db.mjs; then
    printf '%s' "$key_hash" >"$MAXMIND_KEY_MARKER"
    export ILA_DATA_DIR="$MAXMIND_DATA_DIR"
    log "geoip: MaxMind dataset ready"
  elif [ -f "$MAXMIND_KEY_MARKER" ]; then
    log "geoip: warning: MaxMind fetch failed - reusing the last known-good dataset"
    export ILA_DATA_DIR="$MAXMIND_DATA_DIR"
  else
    log "geoip: warning: MaxMind fetch failed and no prior dataset exists - falling back to the built-in community-mirror dataset"
  fi
}

run_as_node() {
  if [ "$(id -u)" = "0" ]; then
    # Argv goes to `su` as positional args after `--`, not spliced into the -c string, so no
    # argument content is ever re-parsed by a shell (a JSON.stringify-escaped arg containing a
    # literal $(...) or ${...} would otherwise be command-substituted inside the double-quoted
    # -c string this used to build). `-c`'s command runs as `sh -c 'exec "$0" "$@"' "$@"`, so $0
    # is the program and "$@" is the rest - same as directly invoking "$@" below.
    exec su -s /bin/sh node -c 'exec "$0" "$@"' -- "$@"
  fi
  exec "$@"
}

run_as_node_cmd() {
  if [ "$(id -u)" = "0" ]; then
    su -s /bin/sh node -c 'exec "$0" "$@"' -- "$@"
  else
    "$@"
  fi
}

migration_status_output() {
  # --config: WORKDIR here is /app, not packages/db/ where prisma.config.ts lives — auto-discovery
  # only looks in CWD, so this must be explicit (Prisma v7 prisma.config.ts monorepo resolution).
  run_as_node_cmd node node_modules/prisma/build/index.js migrate status --schema "$SCHEMA" --config "$CONFIG" 2>&1
}

is_connection_error() {
  check_output="$1"
  printf '%s' "$check_output" | grep -qiE 'P1001|Can.t reach database|ECONNREFUSED|connection refused|authentication failed|password authentication failed|no pg_hba'
}

has_pending_migrations() {
  check_output="$1"
  printf '%s' "$check_output" | grep -q 'have not yet been applied'
}

has_failed_migrations() {
  check_output="$1"
  printf '%s' "$check_output" | grep -q 'have failed'
}

is_schema_up_to_date() {
  check_output="$1"
  printf '%s' "$check_output" | grep -q 'Database schema is up to date'
}

# docker compose run --rm app node packages/auth/dist/cli.js bootstrap-superadmin
if [ "${1:-}" = "npm" ] || [ "${1:-}" = "npx" ]; then
  log "npm/npx are not available in the production image. Use: node <script> ..."
  exit 64
fi

if [ "${1:-}" = "node" ]; then
  ensure_emergency_export_dir_writable
  run_as_node "$@"
fi

# "serve": the app service — migration/backfill already ran to completion in the migrate service
# (compose depends_on: condition: service_completed_successfully).
# Retention runs only on the Admitto worker (ADR 0042), not on every app start.
if [ "${1:-}" = "serve" ]; then
  maybe_refresh_geoip_from_maxmind
  exec node apps/web/dist/src/index.js
fi

# "worker": background jobs (mail drain, import/export, bounce, retention). Same image as app.
if [ "${1:-}" = "worker" ]; then
  exec node apps/cli/dist/index.js worker
fi

if [ "${1:-}" != "migrate" ]; then
  log "usage: docker-entrypoint.sh migrate|serve|worker|node <script> ..."
  exit 64
fi

set +e
status_out="$(migration_status_output)"
status_exit=$?
set -e

if is_connection_error "$status_out"; then
  log "error: database unreachable — cannot check migration status or migrate"
  log "$status_out"
  exit 1
fi

if has_failed_migrations "$status_out"; then
  log "error: failed migrations detected — resolve before restart (fail-closed)"
  log "$status_out"
  exit 1
fi

# has_pending_migrations / is_schema_up_to_date are the only two known-good states; anything else
# with a nonzero exit is an unrecognized `migrate status` output — fail-closed rather than deploy
# against a schema state we don't understand. Backup is the operator's responsibility (ADR 0043),
# not a step here — both branches proceed straight to `migrate deploy`.
if has_pending_migrations "$status_out" || is_schema_up_to_date "$status_out"; then
  : # known state — proceed
elif [ "$status_exit" -ne 0 ]; then
  log "error: prisma migrate status failed with unknown output — aborting (fail-closed)"
  log "$status_out"
  exit 1
fi

run_as_node_cmd node node_modules/prisma/build/index.js migrate deploy --schema "$SCHEMA" --config "$CONFIG"
log "running agency public_ref backfill with 120s timeout"
run_as_node_cmd timeout 120 node packages/db/dist/scripts/backfill-public-ref.js
log "running event custom-field registry backfill with 120s timeout"
run_as_node_cmd timeout 120 node packages/db/dist/scripts/backfill-event-custom-fields.js
log "running ticket-type catalog backfill with 120s timeout"
run_as_node_cmd timeout 120 node packages/db/dist/scripts/backfill-ticket-types.js
log "running check-in session-id backfill with 120s timeout"
run_as_node_cmd timeout 120 node packages/db/dist/scripts/backfill-checkin-session-id.js
log "running event actor-attribution backfill with 120s timeout"
run_as_node_cmd timeout 120 node packages/db/dist/scripts/backfill-event-actor-attribution.js
log "running email delivery template-label-snapshot backfill with 120s timeout"
run_as_node_cmd timeout 120 node packages/db/dist/scripts/backfill-email-delivery-template-label-snapshot.js
log "running email delivery had-wallet-cta backfill with 120s timeout"
run_as_node_cmd timeout 120 node packages/db/dist/scripts/backfill-email-delivery-had-wallet-cta.js
log "running JIT password-hash backfill with 120s timeout"
run_as_node_cmd timeout 120 node packages/db/dist/scripts/backfill-jit-password-hash.js

log "migrate: startup tasks complete"
