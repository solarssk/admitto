#!/usr/bin/env bash
# Creates Postgres databases used by package test suites (idempotent).
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-admitto}"
PGPASSWORD="${PGPASSWORD:-admitto}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.yml}"
DB_SERVICE="${DB_SERVICE:-db}"

export PGPASSWORD

run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql -h "$PGHOST" -U "$PGUSER" "$@"
  else
    docker compose -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" \
      psql -U "$PGUSER" "$@"
  fi
}

run_createdb() {
  local db_name=$1
  if command -v createdb >/dev/null 2>&1; then
    createdb -h "$PGHOST" -U "$PGUSER" "$db_name"
  else
    docker compose -f "$COMPOSE_FILE" exec -T "$DB_SERVICE" \
      createdb -U "$PGUSER" "$db_name"
  fi
}

create_db_if_missing() {
  local db_name=$1
  if run_psql -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${db_name}'" | grep -q 1; then
    echo "Database ${db_name} already exists"
  else
    run_createdb "$db_name"
    echo "Created database ${db_name}"
  fi
}

create_db_if_missing admitto_tickets_test
create_db_if_missing admitto_import_test
create_db_if_missing admitto_mailer_config_test
create_db_if_missing admitto_mail_templates_test
create_db_if_missing admitto_mail_delivery_test
create_db_if_missing admitto_auth_test
create_db_if_missing admitto_web_test
