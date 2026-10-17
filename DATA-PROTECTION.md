# Data Protection Notes (GDPR)

> **Legal basis:** to be confirmed by your organisation's privacy officer or legal team. This
> document captures **design intent**, not legal advice.

**Corp pack:** [GDPR-ONE-PAGER.md](docs/security/GDPR-ONE-PAGER.md) ·
[SUBPROCESSORS.md](docs/security/SUBPROCESSORS.md) · [SECURITY-CONTROLS.md](docs/security/SECURITY-CONTROLS.md)

- [Data processed](#data-processed)
- [Data minimisation](#data-minimisation)
- [Legal basis](#legal-basis)
- [Logs](#logs)
- [System logs (live tail)](#system-logs-live-tail)
- [Durable security audit trail (`SecurityAuditLog`)](#durable-security-audit-trail-securityauditlog)
- [Admin audit trail (`AttendeeActionLog`)](#admin-audit-trail-attendeeactionlog)
- [Central admin audit log (`AdminAuditLog`)](#central-admin-audit-log-adminauditlog)
- [Redis](#redis)
  - [Rate-limit counters](#rate-limit-counters)
  - [Live check-in updates](#live-check-in-updates)
  - [Caches and pacing](#caches-and-pacing)
- [Retention](#retention)
  - [By data category](#by-data-category)
  - [Compliance checklist](#compliance-checklist)
- [Data subject rights](#data-subject-rights)
- [Subprocessors](#subprocessors)
- [Hosting](#hosting)
- [Before production use with real personal data](#before-production-use-with-real-personal-data)

## Data processed

| Field | Purpose | Sensitivity |
|---|---|---|
| First name, last name | Personalised email, ticket display | Personal data |
| Email address | Ticket delivery, check-in lookup | Personal data |
| Staff and operator accounts (`User`: email, display name, optional phone number, password hash, MFA enrolment) | Sign-in and accountability | Personal data (staff) |
| Login sessions (`Session`: IP address, user agent, device label, browser time zone; country and city are derived offline from the IP) | Active sessions list, new-location sign-in alerts, session revocation | Personal data (staff). The worker purges them when expired or revoked, see Retention |
| Company / department *(optional)* | Badge display | Personal data |
| Entry status | Check-in tracking | Operational |
| Random token / QR code | Ticket identifier. **No personal data embedded** | Non-personal |
| OIDC IdP group membership (`ExternalIdentity.groups`) | Role mapping at OIDC login | Personal data (access metadata) |
| `AttendeeActionLog.metadata` (admin audit trail) | Accountability: who changed an attendee's email, company, department or ticket type, from what, to what, and when | Personal data. See **Admin audit trail** below |
| `AdminAuditLog.metadata` for attendee creation (central audit log) | Security and incident response: which attendee (name, email) was added by hand, to which event, by whom | Personal data. See **Central admin audit log** below, and the note under this table |
| Wallet pass registration | Apple/Google Wallet ticket delivery, when Wallet is enabled | Personal data. See the note under this table and [SUBPROCESSORS.md](docs/security/SUBPROCESSORS.md) |
| `Attendee.custom_data` (event-specific custom fields, e.g. dietary, accessibility, shirt size, emergency contact) | Event-specific attendee data collection (Requirements page → Custom attendee fields), aggregated in Reports' **Custom fields** tab | Personal data. **May hold GDPR Art. 9 special-category data** if staff configure such a field. See **Admin audit trail** below for how edits to this field are (deliberately, only partially) audited |

**Central audit log, attendee creation**

- The name and email are blanked when that attendee is erased or removed.
- An erasure or a removal records ids, counts and (for a removal) a reason code, never a name or email.
- Entries written by the old hard delete still hold them.

**Wallet pass registration**

- Sent to PassCreator: the name and the event details.
- Stored locally: the provider pass ID, the download URL, per-platform device-registration counts, lifecycle timestamps (such as voided, expired and removed-from-provider), and the raw User-Agent of the device that opened the Add to Wallet link.
- The local record and its User-Agent stay until the attendee is erased or the pass is removed with **Delete wallet pass**.

`AttendeeNote.body` is a free-text operator note. It may contain special-category data
(for example accessibility, dietary, or medical information) if staff enter it. Operators
must not record GDPR Art. 9 data unless their organisation has documented a lawful basis,
instructions from its privacy officer/DPO, and appropriate safeguards.

## Data minimisation

Only fields required for ticketing and email delivery are imported. The token/QR
contains only a random, unguessable identifier - no name, email, or other PII.

## Legal basis

**Pending legal confirmation.** Likely candidates (to be validated internally):

- Legitimate interest (internal event management) - **LIA may be required** for external guests, or
- Consent obtained at registration.

## Logs

Design goal: no attendee names or email addresses in **routine application log lines** - stdout/
stderr, error traces, and anything that could reach a third-party log aggregator. No secrets or
tokens in logs, ever.

**Exception, by design.** A small, fixed set of staff and operator accountability events *do* log the
acting staff member's own full email address:

- A successful staff login
- A Cloudflare Access sign-in
- MFA break-glass use
- Admin actions such as archiving, deleting, or exporting an event

This identifies **who did an action**, for internal accountability. It uses the same
legitimate-interest basis already used for the admin audit trail below, not a new one.

**What stays redacted**

- The exception applies only to a **verified** identity. A **failed** login attempt is unauthenticated user input (it could be anyone typing an address, including an attacker), so its email is still shown redacted (e.g. `a***@example.com`).
- Attendee-facing data, such as a ticket email's recipient address or import file content, always stays redacted or minimised in these logs.
- Database query logs never include the actual query values, only the query shape and how long it took.

**The client IP in the access log**

- The per-request access log line (`http_request`, the source of the System-logs live tail below) includes the client IP for every request, staff or anonymous.
- The app already reads it for every ticket/QR/check-in request to key its rate limiter (`rate-limit/policies.ts`), so this surfaces data already being processed rather than adding a new category of it.
- It also matches standard access-log practice (Apache/nginx, ALB/CloudFront) plus OWASP's guidance to record source IP on security-relevant requests, chiefly to spot scanning or brute-forcing of ticket/QR tokens.
- Ticket/QR paths (`/t/*`, `/q/*`) are still logged as `/t/[redacted]` / `/q/[redacted]`. The raw token never reaches stdout.
- Alongside that, a short, one-way `ref` hash of the token is logged, so repeated hits on the same participant's link are recognizable across log lines without exposing it.
- Retention for this IP follows the same operator-managed convention as the reverse proxy's own access log (see the Retention table below). It is not auto-purged like `SecurityAuditLog`.

This does **not** apply to the admin audit trail (`AttendeeActionLog`, `AdminAuditLog`), which is a
first-class, access-controlled product feature, not an operational log line. See below.

**Client-error reports.** The admin/operator/account SPA's production client-error reports contain only one of five fixed
source categories (render, uncaught error, unhandled rejection, resource load or CSP violation).
The server rejects exception messages, names, stacks, page paths, URLs and other arbitrary fields
rather than writing them to stdout or System logs. Detailed client errors remain local in development.

## System logs (live tail)

A superadmin-only screen (Organisation settings → **Logs** → **System**) shows a short live tail of recent activity:

- API requests
- database queries
- cache and rate-limit events
- mail sends
- the admin actions mentioned above
- background worker job activity
- wallet (Apple/Google Wallet provider) operations
- outbound calls to external services (weather, maps/geocoding)

It is a **diagnostic convenience view, not a durability or compliance record**:

- It is **in-memory only**, holds at most the last 1000 entries per running server process, and is
  emptied whenever that process restarts.
- Everything shown here is also written to the container's own standard output at the same time -
  that is where long-term retention or forwarding to an external log system happens (see
  [docs/security/SECURITY-CONTROLS.md](docs/security/SECURITY-CONTROLS.md)'s "Known scope limits" - Admitto has no
  built-in SIEM or central log platform). **Exception:** login, MFA, logout, OIDC, and access-denied
  events are also written durably to the database - see **Durable security audit trail** below -
  so those sixteen event types survive a restart even without external log shipping.
- It follows the same redaction rules described in **Logs** above: attendee-facing data is never
  shown in full, and a staff member's email is shown in full only for the specific accountability
  events listed there.

## Durable security audit trail (`SecurityAuditLog`)

A superadmin-only screen (Organisation settings → **Logs** → **Security**, next to the **Audit** view) shows a durable, database-backed history of sixteen auth/security event types:

- login success / failure
- repeated-login-failure alerts
- MFA success / failure
- MFA break-glass override
- MFA recovery code use
- repeated-MFA-failure alerts
- new-country sign-in alert (an admin or superadmin signing in from a country not seen among their recent successful logins; the row stores the country code and, when the offline dataset resolves one, the city)
- superadmin bootstrap
- logout
- OIDC login success
- OIDC superadmin-revoke-blocked
- access-denied
- trusted-device creation / use (including when a "remember this device" cookie skips the two-factor step)

Unlike the System-logs live tail above, this table is not in-memory - it survives a container restart, so it is the reliable source for reconstructing login/MFA/OIDC history during an incident review.

- **Why:** before this, the same sixteen events only reached stdout (durability depends entirely on
  your own log shipping/rotation setup) and the 1000-entry live tail (wiped on every restart). This
  closes that gap independently of container/log configuration (issue #473).
- **Access:** superadmin-only, same gate as the central admin audit log below.
- **Fields:**
  - `event_type`
  - a resolved `user_id` when the subject is known (null for failed logins against a possibly-nonexistent account, an intentionally uniform, enumeration-safe shape)
  - immutable `user_email` / `user_display_name` snapshot columns written at event time (they survive hard delete of the account)
  - `ip`, a small `metadata` object, and `created_at`
  - Failed logins keep `user_id` and the snapshot columns null (enumeration-safe) and store the full attempted address in `metadata.email`, so superadmins can investigate targeted attacks. Older rows may still have `email_redacted` instead.
  - Authenticated events store the accountable staff identity in the snapshot columns, not in metadata.
  - Operational stdout / System-log still emit the redacted form for failed logins (see **Logs** above).
- **Not covered, by design:**
  - rate-limit-exceeded events (they span many unrelated features - a throttling signal, not itself a discrete auth incident; better served by metrics/alerting)
  - admin settings changes (already durable via the central `AdminAuditLog` below - no need to duplicate into both tables)
- **Retention - product-automated**, unlike the central admin audit log's operator-run retention below: purged after **30 days** by default (`SECURITY_AUDIT_LOG_RETENTION_DAYS`), consistent with this document's existing 30-day IP-address convention. See the Retention table below.

## Admin audit trail (`AttendeeActionLog`)

Every admin action on an attendee (profile edit, check-in, pass revoke/restore, ticket resend,
import, etc.) writes a row here, shown to admins on the attendee's own Activity log tab. For a
fixed set of fields - currently email, company, department, ticket type - a profile edit also
records the before/after value (`metadata.field_changes`), not just which field changed, so an
admin can see what actually changed, not only that something did.

This is a deliberate accountability record (GDPR Art. 5(2)), not a "routine log line" the section
above is about:

- **Access:** admin-only, same access control as the rest of the attendee's data (no separate
  export or public surface).
- **Erasure and removal.** An attendee's data ends in one of two ways:
  - *Erase personal data* (a privacy request) anonymises the entry in place.
  - *Remove from event* (a mistake: a duplicate, a test person, a wrong import file) deletes it.
  - Either way, every `AttendeeActionLog` row tied to the attendee is deleted, including any logged field values, and so are the notes. A removal does it with the `Attendee` row: `attendee_id` cascades (`onDelete: Cascade` in the Prisma schema).
  - A removal also deletes the email deliveries (including stored rendered mail), check-ins and wallet pass rows in the same transaction. What an erasure keeps and clears is listed in [attendee-erasure.md](docs/dev/attendee-erasure.md).
  - Admitto makes a best-effort call to delete the attendee's pass at the wallet provider (an erasure after its commit, a removal before it). A provider failure is logged and does not block either, so verify the provider side if it matters.
  - Each leaves one `attendee_erased` (bulk: `attendees_bulk_erased`) `AttendeeActionLog` row with no attendee link. It holds only the opaque attendee ids, the counts, the method (`erase` or `remove`) and, for a removal, a reason from a fixed list. It holds no free text, name or email, and neither does the central `AdminAuditLog` entry (see below).
- **IP address:** each row also stores the acting staff member's IP address (`ip`), session id and
  device id. This table is not purged by the worker; its rows (IP included) go when the attendee
  or the event is deleted.
- **Scope:** deliberately excludes `Attendee.name` and every `custom_data` field (dietary,
  accessibility, emergency contact, and other free-text attributes an event might collect) - an
  edit to any of those shows only the field name, never the value, since those can hold
  special-category data (GDPR Art. 9) a guest typed into a form field, which this fixed
  before/after list is not meant to capture. `ticket_type` is a catalog key, not free text.

## Central admin audit log (`AdminAuditLog`)

Separate from the per-attendee `AttendeeActionLog` above: a single, instance-wide, **superadmin-only** table (Organisation settings → Logs → **Audit**) that already records event/user/session/settings actions.

- Attendee **creation** writes here too. Unlike the per-attendee log, it deliberately includes the attendee's name and email in `metadata`, plus the event's title (not just its opaque id).
- An **erasure** or a **removal** (`attendee_erased` / `attendees_bulk_erased`, told apart by `metadata.method`) records the event, the attendee ids, the counts and, for a removal, a reason code, never a name or an email. It also blanks the name and email in that attendee's creation entry.

This is a narrower, more deliberate exception than it looks:

- **Why an erasure or a removal records ids only.**
  - The point of the action is that nothing which identifies the person stays, and an audit entry that kept their name would keep exactly that.
  - What the entry does record is who did it, when, from where, to which event and how many people. That is what a mass erasure by a compromised admin session leaves to investigate.
  - To learn who the ids were, use a database backup from before (14 days by default, see the Retention table below). If your breach-response process has to name the people, keep backups for as long as that process needs.
- **Who erased whom is read back on the attendee's page.**
  - The page of an erased attendee says who erased the person, when and through what: the staff member's name or address, the zone they were in, and the admin or the emergency command line. It is read from this log by the attendee id the entry holds.
  - A Superadmin, the only role that can read this log, also sees the address the request came from and where it is. The rest of the staff get neither, and the command line's placeholder address is never sent.
  - This is the staff member's own data, kept for accountability on the basis below. Nothing about the erased person is added to it or read from it beyond the id.
- **Why creation records identity:** it is the one entry that says who added whom by hand. It is
  blanked together with the person's data when they are erased or removed.
- **Lawful basis:** Art. 6(1)(f) legitimate interest - security monitoring and incident response -
  scoped to this one admin-only log.
- **Access:** superadmin-only (`GET /api/admin/organizations`-tier gate), stricter than the
  admin-level access the per-attendee log gets.
- **Actor identity:** each row stores immutable `actor_email` / `actor_display_name` snapshot columns
  at write time (alongside `actor_user_id`), so deleted staff accounts remain identifiable in the
  audit trail for the table's retention window.
- **Retention is operator-run, not automated.** No scheduled purge job exists for this table.
  - The Retention table below already lists "IP addresses in admin audit log… operator, 30 days or your policy, product does not auto-purge". The same applies to the name and email fields of creation entries, and of the entries the old hard delete wrote before Erase and Remove were separate.
  - Be explicit about this rather than assuming. Run the SQL below after your chosen retention window elapses. It is scoped to just the fields this section is about. Never truncate the whole table: that destroys the accountability record itself, defeating the point.

  ```sql
  -- Single-attendee actions: metadata.attendee_name / .attendee_email.
  UPDATE "AdminAuditLog"
  SET metadata = metadata - 'attendee_name' - 'attendee_email'
  WHERE action_type IN ('attendee_erased', 'attendee_created_manual')
    AND created_at < now() - interval '30 days';

  -- Bulk erasure by the old hard delete: metadata.attendees is an array of {id, name, email} objects.
  UPDATE "AdminAuditLog"
  SET metadata = jsonb_set(metadata, '{attendees}', (
        SELECT jsonb_agg(a - 'name' - 'email')
        FROM jsonb_array_elements(metadata->'attendees') a
      ))
  WHERE action_type = 'attendees_bulk_erased'
    AND created_at < now() - interval '30 days';
  ```

  An automated version of this (or of the broader attendee-PII purge already listed below) is
  planned, not shipped today.

## Redis

Redis is used for rate-limit counters, live updates between the worker and the app, small caches and the pacing of wallet provider calls (see [CORPORATE-DEPLOYMENT.md](docs/security/CORPORATE-DEPLOYMENT.md)). Sessions are stored in PostgreSQL, not in Redis.

Two of these relate to people: the rate-limit counters and the live check-in updates. The caches and the pacing hold no attendee or staff data.

### Rate-limit counters

Each counter is one key. Its name starts with `rl:`, then the limit and who it counts, and ends with the start of the window. For example: `rl:admin:resend:user:<user id>:attendee:<attendee id>:<window start>`.

The key name is where people show up. Anyone who can read your Redis (a `KEYS` command, a snapshot, a backup, a replica) can read it too, so keep Redis private and password-protected.

These identifiers appear in key names:

| Identifier | In which limits |
|---|---|
| E-mail address, trimmed and in lower case | Password sign-in only, as `auth:login:email:<e-mail>`. The key exists for every address typed with a password, whether or not an account has it. |
| IP address | Most limits, also for visitors who are not signed in (sign-in, public ticket pages, health endpoints, webhooks). On the public ticket pages the key is the IP address alone. |
| Staff user id | Limits on a signed-in staff member, as `user:<id>`: admin actions, check-in, MFA, password re-checks and the notification bell |
| Sign-in session id | The MFA limits, as `session:<id>`. This is the id of the session row in PostgreSQL, not the secret in the cookie. |
| Attendee id | Resending an attendee's e-mail (`admin:resend`) and editing an attendee (`admin:attendee-patch`) |
| Event id | Many admin limits, the live check-in stream and the wallet provider's webhook |
| Other ids | The sign-in provider being edited or tested (`admin:oidc-provider-ops`) and the staff member whose sessions are revoked (`admin:user-revoke-sessions`) |
| Keyed hash of a recipient address | The test-mail limit, as `mail:test-recipient:<hash>`. The hash is HMAC-SHA-256 with the encryption key, so the address itself is not in Redis. |

The ids are ids from your database. One id alone names nobody; only your PostgreSQL maps it to a person.

A counter lives until the end of its window, never longer. With the default settings the windows are:

| Window | Limits |
|---|---|
| 60 seconds | Sign-in, account, public ticket pages, check-in, health endpoints, webhooks and most admin limits |
| 10 minutes | Wallet messages, bulk wallet actions and bulk resend |
| 15 minutes | All MFA limits: code, recovery code, passkey or security key, step-up total and enrolment |
| 1 hour | Test mail and mail transport tests (the second, hourly limit), exports, resend per staff member and test mail per recipient |

`RATE_LIMIT_OVERRIDES` can change a window, and `CHECKIN_STREAM_*` can change the window of the live check-in stream.

### Live check-in updates

Each event has its own channel, named `admitto:sse:<event id>`. A check-in puts this on the channel: the attendee's name and id, the ticket type, the time, the operator's id and the device label. Other changes (a mail sent, an import finished) send only a signal with no data.

Redis hands each message to the processes that are subscribed at that moment and forgets it, so nothing is kept. The app sends check-ins through Redis only when `REDIS_URL` points to the bundled `redis` service, to `localhost` or to a `127.x.x.x` address, or uses TLS (`rediss://`). With a plain `redis://` URL to any other host it keeps the updates inside its own process.

### Caches and pacing

These hold no attendee or staff data:

| What | What it holds | How long |
|---|---|---|
| Venue search | The text typed into the venue search (in lower case), usually a venue name or address, or the rounded position of a map pin, and the places found. It is not tied to who typed it. | 30 days, 1 day when nothing was found |
| Map images | The map picture of an event's venue, under a hash of the event id, the position and the map settings | 30 days |
| Weather | The forecast for a day at the rounded position of a venue | 6 hours with the default settings (`WEATHER_CACHE_TTL_MS`) |
| Wallet provider pacing | A counter per second for the calls to PassCreator | 1 second |
| Map settings signal | A message that tells the other processes to read the map settings again | Not kept |

## Retention

Retention uses two responsibility layers: **product-automated** cleanup (best-effort on the Admitto
**worker** at boot and about every 24 hours) and **operator-controlled** data (export/delete per your
policy). Different retention periods for different categories are intentional - not an inconsistency.

### By data category

| Data | Who is responsible | How |
|---|---|---|
| Login sessions, trusted devices | Product - automatic | Best-effort purge on the worker when expired/revoked |
| Email bodies (`rendered_html`, `rendered_subject`) | Product - automatic | Nullified **60 days** after terminal delivery by default; `EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS` overrides it for the worker, `admitto retention run` and `nullify-delivery-snapshots` |
| Files that jobs leave in storage: the file of an attendee export (CSV, XLSX or PDF) and the staged CSV of an import job that failed | Product - automatic | The worker (boot + ~24h) and `admitto retention run` delete an export file **7 days** after the export finished (`EXPORT_FILE_RETENTION_DAYS`) and the staged CSV of a finished import job **7 days** after it finished (`IMPORT_STAGED_FILE_RETENTION_DAYS`). The job's own row (counts, filename) stays. More detail under the table |
| Durable security audit trail (`SecurityAuditLog` - login/MFA/logout/OIDC/access-denied) | Product - automatic | Best-effort purge on the worker (boot + ~24h); default **30 days** (`SECURITY_AUDIT_LOG_RETENTION_DAYS`) |
| In-app security alert inbox (`Notification` - a personal copy of alerts like "your password changed", shown via My Account's own notification bell; the underlying event is separately durable in `SecurityAuditLog` above regardless of this table) | Operator (primary) / Product (fallback) | A staff member can permanently clear their own notification history at any time (My Account's bell → **Clear all**); anything never cleared is auto-purged by the worker (boot + ~24h), default **30 days** (`NOTIFICATION_RETENTION_DAYS`) |
| IP addresses in admin audit log and the `http_request` access log (every request, staff or anonymous) | Operator | **30 days or your corporate log retention policy** (whichever applies); product does not auto-purge. (An IP logged this way is never itself persisted in a purgeable table - it lives in the System logs live tail below (in-memory only) and wherever your container log driver keeps stdout.) |
| Wallet pass at the provider (PassCreator) | Operator | Stays at the provider after the event, even once voided or expired, until you remove it (the ways are listed under the table) |
| Rate-limit counters and live check-in updates in Redis | Product - automatic | Each counter expires at the end of its window: 60 seconds for most limits and up to 1 hour for the longest ones with the default settings. Live updates are not kept after they are delivered. See [Redis](#redis) |
| System logs live tail (in-memory only) | Product - automatic | Not persisted anywhere by the product; the last 1000 entries are kept in server memory and gone on the next restart. Long-term retention, if you need it, is whatever your container log driver already does with stdout |
| Event attendee list (PII) | Operator | Export via the admin UI; erase or remove as described under the table, see [DSAR-PROCEDURE.md](docs/security/DSAR-PROCEDURE.md) |

**Files that jobs leave in storage: more detail**

- Erasing or removing an attendee also deletes every export file of that event and the staged CSV of every finished import at once, whatever their age.
- It also stops an export or an import that is waiting or running, so that the file an export is still building cannot appear afterwards and an import cannot add the person back.
- The file deletes are best effort: a file that cannot be deleted is reported in the System logs and left to the retention run.
- The same runs also delete a file that no job names, such as one left when a process was killed while it was being written, once it is a day old. A person erased meanwhile stays in it until then.
- Deleting an event for good deletes every file its jobs left. This is best effort too: a file that cannot be deleted is reported in the System logs with its key, since no job row is left to retry from.

**Removing a wallet pass at the provider.** The pass stays there until you do one of these:

- run **Attendees → More actions → Remove inactive passes**
- use **Remove from provider** on the attendee
- use **Delete wallet pass** (which also deletes the pass at the provider and the local record)
- erase the attendee (the delete is tried when the erasure commits, and again by the worker's retention run about once a day for as long as it fails)

**The attendee list (personal data)**

- Export via the admin UI.
- Erasure: **Attendees → attendee detail → More actions → Erase personal data** (single), the Attendees list's row-selection bulk bar (several at once), the erase API directly, or `attendees erase` in the emergency CLI when the UI is unreachable.
- A mistake (duplicate, test person) is taken out with **Remove from event** in the same places.

An automated post-event attendee purge is planned; until then, export and erasure for the
attendee list stay manual (see the table row above).

### Compliance checklist

A condensed yes/no view of the same retention story, for mapping against an external compliance
framework:

| Mechanism | Status |
|-----------|--------|
| Policy documented | Yes (this document + GDPR one-pager) |
| Organizer export before purge | Admin UI - **Attendees → Export** (CSV/XLSX/PDF) |
| Per-attendee erasure | Admin SPA (single and bulk): **Erase personal data** (anonymises the entry, Reports keep their numbers) and **Remove from event** (deletes the entry, for mistakes); each has an API endpoint for one attendee and one for a selection |
| Automated purge job | Partial - auth-state, email delivery snapshot and export/import file cleanup on the Admitto worker; full attendee PII purge planned |

**Import and export job failures**

- They store fixed categories, and their status and history APIs suppress unknown historical error text.
- Earlier raw exceptions may still be present in `AdminJob.error` and database backups. Attendee erasure does not remove those historical values.
- Assess their minimization under the instance DSAR policy before a separately reviewed cleanup. Nothing deletes job history automatically.
- See [Job failure privacy](docs/dev/attendee-erasure.md#job-failure-privacy).

## Data subject rights

Attendees may have rights of access, rectification, and erasure under applicable law.
**Choose an operating model with legal** - both options are described in
[GDPR-ONE-PAGER.md](docs/security/GDPR-ONE-PAGER.md):

| Model | Summary |
|-------|---------|
| **Self-service API** | Dedicated export/delete endpoints - build if legal requires |
| **Organizer-mediated** | Staff export via admin UI; erasure per [DSAR-PROCEDURE.md](docs/security/DSAR-PROCEDURE.md) |

## Subprocessors

The subprocessors depend on your configuration:

- hosting
- corporate email (for example Microsoft 365 / Graph, or an SMTP relay)
- optional CDN/WAF
- optional geocoding (Nominatim) and weather (MET Norway or Open-Meteo) lookups. These send venue coordinates or search text and a User-Agent carrying the instance's Support contact, but never attendee data.
- when Wallet is enabled, the configured wallet pass provider (PassCreator, for Apple/Google Wallet)

Template: [SUBPROCESSORS.md](docs/security/SUBPROCESSORS.md).

## Hosting

- Target: a region you choose (EU is common for GDPR-oriented deployments).
- Secrets outside the repository (environment variables / secret manager).
- Database not exposed to the public internet.

See [CORPORATE-DEPLOYMENT.md](docs/security/CORPORATE-DEPLOYMENT.md).

## Before production use with real personal data

1. Legal confirms lawful basis and subprocessors (DPAs in place).
2. DSAR operating model agreed and documented internally.
3. Hosting meets organisational data protection requirements.
4. Deployment runbook records perimeter and identity choices.
