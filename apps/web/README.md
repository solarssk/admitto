# @admitto/web

HTTP server for Admitto - Hono on Node. Wires domain packages (`@admitto/auth`, `@admitto/tickets`, `@admitto/mail-delivery`, …) into routes, cookies, rate limits, and server-rendered HTML.

Production runs from the Docker image built at the monorepo root (`Dockerfile` → `deploy/`). Local dev uses this package directly.

## Prerequisites

- Postgres (+ optional Redis) via [`infra/docker-compose.yml`](../../infra/docker-compose.yml)
- `apps/web/.env` (copy from [`.env.example`](.env.example)) with `DATABASE_URL`, `ENCRYPTION_KEY`, `BASE_URL` and the mail provider vars.
  - `npm run dev` passes `--env-file=.env`, so it requires this file (Node exits with "not found" without it) and reads no other.
  - `packages/db/.env` only serves the db scripts (`db:migrate`, `db:seed`).

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
| `/r/:eventSlug` | none | Guest registration form of an event: server-rendered, one script under a per-response nonce, Cloudflare Turnstile, no cookie, rate-limited (`registration:page`). Silent until an event turns registration on: an unknown event, registration off, an archived event, a way in other than the public link, or an event that is not ready all answer the same 404. Once the event is over it says registration is closed. The slug is in the address, so it is not a secret. The page's own script sends the form as JSON (contract in `src/registration/form-contract.ts`); that request is not an API for other clients |
| `POST /r/:eventSlug` | none (Cloudflare Turnstile token in the body, cross-site check) | The registration form, sent. Limits per IP and per event (`registration:submit`, `registration:event`), a 64 KB body, `application/json` only. It judges the fields (422 with a fixed sentence per field), stores the registration and queues its mail in one transaction, and answers `200 {"ok":true}` whether the address is new or known. A form that is not open answers the same 404 as the page; `409 full`, `429`, `503 try_again` (a lock is held) and the page's other answers are in `src/registration/submit-route.ts` |
| `/legal/:eventSlug/:text` | none | Published legal text of an event (privacy notice, terms, extra consent), static and rate-limited. A draft, an unknown event and an unknown text all answer the same 404 |
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

## Guest page stylesheet

The guest pages (the registration form) are rendered on the server and have no bundler, so they carry a copy of the product's tokens and of the component rules they use: `src/registration/guest-page-css.generated.ts`, built from `packages/ui/src/styles`. After a change there, run `npm run guest-css -w @admitto/web` and commit the result. `test/registration/guest-page-css.test.ts` fails until you do. When a page starts to use another `at-` class, add it to `GUEST_PAGE_COMPONENT_CLASSES` in `src/scripts/guest-page-css.ts` first.

## Tests

See [`test/README.md`](test/README.md) and ADR 0015 (`test/ADR-0015-test-strategy.md`).

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/web
bash scripts/test-web-like-ci.sh   # before push when touching tests
```
