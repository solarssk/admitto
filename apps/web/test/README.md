# @admitto/web tests (ADR 0015)

Two Vitest projects — see `ADR-0015-test-strategy.md` in this directory.

| Project | Command | Postgres |
|---------|---------|----------|
| **unit** | `npm run test:unit -w @admitto/web` | No |
| **integration** | `npm run test:integration -w @admitto/web` | Yes (`admitto_web_test`) |
| **both** | `npm test -w @admitto/web` | integration only |

## Rules

1. **New DB-backed tests** → `test/integration/`. Schema is applied once per run via `integrationGlobalSetup` (`prisma migrate deploy`).
2. **Fixture cleanup** — each file deletes only its own rows in `beforeAll`; never `prisma db push --force-reset`.
3. **Unit tests** — `test/**/*.test.ts` outside `integration/`; must pass without a running Postgres.
4. **Before push** (when touching `apps/web/test/**`): `bash scripts/test-web-like-ci.sh`
5. **Review bots** — suggestions that contradict ADR 0015 are declined, not implemented.
