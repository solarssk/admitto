# @admitto/admin

Staff **React SPA** — events picker, event admin sections, operator check-in UI, and instance Settings (including Identity & SSO). Served by `@admitto/web` at `/admin/*` (and related API routes).

Login, first-run setup, and MFA enrollment remain **server-rendered HTML** from `apps/web`. Settings → Identity uses the SPA: OIDC provider list and editor live under `/admin/settings/identity/*`; Cloudflare Access still bridges to the legacy HTML editor until the SPA panel ships (#266 slice 4).

## Prerequisites

Same as the monorepo dev stack — see [README.md](../../README.md#quick-start) and [infra/README.md](../../infra/README.md):

- Postgres (and optional Redis) via `infra/docker-compose.yml`
- `packages/db/.env` with `DATABASE_URL`
- A bootstrapped superadmin (`npm run auth:bootstrap`)
- `@admitto/web` running on port `3000`

## Dev — SPA hot reload (recommended for UI work)

Two terminals from the repo root:

```bash
npm run dev -w @admitto/web    # http://localhost:3000 — API, login/setup/MFA SSR
npm run dev -w @admitto/admin  # http://localhost:5173 — Vite dev server
```

Vite proxies `/api`, `/admin/auth`, `/login`, `/logout`, and `/mfa` to `:3000` (MFA enrollment stays server-rendered during first login). Open **http://localhost:5173**, sign in, and work on React pages with HMR.

## Dev — single server (production-like)

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

## Related

- HTTP wiring and route map: [`apps/web/README.md`](../web/README.md)
- Production image includes a pre-built admin bundle from the root `Dockerfile`.
