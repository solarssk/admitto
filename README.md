# Admitto

> **Status: pre-MVP / early development — internal use only.**
> Not ready for production use with real personal data until GDPR compliance is confirmed.

A self-hostable event access gateway: attendee import, QR tickets, wallet passes, M365 mail,
and check-in scanning. See [SECURITY.md](SECURITY.md) before deploying with real data.

**This repository contains only generic code and synthetic data (`@example.com`).
No secrets, no real personal data are ever committed here.**

## Setup

```bash
node -v  # should be 22.13.0 or higher (<23)
npm install
npm test
```

The repository targets the Node 22 LTS line, but the current toolchain requires Node.js `>=22.13.0 <23`.

## Packages

| Package | Description |
|---|---|
| [`packages/mailer`](packages/mailer/README.md) | Email sending — one interface, three transports (Graph, SMTP, Power Automate) |
| [`packages/db`](packages/db/README.md) | Database layer — Prisma schema + client (SQLite/dev, portable to PostgreSQL) |

## Security & data

This tool processes personal data (name, email, attendance status).

- See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.
- GDPR/data-minimisation guidance will be published in the project wiki.
- Never commit `.env` files, real attendee lists, or any credentials.

## Licence

MIT
