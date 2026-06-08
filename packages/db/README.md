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
| `db:seed` | Inserts 1 event + 3 attendees (upsert by `(event_id, email)` — mirrors real import logic) |

## Import

```ts
import { prisma } from '@admitto/db';
import { type AttendeeStatus, type CheckInStatus, CHECKIN_STATUS } from '@admitto/db';
```

## Statuses

Instead of Prisma `enum` (not supported by SQLite), TypeScript unions in `src/status.ts`
are the single source of truth for all status values.

| Type | Values |
|---|---|
| `AttendeeStatus` | `registered \| confirmed \| cancelled` |
| `EmailDeliveryStatus` | `pending \| sent \| failed \| bounced` |
| `WalletPassStatus` | `active \| voided \| expired` |
| `CheckInStatus` | `VALID \| ALREADY_CHECKED_IN \| INVALID \| REVOKED \| UNKNOWN_EVENT \| NETWORK_ERROR` |

`CheckInStatus` captures scanner validation outcomes (including scanner-side results like
`NETWORK_ERROR` and `UNKNOWN_EVENT`) as the project source of truth.

## Schema notes

- `Attendee.token` — unique, unguessable identifier for QR/Wallet (generated at import step).
- `Attendee.qr_payload` — agency-provided QR payload preserved as source of truth.
- `Attendee.external_uuid` — agency UUID; unique per event `(event_id, external_uuid)` for idempotent re-import.
- `CheckIn.event_id` — denormalised for event-scoped queries without an Attendee join.
- `CheckIn.status` — `CheckInStatus` value recorded at scan time.
