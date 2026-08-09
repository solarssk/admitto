<p align="center">
  <img src="docs/assets/admitto-logo.svg" alt="Admitto" height="40">
</p>

<p align="center">
  <a href="https://github.com/solarssk/admitto/actions/workflows/ci.yml"><img src="https://github.com/solarssk/admitto/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  &nbsp;
  <a href="https://github.com/solarssk/admitto/releases"><img src="https://img.shields.io/github/v/tag/solarssk/admitto?sort=semver&label=release&color=066fd1" alt="release"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/node-24-brightgreen" alt="Node 24">
  &nbsp;
  <img src="https://img.shields.io/badge/prisma-7-2D3748" alt="Prisma 7">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</p>

<p align="center">
  Self-hosted registration-to-check-in for internal corporate events.<br>
  One source of truth. No SaaS. No recurring fees.
</p>

---

> **Status: v0.4.x (pre-1.0), internal / early production.**
> Treat personal data carefully until your organisation's data protection review is complete.
> See [DATA-PROTECTION.md](DATA-PROTECTION.md) and [SECURITY.md](SECURITY.md) before deploying.
>
> This repository contains only generic code and synthetic data (`@example.com`).
> No secrets and no real personal data are ever committed here.

## How it works

```mermaid
flowchart LR
    A["Import\nCSV / XLSX"] --> B["Generate\nsecure QR token"]
    B --> C["Deliver ticket\nM365 · SMTP · Power Automate"]
    C --> E["Check-in\ntablet scan · no double-entry"]
    E --> F["Reports &\nPDF / XLSX export"]
    C -.-> D["Wallet pass\nApple & Google · v0.5"]
```

Solid path is supported today. Wallet passes are planned for **v0.5** (placeholders only in the UI until then).

## Features

| Area | What you get today (v0.4.13) |
|------|------------------------------|
| **Tickets** | Secure QR tokens, browser ticket page, location / map / weather when configured |
| **Mail** | M365 Graph, SMTP, or Power Automate; per-event override; IMAP bounce detection; delivery diagnostics |
| **Attendees** | Ticket-type catalog, custom fields, CSV/XLSX import, bulk actions, GDPR erase |
| **Check-in** | Camera or hardware scanner, manual lookup, item hand-out, beep / vibration feedback |
| **Staff admin** | Events overview, reports, users & roles (single role type + scopes), My account SSO unlink/connect |
| **Ops** | Background worker (mail drain, import/export, bounce, retention), Health check, System / Audit / Security logs |
| **Security** | TOTP MFA, OIDC, Cloudflare Access, AES-256-GCM at rest, offline IP country on sessions/logs |
| **Hosting** | Self-hosted, multi-org RBAC (superadmin / admin / operator) |

**Not in this release:** Apple/Google Wallet generation (v0.5), public self-service registration, payments.

## Stack

| Layer | Technologies |
|-------|-------------|
| Runtime | Node.js 24, TypeScript, Docker |
| Backend | Hono 4, PostgreSQL (Prisma 7), Redis |
| Frontend | React 19, react-router 7, Vite, Tabler design tokens |
| Mail | M365 Graph · SMTP · Power Automate · IMAP bounce ingest |
| Auth | Local accounts · OIDC · Cloudflare Access (ZTNA) · 2FA (TOTP) |

## Prerequisites

- Node.js `>=24.17.0 <25` (see root `package.json` `engines`)
- [Docker](https://docs.docker.com/get-docker/) - required to run PostgreSQL locally (and optional Redis)

## Quick start

Local **development** uses [`infra/docker-compose.yml`](infra/docker-compose.yml) (loopback Postgres/Redis).
**Production** uses a separate stack - see [deploy/README.md](deploy/README.md) and do not reuse dev credentials there.

```bash
# 1. Start Postgres (+ optional Redis for shared rate limits)
docker compose -f infra/docker-compose.yml up -d db redis

# 2. Configure database connection
cp packages/db/.env.example packages/db/.env
# Set ENCRYPTION_KEY before enrolling MFA or OIDC: openssl rand -base64 32

# 3. Install, migrate, seed, prepare test databases
npm install
npm run db:migrate
npm run db:seed
npm run db:test-setup

# 4. Run tests (coverage: npm run coverage - same tests + LCOV reports)
npm test

# 5. Bootstrap the first superadmin (password read from stdin - never pass on argv)
npm run auth:bootstrap -- --email admin@example.com
```

Then start the staff UI:

| Mode | Commands | URL |
|------|----------|-----|
| **SPA hot reload** (UI work) | `npm run dev -w @admitto/web` + `npm run dev -w @admitto/admin` | http://localhost:5173 |
| **Single server** (prod-like) | `npm run build -w @admitto/admin` then `npm run dev -w @admitto/web` | http://localhost:3000/login |

Sign in with the bootstrapped account. MFA enrolment is required on first login for admin and superadmin roles.

For bulk mail, import commit, bounce detection, and retention in local dev, also run:

```bash
npm run worker
```

More detail: [infra/README.md](infra/README.md) · [apps/web/README.md](apps/web/README.md) · [apps/admin/README.md](apps/admin/README.md) · [deploy/README.md](deploy/README.md)

## Documentation map

| You are… | Start here |
|----------|------------|
| **Event Manager, check-in operator, or Superadmin** (using Admitto) | [User guide Wiki](https://github.com/solarssk/admitto/wiki) (source: [`docs/wiki/`](docs/wiki/)) |
| **Developer** (local setup, tests) | This README · [infra/README.md](infra/README.md) · [AGENTS.md](AGENTS.md) |
| **Operator** (production deploy) | [deploy/README.md](deploy/README.md) |
| **Security / privacy reviewer** | [SECURITY.md](SECURITY.md) · [docs/security/SECURITY-CONTROLS.md](docs/security/SECURITY-CONTROLS.md) · [docs/ARCHITECTURE-FOR-AUDITORS.md](docs/ARCHITECTURE-FOR-AUDITORS.md) |
| **DPO / GDPR** | [DATA-PROTECTION.md](DATA-PROTECTION.md) · [docs/GDPR-ONE-PAGER.md](docs/GDPR-ONE-PAGER.md) · [docs/DSAR-PROCEDURE.md](docs/DSAR-PROCEDURE.md) |

## Production deployment

Self-hosted **Docker Compose** only. Images are published to `ghcr.io/solarssk/admitto` on each `vX.Y.Z` git tag.
Compose runs **`app`**, **`migrate`**, and a single **`worker`** (mail drain, import/export, bounce, retention).
See [deploy/README.md](deploy/README.md).

## Packages

| Package | Layer | Description |
|---------|-------|-------------|
| [`apps/web`](apps/web/README.md) | server | Hono HTTP server: routes, HTML, rate limits |
| [`apps/admin`](apps/admin/README.md) | frontend | Staff React SPA: events, check-in, admin tooling |
| [`apps/cli`](deploy/README.md#emergency-cli-event-day-failover) | ops | Unified CLI (`admitto worker`, check-in failover, auth recovery) |
| [`packages/ui`](packages/ui/package.json) | shared | Shared React components, tokens, toast stack |
| [`packages/auth`](packages/auth/README.md) | shared | Sessions, 2FA, OIDC, Cloudflare Access, RBAC |
| [`packages/crypto`](packages/crypto/README.md) | shared | AES-256-GCM at-rest encryption |
| [`packages/db`](packages/db/README.md) | shared | Prisma schema + PostgreSQL client |
| [`packages/import`](packages/import/README.md) | shared | CSV / XLSX attendee import |
| [`packages/location`](packages/location/package.json) | shared | Venue search, geocoding, static maps |
| [`packages/storage`](packages/storage/package.json) | shared | Branding / asset uploads and garbage collection |
| [`packages/mail-delivery`](packages/mail-delivery/README.md) | shared | Email orchestration, delivery tracking, bounce ingest |
| [`packages/mail-templates`](packages/mail-templates/README.md) | shared | MJML/HTML email templates |
| [`packages/mailer`](packages/mailer/README.md) | shared | Mail transports (Graph, SMTP, Power Automate) |
| [`packages/mailer-config`](packages/mailer-config/README.md) | shared | Per-scope mail transport resolver |
| [`packages/shared`](packages/shared/README.md) | shared | Shared helpers |
| [`packages/tickets`](packages/tickets/README.md) | shared | Tokens, QR generation, check-in domain |

## Roadmap

Canonical roadmap: [VERSIONING.md](VERSIONING.md). Short view:

| Milestone | What ships |
|-----------|------------|
| **v0.4.x** | Current line (import → ticket mail → check-in → reports; location, bounce, Health, worker, …) |
| **v0.5** | External-ingest `/api/ingest` (MS Forms / Power Automate), users UX, wallet passes (PassCreator) |
| **v0.6** | TBD |
| **v0.7** | RSVP intake, calendar invites, waitlist |
| **v0.8-0.9** | Hardening, stress testing, dry run |
| **v1.0** | First event go-live |
| **v1.1+** | Self-service registration, multi-language, multi-track |

## Security & data

- Report vulnerabilities: [SECURITY.md](SECURITY.md)
- Data protection & GDPR: [DATA-PROTECTION.md](DATA-PROTECTION.md), [docs/](docs/)
- Never commit `.env` files, real attendee lists, or credentials
- **AI agents:** start from [AGENTS.md](AGENTS.md) (all tools) and [CLAUDE.md](CLAUDE.md) (Claude Code)

## Licence

MIT
