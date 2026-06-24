# Admitto

> **Status: pre-MVP / early development — internal use only.**
> Not ready for production use with real personal data until DPO confirms lawful basis and DSAR model.
> See [DATA-PROTECTION.md](DATA-PROTECTION.md) and [docs/GDPR-ONE-PAGER.md](docs/GDPR-ONE-PAGER.md).

A self-hostable event access gateway: attendee import, QR tickets, wallet passes, M365 mail,
and check-in scanning. See [SECURITY.md](SECURITY.md) before deploying with real data.

**This repository contains only generic code and synthetic data (`@example.com`).
No secrets, no real personal data are ever committed here.**

**Release version:** git tags and root `package.json` are the source of truth (see [VERSIONING.md](VERSIONING.md)). [CHANGELOG.md](CHANGELOG.md) is the human-readable release history, not the version number itself.
Workspace packages stay at `0.0.1` — only the product version is bumped per release.

**AI agents:** start from [AGENTS.md](AGENTS.md) (all tools) and [CLAUDE.md](CLAUDE.md) (Claude Code).

## Prerequisites

- Node.js `>=24.17.0 <25` (see root `package.json` `engines`)
- [Docker](https://docs.docker.com/get-docker/) — required to run PostgreSQL locally (and optional Redis)

## Setup (database and tests)

Local **development** uses [`infra/docker-compose.yml`](infra/docker-compose.yml) (loopback Postgres/Redis).
**Production** uses a separate stack in [`deploy/`](deploy/README.md) — do not reuse dev credentials there.

```bash
# 1. Start Postgres (+ optional Redis for shared rate limits)
docker compose -f infra/docker-compose.yml up -d db redis

# 2. Database connection (matches compose defaults)
cp packages/db/.env.example packages/db/.env
# Recommended before MFA/OIDC: set ENCRYPTION_KEY (openssl rand -base64 32)

# 3. Install dependencies
npm install

# 4. Migrate, seed sample event data, and create isolated test databases
npm run db:migrate
npm run db:seed
npm run db:test-setup

# 5. Run tests
npm test
```

More detail: [infra/README.md](infra/README.md), [packages/db/README.md](packages/db/README.md).

## Run locally (staff UI)

After the database steps above:

```bash
# App env — dev defaults are fine; see apps/web/.env.example for production fields
cp apps/web/.env.example apps/web/.env

# First platform superadmin (password read from stdin — never pass on argv)
npm run auth:bootstrap -- --email admin@example.com
```

Then choose how to run the staff UI:

| Mode | Commands | Open |
|------|----------|------|
| **SPA hot reload** (UI work) | Terminal 1: `npm run dev -w @admitto/web`<br>Terminal 2: `npm run dev -w @admitto/admin` | http://localhost:5173 |
| **Single server** (prod-like) | `npm run build -w @admitto/admin` then `npm run dev -w @admitto/web` | http://localhost:3000/login |

Sign in with the bootstrapped account. MFA enrollment is required for admin/superadmin roles on first login.
SSR settings (Identity providers, Cloudflare Access) live under `/admin/auth/*` on the web server port.

See [apps/web/README.md](apps/web/README.md) and [apps/admin/README.md](apps/admin/README.md).

## Production deployment

Self-hosted **Docker Compose** only (not bare metal, not Kubernetes). See [deploy/README.md](deploy/README.md).

Images are published to `ghcr.io/solarssk/admitto` on each git tag `vX.Y.Z`. Vercel Git deploys are disabled (`vercel.json`); disconnect the project in the Vercel dashboard if PR checks still appear.

## Packages

| Package | Description |
|---------|-------------|
| [`apps/web`](apps/web/README.md) | HTTP server — Hono routes, HTML, rate limits |
| [`apps/admin`](apps/admin/README.md) | Staff React SPA — events picker, check-in, event admin |
| [`packages/auth`](packages/auth/README.md) | Sessions, MFA, OIDC, Cloudflare Access, RBAC |
| [`packages/crypto`](packages/crypto/README.md) | AES-256-GCM at-rest encryption (`ENCRYPTION_KEY`) |
| [`packages/db`](packages/db/README.md) | Prisma schema + client (PostgreSQL) |
| [`packages/import`](packages/import/README.md) | CSV attendee import (Mode A/B) |
| [`packages/mail-delivery`](packages/mail-delivery/README.md) | Ticket email orchestration + `EmailDelivery` |
| [`packages/mail-templates`](packages/mail-templates/README.md) | MJML/HTML templates + placeholder whitelist |
| [`packages/mailer`](packages/mailer/README.md) | Mail transports (Graph, SMTP, Power Automate) |
| [`packages/mailer-config`](packages/mailer-config/README.md) | Per-scope mail config resolver |
| [`packages/shared`](packages/shared/README.md) | Tiny shared helpers (CSV parsing) |
| [`packages/tickets`](packages/tickets/README.md) | Tokens, QR, issuance, check-in domain |

## Security & data

This tool processes personal data (name, email, attendance status).

- See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.
- GDPR / data protection: [DATA-PROTECTION.md](DATA-PROTECTION.md), [docs/](docs/) corp pack
- Never commit `.env` files, real attendee lists, or any credentials.
- Public `/t/*` and `/q/*` rate limiting and CSRF on mutating POSTs trust forwarded headers only when
  `TRUST_PROXY=true` behind a reverse proxy that overwrites or sanitizes `X-Forwarded-*` from clients.
- When Redis is enabled for shared rate limiting, keep a memory cap and TTL-based eviction policy
  in deployment config so spoofed-IP floods cannot grow Redis without bound.

## Licence

MIT
