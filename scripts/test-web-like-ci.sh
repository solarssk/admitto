#!/usr/bin/env bash
# CI-parity web test run (ADR 0015). Use before pushing changes under apps/web/test/**.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${WEB_TEST_DATABASE_URL:-postgresql://admitto:admitto@localhost:5432/admitto_web_test}"

bash infra/scripts/create-test-dbs.sh
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
npm test -w @admitto/web
