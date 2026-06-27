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

- Design goal: no full email addresses or names in routine application log lines.
- No secrets or tokens in logs.
- Audit output uses redacted identifiers where email is logged.

## Retention

Retention uses two responsibility layers: **product-automated** cleanup (best-effort at container
startup) and **operator-controlled** data (export/delete per your policy). Different retention
periods for different categories are intentional — not an inconsistency.

| Data | Who is responsible | How |
|---|---|---|
| Login sessions, trusted devices | Product — automatic | Best-effort purge at container startup when expired/revoked |
| Email bodies (`rendered_html`, `rendered_subject`) | Product — automatic | Nullified **60 days** after terminal delivery (`EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS`) |
| IP addresses in admin audit log and check-in history | Operator | **30 days or your corporate log retention policy** (whichever applies); product does not auto-purge |
| Event attendee list (PII) | Operator | Manual export then delete via admin UI |

Automated post-event attendee purge is planned for **v1.0**. Until then, use **Attendees → Export**,
then delete records per your retention policy. Single-attendee erasure:
`DELETE /api/admin/events/:eventId/attendees/:id` (see [DSAR-PROCEDURE.md](docs/DSAR-PROCEDURE.md)).

| Mechanism | Status |
|-----------|--------|
| Policy documented | Yes (this document + GDPR one-pager) |
| Organizer export before purge | Admin UI — **Attendees → Export** (CSV/XLSX/PDF; v0.4.2+) |
| Per-attendee erasure | Admin UI / `DELETE` API (v0.4.6+) |
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
