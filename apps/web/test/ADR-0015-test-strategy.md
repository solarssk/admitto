# ADR 0015 — Test strategy (stop the per-file thrash)

Status: Accepted · Date: 2026-06-14

Canonical copy also in monorepo-external `_ops/adr/0015-test-strategy.md`.

## Context

After merging #35, CI for `@admitto/web` kept breaking (#36 hotfixes): shared `admitto_web_test` DB,
`prisma db push --force-reset` per test file (segfault on Linux, no migration history → P3005), CI
migrating only `admitto` not `admitto_web_test`, mixed seeding strategies, and review bots suggesting
per-file "improvements" that conflict across files.

## Decision

1. **Two Vitest projects:** `unit` (no Postgres) and `integration` (one `globalSetup` + `migrate deploy`).
2. **Ban `db push --force-reset`** in test files; fixture cleanup only.
3. **`scripts/test-web-like-ci.sh`** for local CI parity.
4. **Contract:** `apps/web/test/README.md` + this ADR.
5. **Review bots:** suggestions contradicting ADR 0015 → decline, do not implement.

## Deferred

Testcontainers / per-test transaction rollback — revisit when integration volume grows.
