#!/usr/bin/env bash
# Drop and recreate a local Postgres *_test database (idempotent schema target for migrate deploy).
# Safety: only databases whose name ends with _test; only localhost/127.0.0.1.
set -euo pipefail

DB_NAME="${1:?usage: reset-test-db.sh <database_name>}"
PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-admitto}"
PGPASSWORD="${PGPASSWORD:-admitto}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.yml}"
DB_SERVICE="${DB_SERVICE:-db}"

export PGPASSWORD

if [[ ! "$DB_NAME" =~ _test$ ]]; then
  echo "Refusing to reset ${DB_NAME}: only *_test databases are allowed" >&2
  exit 1
fi

if [[ "$PGHOST" != "localhost" && "$PGHOST" != "127.0.0.1" && "$PGHOST" != "::1" ]]; then
  echo "Refusing to reset on non-local host: ${PGHOST}" >&2
  exit 1
fi

run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql -h "$PGHOST" -U "$PGUSER" "$@"
  else
    docker compose -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" psql -U "$PGUSER" "$@"
  fi
}

run_dropdb() {
  if command -v dropdb >/dev/null 2>&1; then
    dropdb -h "$PGHOST" -U "$PGUSER" --if-exists "$DB_NAME"
  else
    docker compose -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" dropdb -U "$PGUSER" --if-exists "$DB_NAME"
  fi
}

run_createdb() {
  if command -v createdb >/dev/null 2>&1; then
    createdb -h "$PGHOST" -U "$PGUSER" "$DB_NAME"
  else
    docker compose -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" createdb -U "$PGUSER" "$DB_NAME"
  fi
}

echo "Terminating connections to ${DB_NAME}…"
run_psql -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
  >/dev/null || true

echo "Dropping ${DB_NAME}…"
run_dropdb

echo "Creating ${DB_NAME}…"
run_createdb

echo "Reset complete: ${DB_NAME}"
