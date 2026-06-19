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

No special-category data (health, biometric, etc.) is processed.

## Data minimisation

Only fields required for ticketing and email delivery are imported. The token/QR
contains only a random, unguessable identifier — no name, email, or other PII.

## Legal basis

**Pending legal confirmation.** Likely candidates (to be validated internally):

- Legitimate interest (internal event management), or
- Consent obtained at registration.

## Logs

- Design goal: no full email addresses or names in routine application log lines.
- No secrets or tokens in logs.
- Audit output uses redacted identifiers where email is logged.

## Retention

Operational data (attendees, check-ins, email delivery records) should be deleted or
anonymised **30–60 days after the event**. Export before deletion if required for reporting.

| Mechanism | Status |
|-----------|--------|
| Policy documented | Yes (this document + GDPR one-pager) |
| Organizer export before purge | Available in admin UI |
| Automated purge job | Planned for a future release |

## Data subject rights

Attendees may have rights of access, rectification, and erasure under applicable law.
**Choose an operating model with legal** — both options are described in
[GDPR-ONE-PAGER.md](docs/GDPR-ONE-PAGER.md):

| Model | Summary |
|-------|---------|
| **Self-service API** | Dedicated export/delete endpoints — build if legal requires |
| **Organizer-mediated** | Staff export via admin UI; erasure via documented procedure |

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
