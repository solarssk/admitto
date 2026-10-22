# @admitto/mail-delivery

Orchestrates ticket email delivery. The steps:

1. Resolve the config and the template.
2. Issue the ticket.
3. Render a frozen snapshot.
4. Claim it atomically: an `EmailDelivery` row in status `queued`.
5. The Admitto **worker** drains the queued rows (`drainPendingDeliveries`) and sends through the mailer.
6. The status updates (`accepted` / `sent` / `failed` / ...).

`sendTicketEmails` only enqueues unless it is called with `deliverImmediately: true` (tests and legacy callers). So a running worker is required for mail to leave the system.

## Exports

### Ticket pipeline

- `sendTicketEmails(eventId, options, prisma, env?, deps?)` - `options` is required (`SendTicketEmailsOptions`: `attendeeIds?`, `templateId?`, `purpose?`, `recipientEmail?`, `baseUrl?`, `timezone?`, `actorUserId?`, `sessionId?`, `deliverImmediately?`)
- `resendTicketEmail(attendeeId, prisma, env?, deps?, options?)`
- `retryDelivery(deliveryId, prisma, env?, deps?, options?)`
- `recordTicketViewed(attendeeId, eventId, prisma)`
- `buildAttendeeMailLinks`, `mapSendResultToDelivery`, `claimInitialDelivery`
- `buildConfirmUrl(guestOrigin, slug, registrationId)` - the signed guest e-mail confirmation link `{origin}/r/{slug}/confirm/{registrationId}.{mac}` (mac from `@admitto/crypto`; the same registration always gets the same link)

### Operator preflight

- `sendTestEmail({ eventId, toAddress, templateId? }, prisma, env?, deps?, options?)` sends one test mail with **sample** template data.
  - It uses the default ticket template via `previewTemplate`, or the template passed as `templateId`.
  - The sample ticket, QR and wallet links are replaced by inert placeholders.
  - It does **not** create `EmailDelivery` rows.
- `getMailConfigDescription(eventId, prisma, env?)` - masked read-only config (passthrough to `describeMailConfig`)
- `listDeliveries({ eventId, filters?, skip?, take? }, prisma)` returns `{ items, total }`. It is a safe delivery log projection: no `rendered_html` body. It does include `rendered_subject`, which is the row's title in the log.

### Registration mail

- `drainRegistrationMails(prisma, env, deps, { baseUrl, limit?, nowMs? })` sends the mail that guest registrations queued (`RegistrationMail`). Its `limit` is `DEFAULT_REGISTRATION_MAIL_DRAIN_LIMIT` (20) a tick. It returns `{ claimed, sent, failed, cancelled, skipped, eventIds }`.
- `sweepExpiredRegistrations(prisma)` deletes the registrations whose confirmation link expired. It returns `{ deleted, eventIds, more }`.
- Both run in the worker job `registration_mail`. How they work: [Guest registration mail](#guest-registration-mail).

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

## Guest registration mail

A guest who registers through the event form is not an attendee yet, so no `EmailDelivery` can hold their mail (it needs an attendee). The transaction that changes a registration queues the mail in `RegistrationMail` instead, and the worker job `registration_mail` sends it. Nothing is mailed from a request.

The row holds no address and no text, only the template name, the status and a fixed error category. The address and the names are read from the `Registration` row when the mail is sent, so deleting a registration leaves nothing behind.

### The five mails

| Template | Sent while the registration is | Notes |
|---|---|---|
| `registration-confirm` | `awaiting_email` | Carries the confirmation link. Not sent once the link has expired |
| `registration-received` | `pending` | |
| `registration-waitlist` | `waitlist` | |
| `registration-rejected` | `rejected` | Queued only when staff asked to inform the guest |
| `ticket` | `accepted` | No mail of its own: see [The ticket row](#the-ticket-row) |

A row whose registration is in another state when its turn comes is not sent. It becomes `cancelled` with the code `registration_changed` (`confirmation_expired` for a link that ran out).

### What a tick does

The job runs after the ticket drain, in the same slot of the worker tick, and is never skipped because tickets are queued. They do not run side by side, because the provider's rate limit is per mailer and a second mailer would double the pace. It takes up to 20 rows: the queued ones first, oldest first, then failed rows that may be tried again. The rows of one event share one mailer.

A row that is queued or reset to `queued` wakes the worker at once (the trigger `admitto_registration_mail_wake` notifies the shared `admitto_worker_wake` channel). Wakes never start ticks less than 2 seconds apart, so a steady stream of registrations cannot keep the loop running without a pause. **Settings → Health** shows the queue as **Registration mail queue**, as counts only.

For each row, one at a time:

1. The row is held by a session lock (`withDeliveryOwnership`), so two drains on one database cannot send it twice.
2. **The last check** is a short transaction that takes the registration queue of the event (`lockRegistrationQueue`) first. An erasure, a removal, an admission or a deletion that is still open is waited for, and its result is seen. The check reads the row and its registration as they are now: the row must be unchanged (status, `queued_at`, attempts), and the registration must be in the state of the table above. A row that fails the check is written (`cancelled`) in the same transaction.
3. **The send** has no transaction and no lock. It never makes an erasure or an admission wait.
4. **The result** is one conditional update of the mail's own row, matching the row as the drain read it. It takes no lock. A row that is gone (its registration was erased or deleted meanwhile) matches nothing and is not put back. A retry that reset the row meanwhile keeps its reset.

The lock ends before the send. A mail that is already with the provider when an erasure commits still goes out once and cannot be recalled (see the [erasure rules](../../docs/dev/attendee-erasure.md#rules-for-code)).

### What goes into the mail

- The event's name, date, place, branding and contact (`resolveEventContactVars`), from the template as it is now (event, then organization, then the built-in default).
- `confirm_url` in `registration-confirm` only: `buildConfirmUrl(guestOrigin, slug, registrationId)`. The same registration always gets the same link. `guestOrigin` is the instance URL for now.
- **The guest's names only when the address is theirs.** `first_name`, `last_name` and `full_name` are empty while the registration has no `email_verified_at` and no `decided_by`. Until then anyone can type any text for any address. The rule is in the data the template is rendered with, so an organizer's edited template that uses `{{first_name}}` follows it too.
- No ticket, QR or wallet link. A template that holds `{{ticket_url}}` fails its own row for good (`message_unusable`) and the rest of the queue goes on.

### Failures

A row never stores the text of an exception or of a provider's reply, because it can carry the guest's address. It stores a code and the fixed sentence of that code.

| Code | Status | Tried again |
|---|---|---|
| `mail_unavailable` (no provider, or unreachable) | `failed` | Yes |
| `message_unusable` (the template cannot be rendered) | `failed` | No |
| `send_failed` | `failed` | When the provider says so, and when the send threw |
| `send_rejected` | `failed` | No |
| `ticket_failed` (the ticket send could not start) | `failed` | Yes |
| `internal_error` | `failed` | Yes |
| `registration_changed`, `confirmation_expired`, `ticket_not_issuable` | `cancelled` | No |

The attempts and the delay between them are the ticket drain's (`MAX_MAIL_DRAIN_ATTEMPTS`, `mailDrainRetryBackoffMs`). `attempts` counts the attempts made, so a row that was never tried has 0. After the last attempt `retryable` is false. To send a row again (a retry, a re-sent confirmation), reset it: `status = 'queued'`, `retryable`, `error`, `error_code` and `sent_at` to null, `queued_at` to now. The new `queued_at` is a new revision, so a send in progress cannot write over the reset. The drain takes a queued row while `attempts` is below `MAX_MAIL_DRAIN_ATTEMPTS`: set `attempts = 0` for a fresh start (an operator's retry), or leave it to keep counting the sends of the row. Staff's retry is `retryRegistrationMails` in `@admitto/tickets`: it resets the last mail of a registration that failed for good and that the worker is not trying again, with `attempts = 0`.

One bad row never stops the queue. Every failure is caught for its row. The drain logs nothing per row, and the worker logs only the counts of the tick.

### The ticket row

A `ticket` row does not send a mail. It hands the ticket to the usual ticket send (`sendTicketEmails(eventId, { attendeeIds, purpose: "initial", baseUrl })`), which creates the `EmailDelivery` that the delivery log shows. The ticket drain sends it.

- **Staff sent the ticket by hand before the tick.** An `initial` send to an attendee whose first mail already went out becomes a resend, which would be a second mail. So the last check looks for an `initial` delivery in a success status, and then marks the row `sent` without a send (`attempts` stays 0).
- **Staff queued it by hand and it has not gone out yet.** The ticket send skips the in-flight duplicate, and the row is marked `sent`.
- **The attendee cannot get a ticket** (revoked, cancelled, erased): the row is `cancelled` with `ticket_not_issuable`.
- **The ticket send cannot start** (no mail provider, no instance URL): the row is `failed` with `ticket_failed` and is tried again. An attendee whose ticket was never queued can still be sent it with **Send unsent tickets**.

### Registrations that were never confirmed

`sweepExpiredRegistrations` deletes a registration in `awaiting_email` once `confirm_expires_at` has passed (24 hours after the submission), and its queued mail with it. It is the only automatic deletion of registrations. Confirming checks the age itself, so nothing depends on how often this runs.

- It reads the events that have expired registrations with a plain query. Then, for each event and batch of 500, one transaction takes the registration queue and deletes the registrations whose expiry it checks again. No row is locked before the queue (not even with `FOR UPDATE SKIP LOCKED`), so it follows the [lock order](../../docs/dev/attendee-erasure.md#rules-for-code).
- A run stops after 20 batches and says so (`more`), so that it cannot hold up a tick.
- The time is `NOW() AT TIME ZONE 'utc'`, because the columns are naive UTC and a bare `NOW()` moves the comparison by the session's zone. The tests run in zones ahead of and behind UTC.

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

## Delivery ownership

**The lock**

- Each sending path (worker, CLI retry and synchronous delivery) takes a non-blocking PostgreSQL session advisory lock for the delivery id, separate from the worker job lock.
- The dedicated connection holds no transaction or row lock during provider IO, and it closes after the outcome.
- Other delivery ids proceed independently.
- A competing CLI retry is reported as skipped.

**Connection requirements**

- `DATABASE_URL` must connect directly to PostgreSQL, or use a session-mode pooler that pins the backend for the connection's lifetime. Transaction-mode and statement-mode pooling is unsupported for delivery ownership.
- Before protected writes, the lock connection verifies the exact advisory key in `pg_locks` and that its backend PID still matches acquisition.
- A missing lock, changed backend or failed connection refuses the write.
- This detects loss. It cannot prevent a backend failure after verification, or recall a provider-accepted message.

**Before sending, and after**

- Before sending, the attendee / override-holder erasure check still waits under attendee row locks.
- The delivery's status, `queued_at` revision and attempt count must match the cached snapshot.
- Retry and reclaim claims advance `queued_at` strictly, even with equal clock milliseconds, using a compare-and-set.
- Outcome writes compare revision and attempt count, and refuse emptied recipients.
- Cancellation can stop messages not yet handed to the provider. An already handed-off message cannot be recalled.
- A reclaimed revision discards the preceding revision's outcome.

This prevents competing local attempts while ownership is held. It does not provide exactly-once remote delivery after ambiguous provider acceptance, process failure or loss of the lock session.

## Snapshot retention

- Terminal deliveries keep frozen HTML/subject for retry and support.
- After 60 days (override with `EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS`), the Admitto **worker** (once at boot, then about every 24h), `admitto retention run` and `nullify-delivery-snapshots` clear `rendered_html` / `rendered_subject`, while preserving delivery log metadata. All three read the same variable.
- A failed row loses `retryable` at the same time, so it can no longer be retried.
- Selection and the atomic update both require a still-stale terminal snapshot. A reclaim to queued in between preserves its fresh body.
- The cleanup transaction also tries the same delivery advisory key and skips an in-flight sender. A locked batch does not prevent later rows from being cleared. Skipped rows are reconsidered on the next cleanup run.

## Tests

```bash
npm run db:test-setup   # from repo root
npm test -w @admitto/mail-delivery
```

The registration mail tests (`registration-mail-*.test.ts`) run two real transactions, each side first: an erasure that is open while the last check waits, and a send that is held open while an erasure runs.
