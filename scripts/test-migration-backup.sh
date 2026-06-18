#!/usr/bin/env bash
# Integration smoke: pre-migration backup in docker entrypoint (ADR 0027).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/deploy"
COMPOSE="docker compose -f docker-compose.yml"

cd "$DEPLOY"

prepare_env() {
  cp .env.example .env
  if sed --version >/dev/null 2>&1; then
    sed -i 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=smoke-test-secret/' .env
    sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgresql://admitto_app:smoke-test-secret@db:5432/admitto|' .env
    ENCRYPTION_KEY="$(openssl rand -base64 32)"
    node -e "if (Buffer.from(process.argv[1], 'base64').length !== 32) process.exit(1)" "$ENCRYPTION_KEY"
    sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" .env
    sed -i 's|^BASE_URL=.*|BASE_URL=http://127.0.0.1:8080|' .env
  else
    sed -i.bak 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=smoke-test-secret/' .env
    sed -i.bak 's|^DATABASE_URL=.*|DATABASE_URL=postgresql://admitto_app:smoke-test-secret@db:5432/admitto|' .env
    ENCRYPTION_KEY="$(openssl rand -base64 32)"
    node -e "if (Buffer.from(process.argv[1], 'base64').length !== 32) process.exit(1)" "$ENCRYPTION_KEY"
    sed -i.bak "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" .env
    sed -i.bak 's|^BASE_URL=.*|BASE_URL=http://127.0.0.1:8080|' .env
    rm -f .env.bak
  fi
}

on_fail() {
  echo "--- docker compose logs app ---" >&2
  $COMPOSE logs app >&2 || true
}

cleanup() {
  $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

prepare_env

echo "== Scenario A: pending migrations → pre-migration backup file =="
if ! $COMPOSE up -d --build --wait; then
  on_fail
  exit 1
fi

backup_count="$($COMPOSE exec -T app sh -c 'ls -1 /backups/pre-migration-*.sql.gz 2>/dev/null | wc -l' | tr -d ' ')"
if [ "${backup_count:-0}" -lt 1 ]; then
  echo "expected at least one pre-migration backup on first start" >&2
  $COMPOSE logs app
  exit 1
fi

$COMPOSE exec -T app sh -c 'gzip -t /backups/pre-migration-*.sql.gz'
echo "Scenario A OK (backups=$backup_count)"

echo "== Scenario B: restart with no pending migrations → no new backup =="
before="$backup_count"
$COMPOSE restart app
sleep 15
$COMPOSE ps app | grep -q healthy || $COMPOSE ps app | grep -q running
after="$($COMPOSE exec -T app sh -c 'ls -1 /backups/pre-migration-*.sql.gz 2>/dev/null | wc -l' | tr -d ' ')"
if [ "$after" != "$before" ]; then
  echo "expected backup count unchanged after restart (before=$before after=$after)" >&2
  exit 1
fi
echo "Scenario B OK"

echo "== Scenario C: pg_dump failure → no migrations applied =="
cleanup
trap - EXIT
prepare_env

$COMPOSE up -d db redis --wait

# Fresh DB: run app once with fake pg_dump on PATH (pending migrations, backup required).
if $COMPOSE run --rm \
  -e PATH="/opt/fake-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  -v "$ROOT/scripts/fixtures/fake-pg-dump:/opt/fake-bin:ro" \
  --no-deps app; then
  echo "expected app container to fail when pg_dump fails" >&2
  exit 1
fi

applied="$($COMPOSE exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null || echo 0' | tr -d ' ')"
if [ -z "$applied" ]; then applied=0; fi
if [ "${applied:-0}" != "0" ]; then
  echo "expected zero applied migrations after pg_dump failure (got $applied)" >&2
  exit 1
fi
echo "Scenario C OK"

cleanup
echo "test-migration-backup.sh: all passed"
