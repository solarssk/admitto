#!/bin/sh
set -eu

SCHEMA="packages/db/prisma/schema.prisma"

log() {
  printf '%s\n' "$*" >&2
}

ensure_backup_dir_permissions() {
  backup_dir="${MIGRATION_BACKUP_DIR:-/backups}"
  if [ "$(id -u)" = "0" ] && [ -d "$backup_dir" ]; then
    chown root:root "$backup_dir"
    chmod 700 "$backup_dir"
  fi
}

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

# Parse DATABASE_URL via node stdout — never eval (password may contain shell metacharacters).
load_pg_env_from_database_url() {
  if [ -z "${DATABASE_URL:-}" ]; then
    log "error: DATABASE_URL is not set"
    exit 1
  fi
  PGHOST="$(node -e "const u = new URL(process.env.DATABASE_URL); process.stdout.write(u.hostname)")"
  PGPORT="$(node -e "const u = new URL(process.env.DATABASE_URL); process.stdout.write(u.port || '5432')")"
  PGUSER="$(node -e "const u = new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.username))")"
  PGPASSWORD="$(node -e "const u = new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.password))")"
  PGDATABASE="$(node -e "const u = new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.pathname.replace(/^\\//, '')))")"
  export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
}

unset_pg_env() {
  unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
}

migration_status_output() {
  run_as_node_cmd node node_modules/prisma/build/index.js migrate status --schema "$SCHEMA" 2>&1
}

is_connection_error() {
  printf '%s' "$1" | grep -qiE 'P1001|Can.t reach database|ECONNREFUSED|connection refused|authentication failed|password authentication failed|no pg_hba'
}

has_pending_migrations() {
  printf '%s' "$1" | grep -q 'have not yet been applied'
}

has_failed_migrations() {
  printf '%s' "$1" | grep -q 'have failed'
}

is_schema_up_to_date() {
  printf '%s' "$1" | grep -q 'Database schema is up to date'
}

check_backup_dir() {
  backup_dir="$1"
  if [ ! -d "$backup_dir" ]; then
    log "error: migration backup directory does not exist: $backup_dir"
    log "hint: mount a backups volume at /backups or set MIGRATION_BACKUP_DISABLE=true for dev/test"
    exit 1
  fi
  if [ ! -w "$backup_dir" ]; then
    log "error: migration backup directory is not writable: $backup_dir"
    exit 1
  fi
}

check_backup_disk_space() {
  backup_dir="$1"
  min_mb="${MIGRATION_BACKUP_MIN_FREE_MB:-512}"
  free_kb="$(df -Pk "$backup_dir" | awk 'NR==2 {print $4}')"
  if [ -z "$free_kb" ]; then
    log "error: could not determine free disk space for $backup_dir"
    exit 1
  fi
  free_mb=$((free_kb / 1024))
  if [ "$free_mb" -lt "$min_mb" ]; then
    log "error: insufficient disk space for pre-migration backup (${free_mb}MB free, need at least ${min_mb}MB)"
    log "hint: raise MIGRATION_BACKUP_MIN_FREE_MB or free space on the backups volume"
    exit 1
  fi
}

run_pg_dump_to_file() {
  tmp_sql="$1"
  # Do not pass DATABASE_URL directly to pg_dump — special characters in passwords break URI parsing.
  pg_dump \
    -h "$PGHOST" \
    -p "$PGPORT" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    --no-owner \
    --no-acl \
    > "$tmp_sql"
}

write_pre_migration_backup() {
  backup_dir="${MIGRATION_BACKUP_DIR:-/backups}"
  retention="${MIGRATION_BACKUP_RETENTION:-10}"
  backup_file="${backup_dir}/pre-migration-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  tmp_sql=""

  check_backup_dir "$backup_dir"
  check_backup_disk_space "$backup_dir"
  load_pg_env_from_database_url

  tmp_sql="$(mktemp)"
  trap 'rm -f "$tmp_sql"' EXIT INT HUP

  install -m 600 /dev/null "$backup_file"

  if ! run_pg_dump_to_file "$tmp_sql"; then
    rm -f "$backup_file"
    unset_pg_env
    log "error: pg_dump failed — aborting before migrate deploy"
    exit 1
  fi
  unset_pg_env

  if ! gzip -c "$tmp_sql" > "$backup_file"; then
    rm -f "$backup_file"
    log "error: gzip failed while writing pre-migration backup"
    exit 1
  fi

  if ! gzip -t "$backup_file"; then
    rm -f "$backup_file"
    log "error: pre-migration backup failed integrity check (gzip -t)"
    exit 1
  fi

  rm -f "$tmp_sql"
  trap - EXIT INT HUP

  log "pre-migration backup written: $backup_file"

  if [ "$retention" -gt 0 ] 2>/dev/null; then
    count=0
    # shellcheck disable=SC2012
    ls -1t "$backup_dir"/pre-migration-*.sql.gz 2>/dev/null | while IFS= read -r f; do
      count=$((count + 1))
      if [ "$count" -gt "$retention" ]; then
        rm -f "$f"
      fi
    done
  fi
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

# "serve": the app service (non-root by default) — migration/backup/backfill already ran to
# completion in the migrate service (compose depends_on: condition: service_completed_successfully),
# so this just execs the server directly, never touching /backups or running as root.
if [ "${1:-}" = "serve" ]; then
  exec node apps/web/dist/src/index.js
fi

if [ "${1:-}" != "migrate" ]; then
  log "usage: docker-entrypoint.sh migrate|serve|node <script> ..."
  exit 64
fi

ensure_backup_dir_permissions
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

if has_pending_migrations "$status_out"; then
  if [ "${MIGRATION_BACKUP_DISABLE:-}" = "true" ]; then
    log "warning: pending migrations detected; MIGRATION_BACKUP_DISABLE=true — skipping pre-migration backup"
  else
    write_pre_migration_backup
  fi
elif is_schema_up_to_date "$status_out"; then
  : # fast path — no backup on routine restarts
elif [ "$status_exit" -ne 0 ]; then
  log "error: prisma migrate status failed with unknown output — aborting (fail-closed)"
  log "$status_out"
  exit 1
fi

run_as_node_cmd node node_modules/prisma/build/index.js migrate deploy --schema "$SCHEMA"
log "running agency public_ref backfill with 120s timeout"
run_as_node_cmd timeout 120 node packages/db/dist/scripts/backfill-public-ref.js
log "running event custom-field registry backfill with 120s timeout"
run_as_node_cmd timeout 120 node packages/db/dist/scripts/backfill-event-custom-fields.js
log "running ticket-type catalog backfill with 120s timeout"
run_as_node_cmd timeout 120 node packages/db/dist/scripts/backfill-ticket-types.js
log "purging expired/revoked auth sessions and trusted devices with 120s timeout"
if ! run_as_node_cmd timeout 120 node packages/auth/dist/cli.js purge-auth-retention; then
  log "warning: auth retention purge failed or timed out; continuing startup"
fi
log "nullifying stale email delivery snapshots with 120s timeout"
if ! run_as_node_cmd timeout 120 node packages/mail-delivery/dist/cli.js nullify-delivery-snapshots; then
  log "warning: email delivery snapshot retention failed or timed out; continuing startup"
fi

log "migrate: startup tasks complete"
