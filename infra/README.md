# Infra — dev and CI (not production)

Docker Compose stack for **local development and CI tests**. Production deployment lives in [`../deploy/`](../deploy/README.md) — different creds, network layout, and reverse proxy.

## What runs here

| Service | Image | Host bind | Purpose |
|---------|-------|-----------|---------|
| `db` | `postgres:16-alpine` | `127.0.0.1:5432` | Primary database (dev creds `admitto`/`admitto`) |
| `redis` | `redis:7-alpine` | `127.0.0.1:6379` | Optional shared rate-limit / session store (`REDIS_URL`) |

Both services use **loopback-only** ports — not reachable from the LAN.

## Quick start

From the monorepo root:

```bash
docker compose -f infra/docker-compose.yml up -d db redis
cp packages/db/.env.example packages/db/.env   # matches compose defaults
npm run db:migrate
npm run db:seed
npm run db:test-setup   # creates admitto_*_test databases for package tests
```

## Test databases

`infra/scripts/create-test-dbs.sh` is invoked by `npm run db:test-setup`. It creates isolated Postgres databases for Vitest (e.g. `admitto_web_test`, `admitto_import_test`). Idempotent — safe to re-run.

## vs `deploy/`

| | `infra/` (this) | `deploy/` |
|---|-----------------|-----------|
| Audience | Developers, GitHub Actions | Production / staging host |
| Postgres creds | Fixed dev defaults | From `deploy/.env` |
| App container | No — run `npm run dev -w @admitto/web` | Yes — built from root `Dockerfile` |
| Public port | DB/Redis on localhost only | nginx on `127.0.0.1:8080` |

Do not point production traffic at this compose file.
