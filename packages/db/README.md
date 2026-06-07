# @admitto/db

Database layer for Admitto. SQLite for local development, portable to PostgreSQL.

## First run

```bash
cp .env.example .env
npm run db:generate   # generates the Prisma client
npm run db:migrate    # creates / migrates the database (dev.db)
npm run db:seed       # inserts test data (idempotent — safe to run multiple times)
```

## Scripts

| Script | Description |
|---|---|
| `db:generate` | Generates the Prisma client from `prisma/schema.prisma` |
| `db:migrate` | Creates / updates the database schema (writes to `prisma/migrations/`) |
| `db:seed` | Inserts 1 event + 3 attendees (upsert — safe to run multiple times) |

## Import

```ts
import { prisma } from '@admitto/db';
import { type AttendeeStatus } from '@admitto/db';
```

## Statuses

Instead of Prisma `enum` (not supported by SQLite), TypeScript unions in `src/status.ts`:

- `AttendeeStatus`: `registered | confirmed | cancelled`
- `EmailDeliveryStatus`: `pending | sent | failed | bounced`
- `WalletPassStatus`: `active | voided | expired`
