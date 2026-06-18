#!/usr/bin/env bash
# Unit tests for scripts/check-migrations-destructive.sh (ADR 0027).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK="$ROOT/scripts/check-migrations-destructive.sh"
FIXTURES="$ROOT/scripts/fixtures/migrations"

chmod +x "$CHECK"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

setup_fake_repo() {
  local migration_path="$1"
  local repo="$tmpdir/$(basename "$(dirname "$migration_path")")"
  rm -rf "$repo"
  mkdir -p "$repo/packages/db/prisma/migrations/20260101000000_base"
  echo "-- base" > "$repo/packages/db/prisma/migrations/20260101000000_base/migration.sql"
  git -C "$repo" init -q
  git -C "$repo" config user.email "test@example.com"
  git -C "$repo" config user.name "test"
  git -C "$repo" add .
  git -C "$repo" commit -q -m "base"
  git -C "$repo" branch -M main
  git -C "$repo" checkout -q -b feature
  mkdir -p "$repo/packages/db/prisma/migrations/20260102000000_new"
  cp "$migration_path" "$repo/packages/db/prisma/migrations/20260102000000_new/migration.sql"
  git -C "$repo" add .
  git -C "$repo" commit -q -m "new migration"
  printf '%s' "$repo"
}

run_scan() {
  local repo="$1"
  local label_approved="${2:-0}"
  MIGRATION_SCAN_ROOT="$repo" \
  MIGRATION_DIFF_BASE=main \
  MIGRATION_DESTRUCTIVE_LABEL_APPROVED="$label_approved" \
  bash "$CHECK"
}

assert_ok() {
  local migration_path="$1"
  local label="${2:-0}"
  local repo
  repo="$(setup_fake_repo "$migration_path")"
  if ! run_scan "$repo" "$label"; then
    echo "expected pass for $(basename "$(dirname "$migration_path")")" >&2
    exit 1
  fi
  echo "ok: pass $(basename "$(dirname "$migration_path")")"
}

assert_fail() {
  local migration_path="$1"
  local label="${2:-0}"
  local repo
  repo="$(setup_fake_repo "$migration_path")"
  if run_scan "$repo" "$label" 2>/dev/null; then
    echo "expected fail for $(basename "$(dirname "$migration_path")")" >&2
    exit 1
  fi
  echo "ok: fail $(basename "$(dirname "$migration_path")")"
}

assert_ok "$FIXTURES/additive/migration.sql"
assert_fail "$FIXTURES/drop-column/migration.sql"
assert_fail "$FIXTURES/set-not-null/migration.sql"
assert_fail "$FIXTURES/approved-marker/migration.sql" 0
assert_ok "$FIXTURES/approved-marker/migration.sql" 1

echo "check-migrations-destructive.test.sh: all passed"
