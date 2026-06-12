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

## Frozen snapshot (no plaintext tokens in DB)

`rendered_html` / `rendered_subject` are stored with literal `{{ticket_url}}` / `{{qr_image_url}}` placeholders. Ticket links are materialized only at send/retry via `materializeStoredDeliveryMessage` (decrypt `token_enc` at point of use). This preserves keyless DB leak resistance from ADR 0006.

## Retry vs resend

- **Retry** — same `EmailDelivery` row, frozen `rendered_subject` / `rendered_html`.
- **Resend** — new row with `purpose = 'resend'`, fresh render.

## Tests

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/mail-delivery
```
