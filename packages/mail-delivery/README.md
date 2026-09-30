# @admitto/mail-delivery

Orchestrates ticket email delivery: resolve config/template → issue ticket → render a frozen snapshot → atomic claim (an `EmailDelivery` row in status `queued`) → the Admitto **worker** drains the queued rows (`drainPendingDeliveries`) and sends through the mailer → status updates (`accepted` / `sent` / `failed` / ...). `sendTicketEmails` only enqueues unless it is called with `deliverImmediately: true` (tests and legacy callers), so a running worker is required for mail to leave the system.

## Exports

### Ticket pipeline

- `sendTicketEmails(eventId, options, prisma, env?, deps?)` - `options` is required (`SendTicketEmailsOptions`: `attendeeIds?`, `templateId?`, `purpose?`, `recipientEmail?`, `baseUrl?`, `timezone?`, `actorUserId?`, `sessionId?`, `deliverImmediately?`)
- `resendTicketEmail(attendeeId, prisma, env?, deps?, options?)`
- `retryDelivery(deliveryId, prisma, env?, deps?, options?)`
- `recordTicketViewed(attendeeId, eventId, prisma)`
- `buildAttendeeMailLinks`, `mapSendResultToDelivery`, `claimInitialDelivery`

### Operator preflight (v0.3 PR5)

- `sendTestEmail({ eventId, toAddress, templateId? }, prisma, env?, deps?, options?)` - one test mail with **sample** template data (the default ticket template via `previewTemplate`, or the template passed as `templateId`); sample ticket, QR and wallet links are replaced by inert placeholders; does **not** create `EmailDelivery` rows
- `getMailConfigDescription(eventId, prisma, env?)` - masked read-only config (passthrough to `describeMailConfig`)
- `listDeliveries({ eventId, filters?, skip?, take? }, prisma)` - returns `{ items, total }`; safe delivery log projection (no `rendered_html` body; it does include `rendered_subject`, which is the row's title in the log)

### Queue and lifecycle

`drainPendingDeliveries` (capped by `DEFAULT_MAIL_DRAIN_LIMIT` per worker tick), `cancelBulkSendBatch`, `MAX_MAIL_DRAIN_ATTEMPTS`, `mailDrainRetryBackoffMs`, `isMailDrainRetryDue`, `nullifyDeliverySnapshots`.

### Delivery log and detail

`countDeliveries`, `getDeliveryWithTimeline`, `getRenderedDelivery` (the only function that returns the `rendered_html` / `rendered_subject` bodies), `toDeliveryDto`, `toDeliveryDetailDto`.

### Transport diagnostics and bounce ingest

`sendTransportTestEmail`, `sendEventTransportTestEmail`, `runEventBounceProbe`, and the bounce-ingest API used by the worker and the admin app (`ingestBounces`, `testBounceImapConnection`, `ImapInboundProvider`, `parseBounceLines`, `applyBounceResult`). Also exported: `resolveBaseUrl`, `sanitizeDeliveryError` / `clientSafeDeliveryError`, `claimInitialDelivery`, `createResendDelivery`.

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
npm run cli -w @admitto/mail-delivery -- deliveries --event <eventId> [--status accepted] [--purpose initial|resend] [--attendee <attendeeId>]
npm run cli -w @admitto/mail-delivery -- ingest-bounces [--event-id <eventId>]
npm run cli -w @admitto/mail-delivery -- nullify-delivery-snapshots [--dry-run]
```

Low-level transport-only sends (no event/template) remain in `@admitto/mailer`: `npm run send -w @admitto/mailer`.

## Dedup

Initial sends use a PostgreSQL partial unique index on `(attendee_id, event_id) WHERE purpose = 'initial'` and `claimInitialDelivery` (insert / `P2002` handling).

## Frozen snapshot (no plaintext tokens in DB)

`rendered_html` / `rendered_subject` are stored with literal `{{ticket_url}}`, `{{qr_image_url}}`, `{{apple_wallet_url}}` and `{{google_wallet_url}}` placeholders. The links are materialized only when the message is actually delivered (the worker drain, a retry or an immediate send) via `materializeStoredDeliveryMessage` from `@admitto/mail-templates` (decrypt `token_enc` at point of use). This preserves keyless DB leak resistance from ADR 0006.

## Retry vs resend

- **Retry** - same `EmailDelivery` row, frozen `rendered_subject` / `rendered_html`.
- **Resend** - new row with `purpose = 'resend'`, fresh render.

## Snapshot retention

Terminal deliveries keep frozen HTML/subject for retry and support. After 60 days the Admitto **worker**
(once at boot, then about every 24h) and `admitto retention run` clear `rendered_html` /
`rendered_subject` while preserving delivery log metadata. A failed row loses `retryable` at the same
time, so it can no longer be retried. `EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS` is read only by this
package's own `nullify-delivery-snapshots` CLI command; the worker and `admitto retention run` always
use 60 days today.

## Tests

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/mail-delivery
```
