# Superadmin Quick Start

| | |
|---|---|
| **Audience** | Superadmins |
| **Required role** | Superadmin |
| **Feature status** | Available |
| **Last verified** | Admitto 0.4.13 |

## What this page helps you do

Orient yourself in instance-wide administration and choose the correct scope for a supported change.

## Before you start

Sign in with your own Superadmin account and complete the security steps shown by Admitto. Use synthetic users and events for tests. Obtain secrets through the approved secure process, never through this Wiki or a public issue.

## Steps

1. Confirm the organisation and first administrator before handing over event work.
2. Use **Organisations** for organisation details and limits.
3. Use **Users & roles** for staff users, role assignments, and **Active sessions** (sessions are no longer under Organisation settings → Security).
4. Use **Organisation settings** for supported general, branding, mail, security, archiving, identity, log, and **Health check** settings. Health check groups Core infrastructure vs External integrations, can **Run live checks**, and can **Copy for GitHub Issue** / **Export** a sanitized snapshot.
5. Use the topbar **System status** and **Account** menus for a quick glance at connection/mailer state and My account / Sign out.
6. Use organisation settings for configuration that belongs to one organisation.
7. Use event settings for event-specific overrides and lifecycle actions.
8. Verify every material change with a synthetic account or test event.
9. Review the relevant audit, system, or security log view when the change requires confirmation.

## Expected result

Each change is made at the narrowest correct scope, and organisation administrators and operators receive only the access needed for their work.

## Important decisions

- Superadmin is an instance-level role. Organisation Admin and Operator assignments are scoped more narrowly.
- Prefer organisation defaults over event overrides unless the event has a real separate requirement.
- Mail, identity, security, and archiving changes can affect many users. Test before relying on them.
- Deployment, incident response, privacy requests, and architecture belong in the repository documentation, not the user Wiki.

## What changes after this action

Depending on scope, a change can affect the entire instance, one organisation, one event, or one user's access. Role and identity changes can change what a user sees at their next authorised session.

## Common problems

- **A manager cannot see an event:** review organisation and event role scope instead of sharing an account.
- **An event uses the wrong mail transport:** check whether it has an event-specific override.
- **An identity test fails:** keep the existing access path available and review the safe validation error.
- **An event is unexpectedly read-only:** check whether it is archived.

## Related pages

- [Organisation Administration](Organisation-Administration)
- [Users and Roles Administration](Users-and-Roles-Administration)
- [Organisation Settings](Organisation-Settings)
- [Mail Delivery Administration](Mail-Delivery-Administration)
- [Identity and SSO](Identity-and-SSO)
- [Logs and Audit](Logs-and-Audit)
- [Technical Documentation](Technical-Documentation)
