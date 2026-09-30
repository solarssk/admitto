# @admitto/web

HTTP server for Admitto - Hono on Node. Wires domain packages (`@admitto/auth`, `@admitto/tickets`, `@admitto/mail-delivery`, …) into routes, cookies, rate limits, and server-rendered HTML.

Production runs from the Docker image built at the monorepo root (`Dockerfile` → `deploy/`). Local dev uses this package directly.

## Prerequisites

- Postgres (+ optional Redis) via [`infra/docker-compose.yml`](../../infra/docker-compose.yml)
- `apps/web/.env` (copy from [`.env.example`](.env.example)) with `DATABASE_URL`, `ENCRYPTION_KEY`, `BASE_URL` and the mail provider vars. `npm run dev` passes `--env-file=.env`, so it requires this file (Node exits with "not found" without it) and reads no other; `packages/db/.env` only serves the db scripts (`db:migrate`, `db:seed`)

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

`npm run start` loads no `.env` file at all, so export the variables first (or use the Docker image).

## Route map (high level)

| Prefix | Auth | Purpose |
|--------|------|---------|
| `/healthz` | none | Liveness + DB ping (rate-limited; Docker healthcheck) |
| `/readyz` | `OPS_HEALTH_TOKEN` (Bearer or `X-Ops-Token`; at least 32 characters) | Detailed readiness + gauges (rate-limited; disabled when the token is unset or shorter) |
| `/t/*`, `/q/*` | none | Attendee ticket page + hosted QR PNG (rate-limited); agency (Mode B) tickets use `/t/:eventSlug/a/:ref` and `/q/:eventSlug/a/:ref.png`, addressed by `public_ref` |
| `/m/:filename`, `/uploads/*` | none | Bundled mail assets (rate-limited) and uploaded branding files |
| `/setup`, `/change-password` | none until the first superadmin exists / session (forced change) | First-run setup, server-rendered forced password change |
| `/login`, `/mfa/*`, `/logout` | session / partial | Staff local login + MFA (TOTP, passkeys, backup codes) |
| `/api/auth/*` | varies | JSON auth API |
| `/api/auth/oidc/*` | public start/callback | OIDC login |
| `/operator`, `/operator/*` | operator session + check-in access | Operator check-in SPA (scanner, lookup, admit) |
| `/api/checkin/*` | operator | Scan validation + history |
| `/admin`, `/admin/*`, `/api/admin/*` | admin session (or verified Cloudflare Access JWT) | Staff admin SPA and its JSON API (events, attendees, mail, wallet, reports, users; superadmin-only Settings including Identity & SSO) |
| `/account`, `/api/account/*` | session | Own profile, password, sessions, MFA, notifications |
| `/api/wallet/webhook/passcreator/:eventId` (+ `/voided`, `/first-confirmed`) | signature verified against the provider's public key | PassCreator callbacks (rate-limited) |
| `/api/ops/system-logs` | `OPS_HEALTH_TOKEN` | System log ingest from the worker |

Path classification for Cloudflare Access: [`deploy/README.md`](../../deploy/README.md#cloudflare-and-wireguard).

Staff entry smoke matrix (manual QA): [`deploy/staff-entry-smoke-matrix.md`](../../deploy/staff-entry-smoke-matrix.md).

**Rate limits and abuse controls** (full matrix for auditors): [`docs/security/SECURITY-CONTROLS.md`](../../docs/security/SECURITY-CONTROLS.md#rate-limiting).

## Tests

See [`test/README.md`](test/README.md) and ADR 0015 (`test/ADR-0015-test-strategy.md`).

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/web
bash scripts/test-web-like-ci.sh   # before push when touching tests
```
