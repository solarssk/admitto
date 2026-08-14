# Logs and Audit

| Field | Value |
|---|---|
| **Audience** | Superadmins |
| **Required role** | Superadmin |
| **Feature status** | Available |
| **Last verified** | Admitto 0.4.13 |

## What this page helps you do

Use the three log views to investigate supported administration and sign-in problems.

## Before you start

Define the event, user, action, and approximate time you are investigating. Use the event timezone for event activity and the timestamps shown by each log view.

## Steps

1. Open **Organisation settings**, then **Logs**.
2. Switch between **System**, **Audit**, and **Security** with the shared view toggle (one panel, not three separate cards).
3. Use **System logs** for a near-real-time feed of recent application and subsystem messages (API, database, cache, mail, admin actions). This view keeps a bounded recent window and resets when the app restarts.
4. Use **Audit logs** for administration actions across settings and events. Rows can show severity badges, actor local time, event-scope filtering, and offline country for IP addresses.
5. Use **Security logs** for durable sign-in, MFA, OIDC, logout, and access-denied events retained in the database (default **30 days**, `SECURITY_AUDIT_LOG_RETENTION_DAYS`). Each row keeps the staff member's email and display name from the moment of the event, even if the account is later deleted.
6. Use **Live** / **Paused** on each view. If the connection degrades, Admitto shows a banner until you resume or refresh.
7. Apply search, action, event, and date filters before exporting.
8. Superadmins can **Export logs** (CSV) from Audit and Security. Copy or export only the minimum rows needed for the approved investigation.

## Expected result

The selected view shows a bounded, relevant sequence of events without requiring access to deployment consoles.

## Important decisions

- System logs are a recent operational view, not a permanent audit record. Their timestamps stay in **UTC** so every viewer sees the same instant and can match container or stdout logs.
- Audit and Security logs have different event types and filters. Security survives restarts; System does not.
- On Audit and Security, Time shows **UTC on top** and local time **on the line below**: **user** icon (Audit: the user's timezone when known) or **desktop** icon (Security: your browser timezone). Health check **Generated** is browser-local only.
- A missing row does not prove an action never happened if it is outside retention or the selected filters.
- Log exports can contain staff identifiers. Handle them as controlled operational data.

## What changes after this action

Viewing does not change product state. Exporting can create an audit entry and produces a file that must be stored and removed according to policy.

## Common problems

- **No rows appear:** clear filters and confirm the date range.
- **Live updates pause:** choose **Live** again or refresh the view.
- **The error needs infrastructure detail:** move to the approved technical incident process without copying secrets or attendee data.

## Related pages

- [Organisation Settings](Organisation-Settings)
- [Identity and SSO](Identity-and-SSO)
- [Technical Documentation](Technical-Documentation)
- [Help and Troubleshooting](Help-and-Troubleshooting)
