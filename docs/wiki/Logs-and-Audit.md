# Logs and Audit

> **Audience:** Superadmins
> **Required role:** Superadmin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Use the three log views to investigate supported administration and sign-in problems.

## Before you start

Define the event, user, action, and approximate time you are investigating. Use the event timezone for event activity and the timestamps shown by each log view.

## Steps

1. Open **Organisation settings**, then **Logs**.
2. Use **System logs** for recent application health and subsystem messages.
3. Use **Audit logs** for administration actions across settings and events.
4. Use **Security logs** for sign-in, MFA, OIDC, logout, and access-denied events.
5. Apply search, action, event, and date filters before exporting.
6. Copy or export only the minimum rows needed for the approved investigation.

## Expected result

The selected view shows a bounded, relevant sequence of events without requiring access to deployment consoles.

## Important decisions

- System logs are a recent operational view, not a permanent audit record. Their timestamps stay in **UTC** so every viewer sees the same instant and can match container or stdout logs.
- Audit and security logs have different event types and filters.
- On Audit and Security, Time shows **UTC on top** and local time **on the line below**: **user** icon (Audit: the user's timezone when known) or **desktop** icon (Security: your browser timezone). Health check **Generated** is browser-local only.
- A missing row does not prove an action never happened if it is outside retention or the selected filters.
- Log exports can contain staff identifiers. Handle them as controlled operational data.

## What changes after this action

Viewing does not change product state. Exporting can create an audit entry and produces a file that must be stored and removed according to policy.

## Common problems

- **No rows appear:** clear filters and confirm the date range.
- **Live updates pause:** resume the view or refresh it.
- **The error needs infrastructure detail:** move to the approved technical incident process without copying secrets or attendee data.

## Related pages

- [Organisation Settings](Organisation-Settings)
- [Identity and SSO](Identity-and-SSO)
- [Technical Documentation](Technical-Documentation)
