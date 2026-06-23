# @admitto/web

HTTP server for Admitto — Hono on Node. Wires domain packages (`@admitto/auth`, `@admitto/tickets`, `@admitto/mail-delivery`, …) into routes, cookies, rate limits, and server-rendered HTML.

Production runs from the Docker image built at the monorepo root (`Dockerfile` → `deploy/`). Local dev uses this package directly.

## Prerequisites

- Postgres (+ optional Redis) via [`infra/docker-compose.yml`](../../infra/docker-compose.yml)
- `packages/db/.env` with `DATABASE_URL`
- Root or `apps/web/.env` for `BASE_URL`, `ENCRYPTION_KEY`, mail provider vars — see [`apps/web/.env.example`](.env.example)

## Dev

```bash
# from repo root, after db:migrate + db:seed
npm run dev -w @admitto/web
# default http://localhost:3000
```

## Build and run (without Docker)

```bash
npm run build -w @admitto/web
npm run start -w @admitto/web
```

## Route map (high level)

| Prefix | Auth | Purpose |
|--------|------|---------|
| `/healthz` | none | Liveness + DB ping (rate-limited; Docker healthcheck) |
| `/readyz` | `OPS_HEALTH_TOKEN` (Bearer or `X-Ops-Token`) | Detailed readiness + gauges (rate-limited; disabled when token unset) |
| `/t/*`, `/q/*` | none | Attendee ticket page + hosted QR PNG (rate-limited) |
| `/login`, `/mfa/*`, `/logout` | session / partial | Staff local login + TOTP |
| `/api/auth/*` | varies | JSON auth API |
| `/api/auth/oidc/*` | public start/callback | OIDC login |
| `/operator` | operator session | Temporary post-login landing (pre–v0.4 UI) |
| `/api/checkin/*` | operator | Scan validation + history |
| `/admin/*` | admin (+ optional CF Access JWT) | Superadmin config (IdP, CF Access) |

Path classification for Cloudflare Access: [`_ops/design/deployment-cloudflare-access.md`](../../_ops/design/deployment-cloudflare-access.md).

Staff entry smoke matrix (manual QA): [`deploy/staff-entry-smoke-matrix.md`](../../deploy/staff-entry-smoke-matrix.md).

**Rate limits and abuse controls** (full matrix for auditors): [`docs/SECURITY-CONTROLS.md`](../../docs/SECURITY-CONTROLS.md#rate-limiting).

## Tests

See [`test/README.md`](test/README.md) and ADR 0015 (`test/ADR-0015-test-strategy.md`).

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/web
bash scripts/test-web-like-ci.sh   # before push when touching tests
```
