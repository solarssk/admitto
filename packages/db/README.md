# @admitto/db

Database layer for Admitto. PostgreSQL is the single engine across dev, CI and production (ADR 0004).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) — required to run PostgreSQL locally

## First run

```bash
# 1. Start Postgres
docker compose -f infra/docker-compose.yml up -d db   # from repo root

# 2. Configure connection
cp packages/db/.env.example packages/db/.env          # already set for docker-compose defaults

# 3. Generate Prisma client and migrate (includes agency public_ref backfill)
npm run db:migrate -w @admitto/db
npm run db:seed -w @admitto/db      # idempotent — safe to run multiple times
npm run db:test-setup               # from repo root — creates admitto_*_test DBs for package tests
```

Or from the repo root using the delegating scripts:

```bash
npm run db:migrate
npm run db:migrate:status   # check applied migrations / schema drift
npm run db:seed
```

## Scripts

| Script | Description |
|---|---|
| `db:generate` | Generates the Prisma client from `prisma/schema.prisma` |
| `db:migrate` | Applies pending migrations (`prisma migrate deploy`) then idempotent agency `public_ref` backfill (no prebuild required) |
| `db:migrate:dev` | Creates a new migration from schema changes during development (`prisma migrate dev`) |
| `db:migrate:status` | Shows which migrations are applied and whether the schema has local drift |
| `db:backfill-public-ref` | Idempotent TS backfill for agency rows missing `public_ref` (also runs at end of `db:migrate`) |
| `db:seed` | Inserts 1 event + 4 attendees (upsert by `(event_id, email)` — mirrors real import logic) |

From repo root, `npm run db:test-setup` creates `admitto_tickets_test` and `admitto_import_test`
(idempotent). Required before `npm test` when using the local Docker Postgres.

## Import

```ts
import { prisma } from '@admitto/db';
import { type AttendeeStatus, type CheckInStatus, CHECKIN_STATUS } from '@admitto/db';
```

## Statuses

TypeScript unions in `src/status.ts` are the single source of truth for all status values
(no Prisma enums — kept as String for portability and consistency).

| Type | Values |
|---|---|
| `AttendeeStatus` | `registered \| confirmed \| cancelled` |
| `EmailDeliveryPurpose` | `initial \| resend` |
| `EmailDeliveryStatus` | `queued \| accepted \| sent \| delivered \| failed \| bounced \| rejected` |
| `WalletPassStatus` | `active \| voided \| expired` |
| `CheckInStatus` | `VALID \| ALREADY_CHECKED_IN \| INVALID \| REVOKED \| UNKNOWN_EVENT \| NETWORK_ERROR` |

`CheckInStatus` captures scanner validation outcomes (including scanner-side results like
`NETWORK_ERROR` and `UNKNOWN_EVENT`) as the project source of truth.

## Schema notes

- `Attendee.token_hash` — SHA-256 of the raw token; null for agency (Mode B) attendees.
- `Attendee.qr_payload` — agency-provided QR payload preserved as source of truth.
- `Attendee.external_uuid` — agency UUID; unique per event `(event_id, external_uuid)` for idempotent re-import.
- `CheckIn.event_id` — denormalised for event-scoped queries; composite FK `(attendee_id, event_id)` → `Attendee(id, event_id)` prevents cross-event mismatches.
- `CheckIn.status` — `CheckInStatus` value recorded at scan time.
