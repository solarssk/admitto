#!/usr/bin/env bash
# Scan new Prisma migration SQL (diff vs main) for destructive operations (ADR 0027 §3).
# Override: -- destructive-approved: <reason> in migration.sql AND label migration-destructive-approved on PR
#           (CI sets MIGRATION_DESTRUCTIVE_LABEL_APPROVED=1).
set -euo pipefail

ROOT="${MIGRATION_SCAN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

BASE_REF="${MIGRATION_DIFF_BASE:-origin/main}"
# Only newly added migration folders (--diff-filter=A). Editing existing migration.sql after merge
# is against Prisma conventions and is intentionally not scanned; add a new migration folder instead.
MIGRATIONS_GLOB='packages/db/prisma/migrations/*/migration.sql'

list_new_migration_files() {
  if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
    echo "warning: base ref $BASE_REF not found — skipping destructive migration scan" >&2
    return 0
  fi
  git diff --diff-filter=A --name-only "${BASE_REF}...HEAD" -- $MIGRATIONS_GLOB || true
}

has_destructive_override() {
  local file="$1"
  grep -qiE '^[[:space:]]*--[[:space:]]*destructive-approved:' "$file"
}

scan_file() {
  local file="$1"
  local line content upper
  local -a hits=()

  while IFS= read -r line || [ -n "$line" ]; do
  content="$(printf '%s' "$line" | tr '[:lower:]' '[:upper:]')"

  if printf '%s' "$content" | grep -qE 'DROP[[:space:]]+TABLE'; then
    hits+=("DROP TABLE")
  fi
  if printf '%s' "$content" | grep -qE 'DROP[[:space:]]+COLUMN'; then
    hits+=("DROP COLUMN")
  fi
  if printf '%s' "$content" | grep -qE '(^|[^A-Z])TRUNCATE[[:space:]]'; then
    hits+=("TRUNCATE")
  fi
  if printf '%s' "$content" | grep -qE 'ALTER[[:space:]]+COLUMN[[:space:]]+[^;]+[[:space:]]+TYPE'; then
    hits+=("ALTER COLUMN TYPE")
  fi
  if printf '%s' "$content" | grep -qE 'ALTER[[:space:]]+COLUMN[[:space:]]+[^;]+[[:space:]]+SET[[:space:]]+NOT[[:space:]]+NULL'; then
    hits+=("SET NOT NULL")
  fi
  if printf '%s' "$content" | grep -qE 'DROP[[:space:]]+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE|SCHEMA|DATABASE|VIEW|SEQUENCE|FUNCTION|TRIGGER|RULE|DOMAIN)'; then
    if ! printf '%s' "$content" | grep -q 'IF[[:space:]]+EXISTS'; then
      hits+=("DROP without IF EXISTS")
    fi
  fi

  done < "$file"

  if [ "${#hits[@]}" -eq 0 ]; then
    return 0
  fi

  if has_destructive_override "$file" && [ "${MIGRATION_DESTRUCTIVE_LABEL_APPROVED:-}" = "1" ]; then
    echo "note: destructive operations in $file allowed via destructive-approved marker + PR label" >&2
    return 0
  fi

  if has_destructive_override "$file" && [ "${MIGRATION_DESTRUCTIVE_LABEL_APPROVED:-}" != "1" ]; then
    echo "error: $file has -- destructive-approved marker but PR label migration-destructive-approved is missing" >&2
  fi

  printf 'error: destructive migration SQL in %s\n' "$file" >&2
  local h
  for h in "${hits[@]}"; do
    printf '  - %s\n' "$h" >&2
  done
  if ! has_destructive_override "$file"; then
    echo "  hint: follow expand-contract policy; if intentional add -- destructive-approved: <reason> and PR label migration-destructive-approved" >&2
  fi
  return 1
}

main() {
  local failed=0
  local file count=0

  while IFS= read -r file; do
    [ -z "$file" ] && continue
    count=$((count + 1))
    if ! scan_file "$file"; then
      failed=1
    fi
  done < <(list_new_migration_files)

  if [ "$count" -eq 0 ]; then
    echo "migration-safety: no new migration files vs $BASE_REF"
    exit 0
  fi

  if [ "$failed" -ne 0 ]; then
    echo "migration-safety: FAILED — destructive migration(s) blocked (ADR 0027)" >&2
    exit 1
  fi

  echo "migration-safety: OK ($count new migration file(s) checked)"
}

main "$@"
