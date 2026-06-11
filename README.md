# Admitto

> **Status: pre-MVP / early development — internal use only.**
> Not ready for production use with real personal data until GDPR compliance is confirmed.

A self-hostable event access gateway: attendee import, QR tickets, wallet passes, M365 mail,
and check-in scanning. See [SECURITY.md](SECURITY.md) before deploying with real data.

**This repository contains only generic code and synthetic data (`@example.com`).
No secrets, no real personal data are ever committed here.**

## Prerequisites

- Node.js `>=22.13.0 <23` (LTS 22 line)
- [Docker](https://docs.docker.com/get-docker/) — required to run PostgreSQL locally

## Setup

```bash
# 1. Start Postgres
docker compose -f infra/docker-compose.yml up -d db

# 2. Install dependencies
npm install

# 3. Migrate and seed
npm run db:migrate
npm run db:seed

# 4. Run tests
npm test
```

## Packages

| Package | Description |
|---|---|
| [`packages/mailer`](packages/mailer/README.md) | Email sending — one interface, three transports (Graph, SMTP, Power Automate) |
| [`packages/db`](packages/db/README.md) | Database layer — Prisma schema + client (PostgreSQL) |

## Security & data

This tool processes personal data (name, email, attendance status).

- See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.
- GDPR/data-minimisation guidance will be published in the project wiki.
- Never commit `.env` files, real attendee lists, or any credentials.

## Licence

MIT
