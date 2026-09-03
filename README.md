<p align="center">
  <img src="docs/assets/admitto-logo.svg#gh-light-mode-only" alt="Admitto" height="64">
  <img src="docs/assets/admitto-logo-dark.svg#gh-dark-mode-only" alt="Admitto" height="64">
</p>

<p align="center">
  <a href="https://github.com/solarssk/admitto/actions/workflows/ci.yml"><img src="https://github.com/solarssk/admitto/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  &nbsp;
  <a href="https://github.com/solarssk/admitto/releases"><img src="https://img.shields.io/github/v/tag/solarssk/admitto?sort=semver&label=release&color=066fd1" alt="release"></a>
  &nbsp;
  <a href="https://github.com/solarssk/admitto/pkgs/container/admitto"><img src="https://img.shields.io/badge/docker-amd64%20%7C%20arm64-2496ED?logo=docker&logoColor=white" alt="Docker: amd64 and arm64"></a>
  &nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="Apache 2.0"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24">
  &nbsp;
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  &nbsp;
  <img src="https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white" alt="Hono 4">
  &nbsp;
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  &nbsp;
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL">
  &nbsp;
  <img src="https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white" alt="Prisma 7">
  &nbsp;
  <img src="https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white" alt="Redis">
</p>

<p align="center">
  <strong>Self-hosted registration-to-check-in for internal corporate events.</strong><br>
  One source of truth. No SaaS. No recurring fees.
</p>

---

## What is Admitto?

Admitto covers everything between "we have a guest list" and "the event is over and we know who showed up": import attendees, issue each one a secure QR ticket, deliver it by email (and optionally to Apple/Google Wallet), check people in at the door, and export who actually attended. It exists so that running an internal company event doesn't mean paying recurring fees for a general-purpose ticketing SaaS, or handing attendee data to one.

The idea it's built around: **Admitto is the single source of truth** for who's invited, who confirmed, and who showed up. The ticket email, the ticket page, and a wallet pass are just delivery layers that reflect that state - none of them hold their own copy of the truth.

**Who uses it day to day:** an Admin sets up the event, imports attendees, and sends tickets; an Operator (staff at the door) runs check-in on a tablet or scanner; a Superadmin configures the instance itself (mail, integrations, sign-in). Attendees never sign in at all - they receive a ticket and show it.

## Documentation map

Admitto is **self-hosted software**, not a subscription service you sign up for. Someone
technical (an in-house developer or an IT contractor) needs to deploy and run it, using
[Production deployment](#production-deployment) below. If you don't have that today, that's the
first thing to plan for, before the rest of this README.

| You are… | Start here |
|----------|------------|
| **Deciding whether to adopt Admitto** (no in-house IT yet) | [docs/security/CORPORATE-DEPLOYMENT.md](docs/security/CORPORATE-DEPLOYMENT.md): what running it actually requires |
| **Event Manager, check-in operator, or Superadmin** (using Admitto) | [User guide Wiki](https://github.com/solarssk/admitto/wiki) (source: [`docs/wiki/`](docs/wiki/)) |
| **Developer** (local setup, tests) | This README · [infra/README.md](infra/README.md) · [packages/README.md](packages/README.md) · [AGENTS.md](AGENTS.md) · [CLAUDE.md](CLAUDE.md) |
| **Integrator** (building against Admitto's wallet/mail extension points) | [docs/dev/README.md](docs/dev/README.md) |
| **Operator** (production deploy) | [deploy/README.md](deploy/README.md) · [deploy/ENV.md](deploy/ENV.md) (env dictionary) |
| **Security / privacy reviewer** | [SECURITY.md](SECURITY.md) · [docs/security/SECURITY-CONTROLS.md](docs/security/SECURITY-CONTROLS.md) · [docs/security/ARCHITECTURE-FOR-AUDITORS.md](docs/security/ARCHITECTURE-FOR-AUDITORS.md) |
| **DPO / GDPR** | [DATA-PROTECTION.md](DATA-PROTECTION.md) · [docs/security/GDPR-ONE-PAGER.md](docs/security/GDPR-ONE-PAGER.md) · [docs/security/DSAR-PROCEDURE.md](docs/security/DSAR-PROCEDURE.md) |

The rest of this README (features, stack, local setup) is written for the **Developer** row above.

## How it works

```mermaid
flowchart LR
    A["📥 Import\nCSV / XLSX"] --> B["🔐 Generate\nsecure QR token"]
    B --> C["✉️ Deliver ticket\nM365 · SMTP · Power Automate"]
    C --> E["✅ Check-in\ntablet scan · no double-entry"]
    E --> F["📊 Reports &\nPDF / XLSX export"]
    C --> D["📱 Wallet pass\nApple & Google"]
```

All of the above is supported today.

## Features

Unfamiliar term below (TOTP, OIDC, …)? Check the [Glossary](docs/wiki/Glossary.md).

| | Area | What it does |
|---|------|--------------|
| 🎫 | **Tickets** | Each guest gets a unique QR and a browser ticket page. Venue map, directions, and weather when you configure them. |
| 📱 | **Wallet passes** | Add to Apple Wallet / Google Wallet from the ticket page, backed by PassCreator. Staff can void, restore, push updates, or delete a pass, and see whether the attendee actually added it. |
| ✉️ | **Mail** | Send tickets via Microsoft 365, SMTP, or Power Automate. Detect bounced mail and inspect why a send failed. |
| 👥 | **Attendees** | Import from CSV/XLSX, ticket types, custom fields, bulk actions, and delete a guest when required (GDPR). |
| ✅ | **Check-in** | Scan with a camera or USB scanner, or look someone up by name. Hand out badges and items. Beep / vibration on each scan. |
| 🖥️ | **Staff admin** | Events, reports, and who can access what. Staff can connect or disconnect their own company SSO from My account. |
| ⚙️ | **Ops** | A background worker sends mail and finishes long imports/exports. Health page plus audit and security logs. |
| 🔒 | **Security** | Two-factor login (TOTP, passkeys, and security keys), company SSO (OIDC), optional Cloudflare Access. Secrets encrypted at rest. Session and login logs show the country for each IP, looked up on your own server (no external geo API). |
| 🏠 | **Hosting** | You run it yourself. Roles: Superadmin, Admin, Operator. |

**Coming later:** public self-service registration is not part of Admitto; first-event intake is planned via MS Forms → `/api/ingest`.

## Stack

| | Layer | Technologies |
|---|-------|-------------|
| 🟢 | **Runtime** | Node.js 24, TypeScript, Docker (multi-arch: `linux/amd64` + `linux/arm64`) |
| 🔌 | **Backend** | Hono 4, PostgreSQL (Prisma 7), Redis |
| 🎨 | **Frontend** | React 19, react-router 7, Vite, Tabler design tokens |
| 📬 | **Mail** | M365 Graph · SMTP · Power Automate · IMAP bounce ingest |
| 🔑 | **Auth** | Local accounts · OIDC · Cloudflare Access (ZTNA) · 2FA (TOTP, WebAuthn passkeys/security keys) |

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

## Production deployment

Self-hosted **Docker Compose** only. Images are published to `ghcr.io/solarssk/admitto` on each `vX.Y.Z` git tag, and mirrored to `docker.io/solarssk/admitto`, as a **multi-arch manifest** (`linux/amd64` + `linux/arm64`) - Docker pulls the right one automatically, whether you're on a standard x86 VPS or arm64 hardware (AWS Graviton, Oracle Cloud's free arm tier, Raspberry Pi-class devices, Apple Silicon via Docker Desktop). Both platforms pass the same Trivy CRITICAL-vulnerability gate before either is pushed.
Compose runs **`app`**, **`migrate`**, and a single **`worker`** (mail drain, import/export, bounce, retention).
See [deploy/README.md](deploy/README.md).

## Repo layout

| Path | Role |
|------|------|
| [`apps/web`](apps/web/README.md) | HTTP API, auth HTML, ticket page, rate limits |
| [`apps/admin`](apps/admin/README.md) | Staff React SPA (events, check-in, settings) |
| [`apps/cli`](apps/cli/README.md) | `admitto` CLI (worker, auth recovery, event-day failover) |
| [`packages/`](packages/README.md) | Shared libraries (auth, tickets, mail, db, ui, …) |
| [`infra/`](infra/README.md) | Local Docker Compose (Postgres / Redis) |
| [`deploy/`](deploy/README.md) | Production Compose, image, env |
| [`docs/wiki/`](docs/wiki/) | Operator Wiki source |

## Roadmap

[VERSIONING.md](VERSIONING.md) is the **only** place the release line, what's shipped, and what's next are tracked - intentionally not duplicated here, so this README can't drift out of sync with it the way a second copy eventually would.

## Licence

[Apache License 2.0](LICENSE): a permissive open-source licence. You can self-host, modify, and
run Admitto internally at no cost; keep the copyright and NOTICE file with any distribution.
This is not legal advice, review the licence text for your own compliance needs.
Copyright and Apache NOTICE: [NOTICE](NOTICE). Third-party attribution (OFL fonts, LGPL libvips): [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
