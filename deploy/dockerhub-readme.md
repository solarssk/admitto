<p align="center">
  <img src="https://raw.githubusercontent.com/solarssk/admitto/main/docs/assets/admitto-logo.svg" alt="Admitto" height="64">
</p>

<p align="center">
  <a href="https://github.com/solarssk/admitto/actions/workflows/ci.yml"><img src="https://github.com/solarssk/admitto/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/solarssk/admitto/releases"><img src="https://img.shields.io/github/v/tag/solarssk/admitto?sort=semver&label=release&color=066fd1" alt="release"></a>
  <a href="https://github.com/solarssk/admitto/pkgs/container/admitto"><img src="https://img.shields.io/badge/docker-amd64%20%7C%20arm64-2496ED?logo=docker&logoColor=white" alt="Docker: amd64 and arm64"></a>
  <a href="https://github.com/solarssk/admitto/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="Apache 2.0"></a>
</p>

# Admitto

**Self-hosted registration-to-check-in for internal corporate events.** One source of truth. No SaaS. No recurring fees.

Full documentation, source, and the Wiki live on GitHub: **[github.com/solarssk/admitto](https://github.com/solarssk/admitto)**.

## What is Admitto?

Admitto covers everything between "we have a guest list" and "the event is over and we know who showed up": import attendees, issue each one a secure QR ticket, deliver it by email (and optionally to Apple/Google Wallet), check people in at the door, and export who actually attended. It exists so that running an internal company event doesn't mean paying recurring fees for a general-purpose ticketing SaaS, or handing attendee data to one.

The idea it's built around: **Admitto is the single source of truth** for who's invited, who confirmed, and who showed up. The ticket email, the ticket page, and a wallet pass are just delivery layers that reflect that state - none of them hold their own copy of the truth.

**Who uses it day to day:** an Admin sets up the event, imports attendees, and sends tickets; an Operator (staff at the door) runs check-in on a tablet or scanner; a Superadmin configures the instance itself (mail, integrations, sign-in). Attendees never sign in at all - they receive a ticket and show it.

## How it works

1. **Import** attendees from CSV/XLSX.
2. **Generate** a secure QR token for each one.
3. **Deliver** the ticket by email (Microsoft 365, SMTP, or Power Automate).
4. **Wallet pass** (optional) - Apple and Google Wallet from the same ticket.
5. **Check-in** at the door - tablet scan, no double-entry.
6. **Reports** - PDF/XLSX export of who actually showed up.

## Features

| Area | What it does |
|------|--------------|
| 🎫 Tickets | Each guest gets a unique QR and a browser ticket page. Venue map, directions, and weather when you configure them. |
| 📱 Wallet passes | Add to Apple Wallet / Google Wallet from the ticket page, backed by PassCreator. Staff can void, restore, push updates, or delete a pass, and see whether the attendee actually added it. |
| ✉️ Mail | Send tickets via Microsoft 365, SMTP, or Power Automate. Detect bounced mail and inspect why a send failed. |
| 👥 Attendees | Import from CSV/XLSX, ticket types, custom fields, bulk actions, and delete a guest when required (GDPR). |
| ✅ Check-in | Scan with a camera or USB scanner, or look someone up by name. Hand out badges and items. Beep / vibration on each scan. |
| 🖥️ Staff admin | Events, reports, and who can access what. Staff can connect or disconnect their own company SSO from My account. |
| ⚙️ Ops | A background worker sends mail and finishes long imports/exports. Health page plus audit and security logs. |
| 🔒 Security | Two-factor login (TOTP, passkeys, and security keys), company SSO (OIDC), optional Cloudflare Access. Secrets encrypted at rest. |
| 🏠 Hosting | You run it yourself. Roles: Superadmin, Admin, Operator. |

**Coming later:** public self-service registration is not part of Admitto; first-event intake is planned via MS Forms → `/api/ingest`.

## Stack

| Layer | Technologies |
|-------|-------------|
| 🟢 Runtime | Node.js 24, TypeScript, Docker (multi-arch: `linux/amd64` + `linux/arm64`) |
| 🔌 Backend | Hono 4, PostgreSQL (Prisma 7), Redis |
| 🎨 Frontend | React 19, react-router 7, Vite, Tabler design tokens |
| 📬 Mail | M365 Graph · SMTP · Power Automate · IMAP bounce ingest |
| 🔑 Auth | Local accounts · OIDC · Cloudflare Access (ZTNA) · 2FA (TOTP, WebAuthn passkeys/security keys) |

## Image tags

```text
solarssk/admitto:X.Y.Z      # pinned release, e.g. 0.6.7
solarssk/admitto:X.Y        # rolling minor line, e.g. 0.6
```

Multi-arch manifest (`linux/amd64` + `linux/arm64`) - Docker pulls the one matching your host automatically. Every image passes a Trivy CRITICAL-vulnerability gate before it's pushed, and the same content is also published to `ghcr.io/solarssk/admitto` if you prefer GHCR.

This image is one part of a Docker Compose stack (app, worker, PostgreSQL, Redis, nginx) - it's not meant to run standalone with `docker run`. Deploy instructions: **[deploy/README.md](https://github.com/solarssk/admitto/blob/main/deploy/README.md)**.

## Links

- [Documentation and Wiki](https://github.com/solarssk/admitto/wiki)
- [Deployment guide](https://github.com/solarssk/admitto/blob/main/deploy/README.md)
- [Security policy](https://github.com/solarssk/admitto/blob/main/SECURITY.md)
- [Changelog](https://github.com/solarssk/admitto/blob/main/CHANGELOG.md)

## Licence

[Apache License 2.0](https://github.com/solarssk/admitto/blob/main/LICENSE): a permissive open-source licence. You can self-host, modify, and run Admitto internally at no cost; keep the copyright and NOTICE file with any distribution. This is not legal advice, review the licence text for your own compliance needs.
