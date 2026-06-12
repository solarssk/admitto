# @admitto/mail-delivery

Orchestrates ticket email delivery: resolve config/template → issue ticket → render → atomic claim → send → `EmailDelivery` persistence.

## Exports

- `sendTicketEmails(eventId, options?, prisma, env?, deps?)`
- `resendTicketEmail(attendeeId, prisma, env?, deps?)`
- `retryDelivery(deliveryId, prisma, env?, deps?)`
- `recordTicketViewed(attendeeId, eventId, prisma)`
- `buildAttendeeMailLinks`, `mapSendResultToDelivery`, `claimInitialDelivery`

## Dedup

Initial sends use a PostgreSQL partial unique index on `(attendee_id, event_id) WHERE purpose = 'initial'` and `claimInitialDelivery` (insert / `P2002` handling).

## Retry vs resend

- **Retry** — same `EmailDelivery` row, frozen `rendered_subject` / `rendered_html`.
- **Resend** — new row with `purpose = 'resend'`, fresh render.

## Tests

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/mail-delivery
```
