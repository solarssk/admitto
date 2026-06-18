#!/usr/bin/env bash
# CI-parity web test run (ADR 0015). Use before pushing changes under apps/web/test/**.
# Prerequisites: npm ci (or npm install) already run in the repo root.
# Uses local-only Postgres defaults (admitto/admitto@localhost) — not for production.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${WEB_TEST_DATABASE_URL:-postgresql://admitto:admitto@localhost:5432/admitto_web_test}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=}"

bash infra/scripts/create-test-dbs.sh
bash infra/scripts/apply-test-schema.sh admitto_web_test
npm run build
npm test -w @admitto/web
