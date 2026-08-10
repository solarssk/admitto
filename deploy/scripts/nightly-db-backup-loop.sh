#!/bin/sh
# Nightly pg_dump sidecar — network auth via POSTGRES_* from .env (no node/DATABASE_URL parser).
# Writes gzip SQL under MIGRATION_BACKUP_DIR (compose volume). Atomic tmp → rename; gzip -t before keep.

set -eu

BACKUP_DIR="${MIGRATION_BACKUP_DIR:-/backups}"
RETENTION_DAYS="${NIGHTLY_BACKUP_RETENTION_DAYS:-14}"
SLEEP_SECONDS="${NIGHTLY_BACKUP_INTERVAL_SECONDS:-86400}"

log() {
  message="$1"
  printf '%s\n' "$message"
}

require_env() {
  if [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_PASSWORD:-}" ] || [ -z "${POSTGRES_DB:-}" ]; then
    log "[db-backup] error: POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB must be set"
    exit 1
  fi
}

run_nightly_backup() {
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_file="${BACKUP_DIR}/nightly-${ts}.sql.gz"
  tmp_sql=""

  if [ ! -d "$BACKUP_DIR" ]; then
    log "[db-backup] ${ts} FAILED (backup directory missing: ${BACKUP_DIR})"
    return 1
  fi

  tmp_sql="$(mktemp)"
  log "[db-backup] ${ts} starting nightly dump"

  export PGPASSWORD="$POSTGRES_PASSWORD"
  if ! pg_dump \
    -h db \
    -p 5432 \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    --no-owner \
    --no-acl \
    > "$tmp_sql"
  then
    rm -f "$tmp_sql" "$backup_file"
    unset PGPASSWORD
    log "[db-backup] ${ts} FAILED (pg_dump)"
    return 1
  fi
  unset PGPASSWORD

  if [ ! -s "$tmp_sql" ]; then
    rm -f "$tmp_sql" "$backup_file"
    log "[db-backup] ${ts} FAILED (empty dump)"
    return 1
  fi

  install -m 600 /dev/null "$backup_file"

  if ! gzip -c "$tmp_sql" > "$backup_file"; then
    rm -f "$tmp_sql" "$backup_file"
    log "[db-backup] ${ts} FAILED (gzip)"
    return 1
  fi

  rm -f "$tmp_sql"

  if ! gzip -t "$backup_file"; then
    rm -f "$backup_file"
    log "[db-backup] ${ts} FAILED (gzip -t integrity)"
    return 1
  fi

  # shellcheck disable=SC2046
  size_bytes="$(wc -c < "$backup_file" | tr -d ' ')"
  log "[db-backup] ${ts} OK (${size_bytes} bytes)"

  if [ "$RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
    find "$BACKUP_DIR" -name 'nightly-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
  fi

  return 0
}

require_env

while true; do
  run_nightly_backup || true
  sleep "$SLEEP_SECONDS"
done
