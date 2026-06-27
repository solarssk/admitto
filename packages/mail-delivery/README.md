# @admitto/mail-delivery

Orchestrates ticket email delivery: resolve config/template → issue ticket → render → atomic claim → send → `EmailDelivery` persistence.

## Exports

### Ticket pipeline

- `sendTicketEmails(eventId, options?, prisma, env?, deps?)`
- `resendTicketEmail(attendeeId, prisma, env?, deps?)`
- `retryDelivery(deliveryId, prisma, env?, deps?)`
- `recordTicketViewed(attendeeId, eventId, prisma)`
- `buildAttendeeMailLinks`, `mapSendResultToDelivery`, `claimInitialDelivery`

### Operator preflight (v0.3 PR5)

- `sendTestEmail({ eventId, toAddress }, prisma, env?, deps?)` — one test mail with **sample** template data (`previewTemplate`); does **not** create `EmailDelivery` rows
- `getMailConfigDescription(eventId, prisma, env?)` — masked read-only config (passthrough to `describeMailConfig`)
- `listDeliveries({ eventId, filters?, skip?, take? }, prisma)` — returns `{ items, total }`; safe delivery log projection (no `rendered_html` body)

## Test-send vs ticket send

| | `sendTestEmail` | `sendTicketEmails` |
|---|---|---|
| Template data | Sample (`sample-token`, `@example.com`) | Real attendee + issued ticket |
| `EmailDelivery` row | No | Yes (`initial` / `resend`) |
| Use case | Verify provider/config before event | Production ticket delivery |

## CLI

Requires `DATABASE_URL` (from `.env` in monorepo root, `packages/db/.env`, or this package). The `cli` script builds workspace dependencies automatically (`precli`), then runs compiled `dist/cli.js`.

```bash
npm run cli -w @admitto/mail-delivery -- test-send --to operator@example.com --event <eventId>
npm run cli -w @admitto/mail-delivery -- config-describe --event <eventId>
npm run cli -w @admitto/mail-delivery -- deliveries --event <eventId> [--status accepted] [--purpose initial]
npm run cli -w @admitto/mail-delivery -- nullify-delivery-snapshots [--dry-run]
```

Low-level transport-only sends (no event/template) remain in `@admitto/mailer`: `npm run send -w @admitto/mailer`.

## Dedup

Initial sends use a PostgreSQL partial unique index on `(attendee_id, event_id) WHERE purpose = 'initial'` and `claimInitialDelivery` (insert / `P2002` handling).

## Frozen snapshot (no plaintext tokens in DB)

`rendered_html` / `rendered_subject` are stored with literal `{{ticket_url}}` / `{{qr_image_url}}` placeholders. Ticket links are materialized only at send/retry via `materializeStoredDeliveryMessage` (decrypt `token_enc` at point of use). This preserves keyless DB leak resistance from ADR 0006.

## Retry vs resend

- **Retry** — same `EmailDelivery` row, frozen `rendered_subject` / `rendered_html`.
- **Resend** — new row with `purpose = 'resend'`, fresh render.

## Snapshot retention

Terminal deliveries keep frozen HTML/subject for retry and support. After 60 days (override with
`EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS`), container startup and
`nullify-delivery-snapshots` clear `rendered_html` / `rendered_subject` while preserving delivery
log metadata.

## Tests

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/mail-delivery
```
