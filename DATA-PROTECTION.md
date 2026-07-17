# Data Protection Notes (GDPR)

> **Legal basis:** to be confirmed by your organisation's privacy officer or legal team. This
> document captures **design intent**, not legal advice.

**Corp pack:** [GDPR-ONE-PAGER.md](docs/GDPR-ONE-PAGER.md) ·
[SUBPROCESSORS.md](docs/SUBPROCESSORS.md) · [SECURITY-CONTROLS.md](docs/SECURITY-CONTROLS.md)

## Data processed

| Field | Purpose | Sensitivity |
|---|---|---|
| First name, last name | Personalised email, ticket display | Personal data |
| Email address | Ticket delivery, check-in lookup | Personal data |
| Company / department *(optional)* | Badge display | Personal data |
| Entry status | Check-in tracking | Operational |
| Random token / QR code | Ticket identifier — **no personal data embedded** | Non-personal |
| OIDC IdP group membership (`ExternalIdentity.groups`) | Role mapping at OIDC login | Personal data (access metadata) |
| `AttendeeActionLog.metadata` (admin audit trail) | Accountability — who changed an attendee's email/company/department/ticket type, from what, to what, and when | Personal data — see **Admin audit trail** below |
| `AdminAuditLog.metadata` for attendee create/erase (central audit log) | Security/incident-response — which attendee (name, email) was created or permanently erased, from which event, by whom | Personal data — see **Central admin audit log** below |

`AttendeeNote.body` is a free-text operator note. It may contain special-category data
(for example accessibility, dietary, or medical information) if staff enter it. Operators
must not record GDPR Art. 9 data unless their organisation has documented a lawful basis,
instructions from its privacy officer/DPO, and appropriate safeguards.

## Data minimisation

Only fields required for ticketing and email delivery are imported. The token/QR
contains only a random, unguessable identifier — no name, email, or other PII.

## Legal basis

**Pending legal confirmation.** Likely candidates (to be validated internally):

- Legitimate interest (internal event management) — **LIA may be required** for external guests, or
- Consent obtained at registration.

## Logs

- Design goal: no full email addresses or names in **routine application log lines** — stdout/
  stderr, error traces, and anything that could reach a third-party log aggregator.
- No secrets or tokens in logs.
- This does **not** apply to the admin audit trail (`AttendeeActionLog`), which is a first-class,
  access-controlled product feature, not an operational log line — see below.

## Admin audit trail (`AttendeeActionLog`)

Every admin action on an attendee (profile edit, check-in, pass revoke/restore, ticket resend,
import, etc.) writes a row here, shown to admins on the attendee's own Activity log tab. For a
fixed set of fields — currently email, company, department, ticket type — a profile edit also
records the before/after value (`metadata.field_changes`), not just which field changed, so an
admin can see what actually changed, not only that something did.

This is a deliberate accountability record (GDPR Art. 5(2)), not a "routine log line" the section
above is about:

- **Access:** admin-only, same access control as the rest of the attendee's data (no separate
  export or public surface).
- **Erasure:** `AttendeeActionLog.attendee_id` cascade-deletes with its `Attendee` row
  (`onDelete: Cascade` in the Prisma schema) — erasing an attendee via the existing DSAR delete
  flow removes every audit row referencing them, including any logged field values. No separate
  cleanup step needed.
- **Scope:** deliberately excludes `Attendee.name` and every `custom_data` field (dietary,
  accessibility, emergency contact, and other free-text attributes an event might collect) — an
  edit to any of those shows only the field name, never the value, since those can hold
  special-category data (GDPR Art. 9) a guest typed into a form field, which this fixed
  before/after list is not meant to capture. `ticket_type` is a catalog key, not free text.

## Central admin audit log (`AdminAuditLog`)

Separate from the per-attendee `AttendeeActionLog` above: a single, instance-wide, **superadmin-
only** table (Instance Settings → Audit log) that already records event/user/session/settings
actions. Attendee **creation** and **erasure** write here too, and — unlike the per-attendee log —
deliberately include the attendee's name and email in `metadata`, plus the event's title (not just
its opaque id).

This is a narrower, more deliberate exception than it looks:

- **Why erasure needs it:** the whole point of `AttendeeActionLog.attendee_id` cascading away with
  its `Attendee` row (see above) is that the per-attendee trail disappears too — which is correct
  for a legitimate DSAR erasure, but means there is otherwise **no record anywhere** of who was
  erased, from which event, or by whom. If an attacker compromises an admin session and mass-erases
  attendees, that is unrecoverable without this log. GDPR Art. 33/34 (breach notification to the
  supervisory authority and to affected individuals) require being able to identify who was
  affected — a design that erases that ability by construction cannot meet that duty.
- **Lawful basis:** Art. 6(1)(f) legitimate interest — security monitoring and incident response —
  scoped to this one admin-only log, not to the erasure action itself (the attendee's own data is
  still genuinely gone from every attendee-facing table and surface).
- **Access:** superadmin-only (`GET /api/admin/organizations`-tier gate), stricter than the
  admin-level access the per-attendee log gets.
- **Retention — operator-run, not automated (no scheduled purge job exists for this table):** the
  Retention table below already lists "IP addresses in admin audit log… operator, 30 days or your
  policy, product does not auto-purge" — the same applies to the name/email fields added here, and
  is worth being explicit about rather than assuming: run this after your chosen retention window
  elapses, scoped to just the fields this section is about (never truncate the whole table — that
  destroys the accountability record itself, defeating the point):

  ```sql
  -- Single-attendee actions: metadata.attendee_name / .attendee_email.
  UPDATE "AdminAuditLog"
  SET metadata = metadata - 'attendee_name' - 'attendee_email'
  WHERE action_type IN ('attendee_erased', 'attendee_created_manual')
    AND created_at < now() - interval '30 days';

  -- Bulk erasure: metadata.attendees is an array of {id, name, email} objects.
  UPDATE "AdminAuditLog"
  SET metadata = jsonb_set(metadata, '{attendees}', (
        SELECT jsonb_agg(a - 'name' - 'email')
        FROM jsonb_array_elements(metadata->'attendees') a
      ))
  WHERE action_type = 'attendees_bulk_erased'
    AND created_at < now() - interval '30 days';
  ```

  An automated version of this (or of the broader attendee-PII purge already listed below) is
  v1.0-planned work, not shipped today.

## Retention

Retention uses two responsibility layers: **product-automated** cleanup (best-effort at container
startup) and **operator-controlled** data (export/delete per your policy). Different retention
periods for different categories are intentional — not an inconsistency.

| Data | Who is responsible | How |
|---|---|---|
| Login sessions, trusted devices | Product — automatic | Best-effort purge at container startup when expired/revoked |
| Email bodies (`rendered_html`, `rendered_subject`) | Product — automatic | Nullified **60 days** after terminal delivery (`EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS`) |
| IP addresses in admin audit log and check-in history | Operator | **30 days or your corporate log retention policy** (whichever applies); product does not auto-purge |
| Event attendee list (PII) | Operator | Export via admin UI; erasure via **Attendees → attendee detail → More actions → Delete attendee** (single) or the Attendees list's row-selection bulk bar (multiple at once), or the `DELETE` API directly — see [DSAR-PROCEDURE.md](docs/DSAR-PROCEDURE.md) |

Automated post-event attendee purge is planned for **v1.0**. Until then, use **Attendees → Export**,
then erase records via the admin SPA (single or bulk) or `DELETE /api/admin/events/:eventId/attendees/:id`
directly, as described in [DSAR-PROCEDURE.md](docs/DSAR-PROCEDURE.md).

| Mechanism | Status |
|-----------|--------|
| Policy documented | Yes (this document + GDPR one-pager) |
| Organizer export before purge | Admin UI — **Attendees → Export** (CSV/XLSX/PDF; v0.4.2+) |
| Per-attendee erasure | Admin SPA (single and bulk) + `DELETE` API (v0.4.6+ API, SPA delete action added in this batch) |
| Automated purge job | Partial — auth-state and email delivery snapshot cleanup at container startup; full attendee PII purge planned for v1.0 |

## Data subject rights

Attendees may have rights of access, rectification, and erasure under applicable law.
**Choose an operating model with legal** — both options are described in
[GDPR-ONE-PAGER.md](docs/GDPR-ONE-PAGER.md):

| Model | Summary |
|-------|---------|
| **Self-service API** | Dedicated export/delete endpoints — build if legal requires |
| **Organizer-mediated** | Staff export via admin UI; erasure per [DSAR-PROCEDURE.md](docs/DSAR-PROCEDURE.md) |

## Subprocessors

Depends on customer configuration — hosting, corporate email (e.g. Microsoft 365 / Graph or SMTP
relay), optional CDN/WAF, optional future wallet provider. Template:
[SUBPROCESSORS.md](docs/SUBPROCESSORS.md).

## Hosting

- Target: customer-selected region (EU common for GDPR-oriented deployments).
- Secrets outside the repository (environment variables / secret manager).
- Database not exposed to the public internet.

See [CORPORATE-DEPLOYMENT.md](docs/CORPORATE-DEPLOYMENT.md).

## Before production use with real personal data

1. Legal confirms lawful basis and subprocessors (DPAs in place).
2. DSAR operating model agreed and documented internally.
3. Hosting meets organisational data protection requirements.
4. Deployment runbook records perimeter and identity choices.
