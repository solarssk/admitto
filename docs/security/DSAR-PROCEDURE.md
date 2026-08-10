# Data Subject Access and Erasure — Organizer-Mediated Procedure (Option B)

Template for deployments that **do not** use self-service DSAR APIs. Adapt to your organisation's
privacy policy and legal sign-off. **Not legal advice.**

See also: [GDPR-ONE-PAGER.md](GDPR-ONE-PAGER.md) (Option B).

---

## Process overview

```mermaid
flowchart TD
    A([Request received]) --> B[Record date + identity claim\nAcknowledge within 1 business day]
    B --> C{Identity verified?}
    C -- No --> D[Request proof\nDecline to disclose]
    C -- Yes --> E{Access or erasure?}
    E -- Access --> F[Admin exports attendee row\nAdmin → Attendees → Export]
    F --> G[Deliver via secure channel]
    E -- Erasure --> H{Legal confirms erasure\nno retention exception?}
    H -- No --> I[Explain retention exception\nDocument decision]
    H -- Yes --> J[DELETE attendee via admin API\nper DSAR procedure]
    J --> K([Document completion date\n+ responsible person])
    G --> K
```

---

## 1. Intake

- Request arrives (email, helpdesk, in person) → record **date received**, requester identity, event.
- Privacy officer or designated organizer acknowledges receipt within **one business day**.

## 2. Verify identity

- Match requester to an attendee record (email, ticket reference, or ID checked by organizer).
- If identity cannot be verified, do not disclose data; explain what proof is required.

## 3. Access (export)

- Organizer with `admin` role exports the attendee row via **Admin → Attendees → Export**
  (CSV/XLSX/PDF, filtered to the data subject if needed).
- Deliver export through your organisation's **secure channel** (encrypted mail, ticket system).
- Log: who exported, when, which event — use your internal audit process.

## 4. Erasure

- After legal confirms erasure is required and no retention exception applies:
  1. Delete the attendee record from **Admin → Attendees → attendee detail → More actions →
     Delete attendee** (type the attendee's name to confirm), or for multiple data subjects at
     once, select their rows on the **Attendees** list and use the bulk bar's **More actions →
     Delete** (10-second arm delay before the confirm button unlocks, no typed confirmation since
     there's no single name to type). Both call the same `DELETE`/`bulk-delete`
     `/api/admin/events/:eventId/attendees/...` endpoints used by the API client below — they
     remove dependent delivery, wallet, and check-in rows in one transaction and write an audit
     log entry (per-attendee, plus a central admin-audit-log entry naming the erased attendee(s)
     and event — see [DATA-PROTECTION.md](../../DATA-PROTECTION.md#central-admin-audit-log-adminauditlog)
     for why that one retains identity, unlike the per-attendee trail). Not blocked by the event
     being archived. If the SPA is unavailable, call the endpoint directly with an authenticated
     staff session and CSRF token (same session model as other admin mutations).
  2. Remove copies from local exports, mail logs, and backup retention per your backup policy.
- Document completion date and responsible person.

### Manual DB erasure (fallback)

If the API is unavailable, operators may erase by direct database operation. Dependent rows must be
removed before the attendee because `EmailDelivery`, `WalletPass`, and `CheckIn` reference attendees
with `ON DELETE RESTRICT`. Sent delivery rows can include rendered ticket email HTML.

**This bypasses both audit writers the API path uses** (the per-attendee `AttendeeActionLog` entry
and the central `AdminAuditLog` entry — see
[DATA-PROTECTION.md](../../DATA-PROTECTION.md#central-admin-audit-log-adminauditlog)) — a manual
erasure with no central audit record is exactly the accountability gap that log exists to close.
The `INSERT` below writes the same central record by hand; do not skip it. Capture the attendee's
name/email and the event's title *before* the delete (the `SELECT` in the transaction does this),
and know your own `user_id` (`SELECT id FROM "User" WHERE email = '...'`) and the event's
`organization_id` beforehand.

Run the operation in one transaction and scope it to the event and attendee:

```sql
BEGIN;

-- Replace values before execution.
\set event_id 'evt_...'
\set attendee_id 'att_...'
\set actor_user_id 'usr_...'

-- Snapshot identity for the audit record before it's gone.
SELECT id, name, email FROM "Attendee" WHERE id = :'attendee_id' AND event_id = :'event_id';
SELECT organization_id, title FROM "Event" WHERE id = :'event_id';

DELETE FROM "EmailDelivery"
WHERE "event_id" = :'event_id'
  AND "attendee_id" = :'attendee_id';

DELETE FROM "WalletPass"
WHERE "attendee_id" = :'attendee_id';

DELETE FROM "CheckIn"
WHERE "event_id" = :'event_id'
  AND "attendee_id" = :'attendee_id';

DELETE FROM "Attendee"
WHERE "event_id" = :'event_id'
  AND "id" = :'attendee_id';

-- Central accountability record — fill in the values from the two SELECTs above.
INSERT INTO "AdminAuditLog" (id, organization_id, actor_user_id, action_type, metadata, created_at)
VALUES (
  gen_random_uuid()::text,
  '<organization_id from the Event SELECT>',
  :'actor_user_id',
  'attendee_erased',
  jsonb_build_object(
    'event_id', :'event_id',
    'event_title', '<title from the Event SELECT>',
    'attendee_id', :'attendee_id',
    'attendee_name', '<name from the Attendee SELECT>',
    'attendee_email', '<email from the Attendee SELECT>'
  ),
  now()
);

COMMIT;
```

If the final `DELETE FROM "Attendee"` affects zero rows, roll back and re-check the event/attendee
ids before recording completion.

## 5. SLA (customer-defined)

| Step | Suggested target |
|------|------------------|
| Acknowledge request | 1 business day |
| Fulfill access / erasure | Per applicable law (e.g. **one month** under GDPR Art. 12(3); shorten internally if policy requires) |

---

## Related documents

- [GDPR-ONE-PAGER.md](GDPR-ONE-PAGER.md)
- [DATA-PROTECTION.md](../../DATA-PROTECTION.md)
- [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md)
