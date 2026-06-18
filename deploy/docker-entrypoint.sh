#!/bin/sh
set -eu

SCHEMA="packages/db/prisma/schema.prisma"

log() {
  printf '%s\n' "$*" >&2
}

ensure_backup_dir_owned() {
  backup_dir="${MIGRATION_BACKUP_DIR:-/backups}"
  if [ "$(id -u)" = "0" ] && [ -d "$backup_dir" ]; then
    chown node:node "$backup_dir"
  fi
}

run_as_node() {
  if [ "$(id -u)" = "0" ]; then
    exec su -s /bin/sh node -c 'exec "$@"' _ "$@"
  fi
  exec "$@"
}

run_prisma() {
  node node_modules/prisma/build/index.js "$@"
}

load_pg_env_from_database_url() {
  if [ -z "${DATABASE_URL:-}" ]; then
    log "error: DATABASE_URL is not set"
    exit 1
  fi
  # shellcheck disable=SC2046
  eval "$(
    node -e "
      const u = new URL(process.env.DATABASE_URL);
      const q = (s) => JSON.stringify(s);
      console.log('PGHOST=' + q(u.hostname));
      console.log('PGPORT=' + q(u.port || '5432'));
      console.log('PGUSER=' + q(decodeURIComponent(u.username)));
      console.log('PGPASSWORD=' + q(decodeURIComponent(u.password)));
      console.log('PGDATABASE=' + q(decodeURIComponent(u.pathname.replace(/^\\//, ''))));
    "
  )"
  export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
}

migration_status_output() {
  run_prisma migrate status --schema "$SCHEMA" 2>&1
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
  if [ "$(id -u)" = "0" ]; then
    chown node:node "$backup_file"
  fi

  if ! run_pg_dump_to_file "$tmp_sql"; then
    rm -f "$backup_file"
    log "error: pg_dump failed — aborting before migrate deploy"
    exit 1
  fi

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
if [ "${1:-}" = "node" ] || [ "${1:-}" = "npm" ]; then
  run_as_node "$@"
fi

ensure_backup_dir_owned

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

run_prisma migrate deploy --schema "$SCHEMA"
node packages/db/dist/scripts/backfill-public-ref.js

run_as_node node apps/web/dist/src/index.js
