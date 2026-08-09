#!/bin/sh
set -eu

SCHEMA="packages/db/prisma/schema.prisma"
CONFIG="packages/db/prisma.config.ts"

log() {
  printf '%s\n' "$*" >&2
}

# A no-op unless run as root — chown needs root; both `app` and `migrate` run as `node`, so this
# only matters if a filesystem was created by a different container (e.g. a fresh bind mount) with
# root ownership before the app user could write to it.
ensure_emergency_export_dir_permissions() {
  export_dir="${EMERGENCY_EXPORT_DIR:-/app/emergency-exports}"
  if [ "$(id -u)" != "0" ]; then
    return 0
  fi
  mkdir -p "$export_dir"
  chown node:node "$export_dir"
  chmod 700 "$export_dir"
}

quote_cmd_args() {
  node -e 'console.log(process.argv.slice(1).map((a) => JSON.stringify(a)).join(" "))' "$@"
}

run_as_node() {
  if [ "$(id -u)" = "0" ]; then
    # shellcheck disable=SC2046
    exec su -s /bin/sh node -c "exec $(quote_cmd_args "$@")"
  fi
  exec "$@"
}

run_as_node_cmd() {
  if [ "$(id -u)" = "0" ]; then
    # shellcheck disable=SC2046
    su -s /bin/sh node -c "exec $(quote_cmd_args "$@")"
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
  ensure_emergency_export_dir_permissions
  run_as_node "$@"
fi

# "serve": the app service — migration/backfill already ran to completion in the migrate service
# (compose depends_on: condition: service_completed_successfully).
# Retention runs only on the Admitto worker (ADR 0042), not on every app start.
if [ "${1:-}" = "serve" ]; then
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

ensure_emergency_export_dir_permissions

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

log "migrate: startup tasks complete"
