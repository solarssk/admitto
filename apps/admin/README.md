# @admitto/admin

Staff **React SPA** - events picker, event admin sections, operator check-in UI, and instance Settings (including Identity & SSO). Served by `@admitto/web` at `/admin/*` (and related API routes).

Login, first-run setup, and MFA enrollment remain **server-rendered HTML** from `apps/web`. Settings → Identity uses the SPA: OIDC provider list, OIDC provider editor, and Cloudflare Access editor all live under `/admin/settings/identity/*` (`/providers`, `/providers/new`, `/providers/:id`, `/cloudflare`).

## Prerequisites

Same as the monorepo dev stack - see [README.md](../../README.md#quick-start) and [infra/README.md](../../infra/README.md):

- Postgres (and optional Redis) via `infra/docker-compose.yml`
- `packages/db/.env` with `DATABASE_URL`
- A bootstrapped superadmin (`npm run auth:bootstrap`)
- `@admitto/web` running on port `3000`

## Dev - SPA hot reload (recommended for UI work)

Two terminals from the repo root:

```bash
npm run dev -w @admitto/web    # http://localhost:3000 - API, login/setup/MFA SSR
npm run dev -w @admitto/admin  # http://localhost:5173 - Vite dev server
```

Vite proxies `/api`, `/login`, `/logout`, and `/mfa` to `:3000` (MFA enrollment stays server-rendered during first login). Open **http://localhost:5173**, sign in, and work on React pages with HMR.

## Dev - single server (production-like)

Build the SPA once; `@admitto/web` serves static assets from `apps/admin/dist`:

```bash
npm run build -w @admitto/admin
npm run dev -w @admitto/web
# http://localhost:3000/login → /admin after auth
```

If `/admin` returns `503 Staff UI not built`, run the admin build step above.

## Tests

```bash
npm run db:test-setup   # from repo root, first time
npm test -w @admitto/admin
```

## E2E (Playwright)

First browser-level test in this repo (`apps/admin/e2e/checkin.spec.ts`): an operator logs in,
looks up a seeded attendee by name, and admits them through the manual check-in path (not the
camera/QR scanner). Not part of `npm test` and not run on every PR - see
`.github/workflows/e2e-checkin-smoke.yml` (`workflow_dispatch` + a daily schedule only, while it
proves itself stable).

Runs against a real dev server in the "single server (production-like)" mode above, plus its own
disposable Postgres database - **do not point it at your shared local `admitto` dev database**,
`apps/admin/e2e/seed.ts` resets its fixture attendee's admitted status on every run. It also
upserts a synthetic operator account with a fixed password into `DATABASE_URL`, which is why it
requires `E2E_SEED_ALLOW_WRITE=true` as a deliberate, separate opt-in - set it only once you have
double-checked `DATABASE_URL` is the disposable `admitto_e2e` database below, not a shared one.

```bash
# One-time: a dedicated database, separate from your normal dev DB
createdb -h localhost -U admitto admitto_e2e
DATABASE_URL=postgresql://admitto:admitto@localhost:5432/admitto_e2e npm run db:migrate -w @admitto/db

# Every run
npm run build -w @admitto/admin
npx playwright install chromium   # first time only

DATABASE_URL=postgresql://admitto:admitto@localhost:5432/admitto_e2e \
ENCRYPTION_KEY=$(openssl rand -base64 32) \
REDIS_URL=redis://localhost:6379 \
E2E_SEED_ALLOW_WRITE=true \
npm run e2e -w @admitto/admin
```

`playwright.config.ts`'s `webServer` starts `@admitto/web` itself (port `3100` by default, override
with `PORT`) and its `globalSetup` runs the seed script before the test - nothing else needs to be
running first, beyond Postgres (and Redis, optional) themselves.

## Related

- HTTP wiring and route map: [`apps/web/README.md`](../web/README.md)
- Production image includes a pre-built admin bundle from the root `Dockerfile`.
