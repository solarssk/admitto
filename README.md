<p align="center">
  <img src="docs/assets/admitto-logo.svg" alt="Admitto" height="40">
</p>

<p align="center">
  <a href="https://github.com/solarssk/admitto/actions/workflows/ci.yml">
    <img src="https://github.com/solarssk/admitto/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://github.com/solarssk/admitto/releases">
    <img src="https://img.shields.io/github/v/tag/solarssk/admitto?sort=semver&label=release&color=066fd1" alt="release">
  </a>
  <img src="https://img.shields.io/badge/node-24-brightgreen" alt="Node 24">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</p>

<p align="center">
  Self-hosted registration-to-check-in for internal corporate events.<br>
  One source of truth. No SaaS. No recurring fees.
</p>

---

> **Status: pre-MVP / early development — internal use only.**
> Not ready for production with real personal data until the data protection review is complete.
> See [DATA-PROTECTION.md](DATA-PROTECTION.md) and [SECURITY.md](SECURITY.md) before deploying.
>
> This repository contains only generic code and synthetic data (`@example.com`).
> No secrets, no real personal data are ever committed here.

## How it works

```
Import attendees (CSV / XLSX / agency UUIDs)
  → generate secure, single-use QR tokens
  → deliver personalised tickets via M365 Graph, SMTP, or Power Automate
  → staff scan on any tablet — atomic check-in, no double-entry
  → paper fallback (PDF / XLSX) for offline operation
  → Apple & Google Wallet passes coming in v0.5
```

## Features

- **One source of truth** — Admitto owns state; email, Wallet, and PDF only reflect it
- **Secure QR tickets** — unpredictable tokens, single-use, replay-safe
- **Flexible mail delivery** — M365 Graph, SMTP, or Power Automate; Outlook-safe HTML templates
- **Operator-first check-in** — scanner-driven, tablet-ready, manual lookup, works offline with paper fallback
- **Strong security defaults** — 2FA (TOTP), OIDC, Cloudflare Access (ZTNA), AES-256-GCM at-rest, audit logs
- **Self-hosted, RBAC** — superadmin / admin / operator roles; one instance, multiple organisations

## Stack

```
Node.js 24 · Hono 4 · React 19 · TypeScript · PostgreSQL · Redis · Docker
Mail:  M365 Graph · SMTP · Power Automate
Auth:  local accounts · OIDC (Authentik) · Cloudflare Access (ZTNA)
```

## Prerequisites

- Node.js `>=24.17.0 <25` (see root `package.json` `engines`)
- [Docker](https://docs.docker.com/get-docker/) — required to run PostgreSQL locally (and optional Redis)

## Quick start

Local **development** uses [`infra/docker-compose.yml`](infra/docker-compose.yml) (loopback Postgres/Redis).
**Production** uses a separate stack — see [deploy/README.md](deploy/README.md) and do not reuse dev credentials there.

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

# 4. Run tests
npm test

# 5. Bootstrap the first superadmin (password read from stdin — never pass on argv)
npm run auth:bootstrap -- --email admin@example.com
```

Then start the staff UI:

| Mode | Commands | URL |
|------|----------|-----|
| **SPA hot reload** (UI work) | `npm run dev -w @admitto/web` + `npm run dev -w @admitto/admin` | http://localhost:5173 |
| **Single server** (prod-like) | `npm run build -w @admitto/admin` then `npm run dev -w @admitto/web` | http://localhost:3000/login |

Sign in with the bootstrapped account. MFA enrolment is required on first login for admin and superadmin roles.

More detail: [infra/README.md](infra/README.md) · [apps/web/README.md](apps/web/README.md) · [apps/admin/README.md](apps/admin/README.md)

## Production deployment

Self-hosted **Docker Compose** only. Images are published to `ghcr.io/solarssk/admitto` on each `vX.Y.Z` git tag.
See [deploy/README.md](deploy/README.md).

## Packages

| Package | Layer | Description |
|---------|-------|-------------|
| [`apps/web`](apps/web/README.md) | server | Hono HTTP server — routes, HTML, rate limits |
| [`apps/admin`](apps/admin/README.md) | frontend | Staff React SPA — events, check-in, admin tooling |
| [`packages/auth`](packages/auth/README.md) | shared | Sessions, 2FA, OIDC, Cloudflare Access, RBAC |
| [`packages/crypto`](packages/crypto/README.md) | shared | AES-256-GCM at-rest encryption |
| [`packages/db`](packages/db/README.md) | shared | Prisma schema + PostgreSQL client |
| [`packages/import`](packages/import/README.md) | shared | CSV / XLSX attendee import |
| [`packages/mail-delivery`](packages/mail-delivery/README.md) | shared | Email orchestration + delivery tracking |
| [`packages/mail-templates`](packages/mail-templates/README.md) | shared | MJML/HTML email templates |
| [`packages/mailer`](packages/mailer/README.md) | shared | Mail transports (Graph, SMTP, Power Automate) |
| [`packages/mailer-config`](packages/mailer-config/README.md) | shared | Per-scope mail transport resolver |
| [`packages/shared`](packages/shared/README.md) | shared | Shared helpers |
| [`packages/tickets`](packages/tickets/README.md) | shared | Tokens, QR generation, check-in domain |

## Roadmap

| Milestone | What ships |
|-----------|------------|
| v0.5 | Apple & Google Wallet passes (PassCreator) |
| v0.6 | RSVP intake via external forms |
| v0.7–0.9 | Hardening, stress testing, dry run |
| **v1.0** | **First event go-live** |
| v1.1+ | Self-service registration, multi-language, multi-track |

## Security & data

- Report vulnerabilities: [SECURITY.md](SECURITY.md)
- Data protection & GDPR: [DATA-PROTECTION.md](DATA-PROTECTION.md), [docs/](docs/)
- Never commit `.env` files, real attendee lists, or credentials
- **AI agents:** start from [AGENTS.md](AGENTS.md) (all tools) and [CLAUDE.md](CLAUDE.md) (Claude Code)

## Licence

MIT
