#!/usr/bin/env bash
# Apply Prisma migrations to a local *_test database.
# On P3005 (schema without migration history), resets the DB and retries migrate deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DB_NAME="${1:?usage: apply-test-schema.sh <database_name>}"
PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-admitto}"

if [[ ! "$DB_NAME" =~ _test$ ]]; then
  echo "Refusing: only *_test databases are allowed" >&2
  exit 1
fi

export DATABASE_URL="${DATABASE_URL:-postgresql://${PGUSER}:admitto@${PGHOST}:5432/${DB_NAME}}"

run_migrate_deploy() {
  npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
}

migrate_output=""
migrate_status=0
migrate_output="$(run_migrate_deploy 2>&1)" || migrate_status=$?

if [[ "$migrate_status" -eq 0 ]]; then
  echo "$migrate_output"
  echo "migrate deploy OK (${DB_NAME})"
  exit 0
fi

echo "$migrate_output" >&2

if echo "$migrate_output" | grep -q "P3005"; then
  echo "P3005: ${DB_NAME} has tables without migration history — resetting and retrying…" >&2
  bash infra/scripts/reset-test-db.sh "$DB_NAME"
  run_migrate_deploy
  echo "migrate deploy OK after reset (${DB_NAME})"
  exit 0
fi

if [[ -n "${CI:-}" ]]; then
  echo "migrate deploy failed in CI (non-P3005); not resetting test DB" >&2
  exit "$migrate_status"
fi

echo "migrate deploy failed locally — falling back to db push (ADR 0015 integration parity)…" >&2
npx prisma db push --schema packages/db/prisma/schema.prisma --skip-generate --accept-data-loss
echo "db push OK (${DB_NAME})"
