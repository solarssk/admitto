#!/usr/bin/env bash
set -euo pipefail

# Used both before version tags are published (an immutable candidate digest) and after
# publication (the release tag). Compose must never rebuild from the source checkout.
: "${ADMITTO_IMAGE:?Set ADMITTO_IMAGE to the image being tested}"
case "$ADMITTO_IMAGE" in
  ghcr.io/solarssk/admitto@sha256:*|ghcr.io/solarssk/admitto:[0-9]*) ;;
  *) echo "Unexpected Admitto image reference: $ADMITTO_IMAGE" >&2; exit 1 ;;
esac

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root/deploy"
if [ -e .env ]; then
  echo 'Refusing to replace an existing deploy/.env' >&2
  exit 1
fi

cleanup() {
  docker compose down -v || true
  rm -f .env .env.bak
  if [ -n "${login_body:-}" ]; then
    rm -f "$login_body"
  fi
}
trap cleanup EXIT

cp .env.example .env
sed -i.bak 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=smoke-test-secret/' .env
sed -i.bak 's|^DATABASE_URL=.*|DATABASE_URL=postgresql://admitto_app:smoke-test-secret@db:5432/admitto|' .env
encryption_key="$(openssl rand -base64 32)"
node -e "if (Buffer.from(process.argv[1], 'base64').length !== 32) { process.exit(1); }" "$encryption_key"
sed -i.bak "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${encryption_key}|" .env
sed -i.bak 's|^BASE_URL=.*|BASE_URL=http://127.0.0.1:8080|' .env
sed -i.bak 's/^REDIS_PASSWORD=.*/REDIS_PASSWORD=smoke-redis-secret/' .env
sed -i.bak 's|^REDIS_URL=.*|REDIS_URL=redis://:smoke-redis-secret@redis:6379|' .env
rm -f .env.bak
node validate-env.mjs .env

# Compose otherwise creates bind-mount directories as root; the app runs as UID 1000.
sudo ./scripts/init-host-dirs.sh

docker pull "$ADMITTO_IMAGE"
docker compose up -d --no-build --pull missing

for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8080/healthz >/dev/null; then
    healthy=1
    break
  fi
  sleep 5
done
if [ "${healthy:-0}" != 1 ]; then
  echo 'healthz never became ready' >&2
  docker compose logs
  exit 1
fi

curl -sSf http://127.0.0.1:8080/healthz | grep -q '"status":"ok"'
# A fresh stack has no users; bootstrap a synthetic account before testing login.
smoke_password="Smoke-Test-2026-$(openssl rand -hex 12)!"
printf '%s\n' "$smoke_password" | docker compose exec -T app \
  node packages/auth/dist/cli.js bootstrap-superadmin --email smoke-admin@example.com
curl -sSf http://127.0.0.1:8080/login -o /dev/null -w '%{http_code}\n' | grep -q 200
login_body="$(mktemp)"
login_code="$(curl -s -o "$login_body" -w '%{http_code}' -X POST http://127.0.0.1:8080/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Origin: http://127.0.0.1:8080' \
  -d 'email=smoke@example.com&password=wrong')"
if [ "$login_code" = 403 ]; then
  echo 'POST /login blocked by CSRF (403) — check proxy X-Forwarded-Host' >&2
  cat "$login_body"
  exit 1
fi
if [ "$login_code" != 401 ]; then
  echo "POST /login expected 401 invalid credentials, got $login_code" >&2
  cat "$login_body"
  exit 1
fi
grep -q 'Invalid email or password' "$login_body"
if curl --connect-timeout 2 -sf http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
  echo 'app port 3000 must not be published on host' >&2
  exit 1
fi

docker compose run --rm app node --input-type=module -e "import('@admitto/import').then(() => console.log('ok'))"
