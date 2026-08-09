#!/usr/bin/env bash
# Integration smoke: the migrate compose service applies schema + backfills, runs non-root, and
# unblocks `app` (deploy/docker-entrypoint.sh). Backup is the operator's responsibility (ADR 0043)
# and is not exercised here — see scripts/test-migration-backup.sh in history for the old coverage.
# Uses an isolated Compose project name and .env.smoke so it does not tear down
# or overwrite a developer's normal deploy/ stack (postgres_data, migration_backups, .env).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/deploy"
SMOKE_PROJECT="admitto-migration-smoke"
SMOKE_ENV="$DEPLOY/.env.smoke"
COMPOSE="docker compose -p ${SMOKE_PROJECT} -f docker-compose.yml -f docker-compose.smoke.yml --env-file .env.smoke"

cd "$DEPLOY"

prepare_env() {
  cp .env.example "$SMOKE_ENV"
  if sed --version >/dev/null 2>&1; then
    sed -i 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=smoke-test-secret/' "$SMOKE_ENV"
    sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgresql://admitto_app:smoke-test-secret@db:5432/admitto|' "$SMOKE_ENV"
    ENCRYPTION_KEY="$(openssl rand -base64 32)"
    node -e "if (Buffer.from(process.argv[1], 'base64').length !== 32) process.exit(1)" "$ENCRYPTION_KEY"
    sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" "$SMOKE_ENV"
    sed -i 's|^BASE_URL=.*|BASE_URL=http://127.0.0.1:8080|' "$SMOKE_ENV"
    sed -i 's/^REDIS_PASSWORD=.*/REDIS_PASSWORD=smoke-redis-secret/' "$SMOKE_ENV"
    sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://:smoke-redis-secret@redis:6379|' "$SMOKE_ENV"
  else
    sed -i.bak 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=smoke-test-secret/' "$SMOKE_ENV"
    sed -i.bak 's|^DATABASE_URL=.*|DATABASE_URL=postgresql://admitto_app:smoke-test-secret@db:5432/admitto|' "$SMOKE_ENV"
    ENCRYPTION_KEY="$(openssl rand -base64 32)"
    node -e "if (Buffer.from(process.argv[1], 'base64').length !== 32) process.exit(1)" "$ENCRYPTION_KEY"
    sed -i.bak "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" "$SMOKE_ENV"
    sed -i.bak 's|^BASE_URL=.*|BASE_URL=http://127.0.0.1:8080|' "$SMOKE_ENV"
    sed -i.bak 's/^REDIS_PASSWORD=.*/REDIS_PASSWORD=smoke-redis-secret/' "$SMOKE_ENV"
    sed -i.bak 's|^REDIS_URL=.*|REDIS_URL=redis://:smoke-redis-secret@redis:6379|' "$SMOKE_ENV"
    rm -f "${SMOKE_ENV}.bak"
  fi
  node validate-env.mjs "$SMOKE_ENV"
}

on_fail() {
  echo "--- docker compose logs migrate app ---" >&2
  $COMPOSE logs migrate app >&2 || true
}

cleanup() {
  $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$SMOKE_ENV"
}

trap cleanup EXIT

prepare_env

echo "== Scenario A: fresh stack -> migrate runs non-root and app becomes healthy =="
if ! $COMPOSE up -d --build --wait; then
  on_fail
  exit 1
fi

migrate_uid="$($COMPOSE run --rm --no-deps --entrypoint sh migrate -c 'id -u')"
if [[ "$migrate_uid" == "0" ]]; then
  echo "expected migrate to run as a non-root uid (got 0)" >&2
  on_fail
  exit 1
fi
echo "Scenario A OK (migrate uid=$migrate_uid)"

echo "== Scenario B: bare app restart never re-runs migrate; retention stays off app boot =="
# A bare restart never re-runs migrate (depends_on: condition: service_completed_successfully is
# only evaluated on `docker compose up`). Retention no longer runs on app boot (ADR 0042 — the
# worker owns product retention). Assert the HTTP process comes back without the old retention
# startup line, and that the web listen log appears.
$COMPOSE restart app
# Poll instead of a fixed sleep: restart-to-ready timing varies with CI load.
app_ready=0
for _ in $(seq 1 30); do
  if $COMPOSE logs app --since 30s 2>&1 | grep -q "Admitto web running"; then
    app_ready=1
    break
  fi
  sleep 1
done
if [[ "$app_ready" -ne 1 ]]; then
  echo "expected app listen log after a bare app restart" >&2
  $COMPOSE logs app --since 30s
  exit 1
fi
if $COMPOSE logs app --since 30s 2>&1 | grep -q "purging expired/revoked auth sessions"; then
  echo "app boot must not run retention anymore (moved to worker)" >&2
  $COMPOSE logs app --since 30s
  exit 1
fi
echo "Scenario B OK"

echo "== Scenario C: backfill timeout -> migrate exits nonzero =="
cleanup
trap - EXIT
prepare_env

$COMPOSE up -d db redis --wait

if $COMPOSE run --rm \
  -e PATH="/opt/fake-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  -v "$ROOT/scripts/fixtures/fake-timeout:/opt/fake-bin:ro" \
  --no-deps migrate; then
  echo "expected migrate container to fail when backfill times out" >&2
  exit 1
fi

echo "Scenario C OK"

cleanup
echo "test-migrate-entrypoint.sh: all passed"
