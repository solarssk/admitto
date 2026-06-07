# Data Protection Notes (GDPR)

> **TODO:** Confirm the legal basis with your DPO / legal team before processing real
> personal data in production. This document captures design intent, not legal advice.

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

**TODO:** Confirm with DPO / legal. Likely candidates:
- Legitimate interest (internal event management), or
- Consent obtained at registration.

## Logs

- No PII in application logs (no full email addresses, no names in log lines).
- No secrets or tokens in logs.

## Retention

Operational data (attendees, check-ins, email delivery records) should be deleted or
anonymised 30–60 days after the event. Export before deletion if required for reporting.

**TODO:** implement attendee export + delete endpoint before production use.

## Data subject rights

Attendees have the right to access, rectify, and erase their data.

**TODO:** implement export and deletion endpoints before production use.

## Hosting

- Target hosting: EU region.
- Secrets stored outside the repository (environment variables / secret manager).
- Database not exposed to the public internet.

## Shadow-IT note

This is an internal tool under development. **Do not process real personal data until:**

1. Legal basis is confirmed with DPO / legal.
2. Export and deletion endpoints are implemented and tested.
3. Hosting environment meets your organisation's data protection requirements.
