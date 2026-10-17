# Superadmin Quick Start

**Audience:** Superadmins · **Required role:** Superadmin · **Feature status:** ✅ Available · **Last verified:** Admitto 0.5.4

## What this page helps you do

Orient yourself in instance-wide administration and choose the correct scope for a supported change.

## Before you start

Sign in with your own Superadmin account and complete the security steps shown by Admitto. Use synthetic users and events for tests. Obtain secrets through the approved secure process, never through this Wiki or a public issue.

## Steps

1. Confirm the organisation and first administrator before handing over event work.
2. Use **Organisations** for organisation details and limits.
3. Use **Users & roles** for staff users, role assignments, and **Active sessions**.
4. Use **Organisation settings** for supported general, branding, mail, security, archiving, identity, log, and **Health check** settings.
   - **Health check** groups Core infrastructure and External integrations.
   - It can **Run live checks**.
   - It can **Copy for GitHub Issue** or **Export** a sanitized snapshot.
5. Use the topbar **System status** and **Account** menus for a quick glance at connection, mailer and background-worker state, and for My account and Sign out.
   - While the checks are still being read, System status says **Checking systems…**. It says **All systems normal** only once every check has answered.
   - If the checks do not answer within 30 seconds, the rows say **Unavailable** and the menu offers **Check again**. It also asks again by itself every 30 seconds.
   - A degraded or down row there points at the same **Health check** tab (step 4) for the full picture and the next step.
6. Use organisation settings for configuration that belongs to one organisation.
7. Use event settings for event-specific overrides and lifecycle actions, including Event settings → Wallet, a Superadmin-only area for configuring Apple/Google Wallet passes (PassCreator).
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

| Problem | What it means and what to do |
|---------|------------------------------|
| **A manager cannot see an event** | Review organisation and event role scope instead of sharing an account |
| **An event uses the wrong mail transport** | Check whether it has an event-specific override |
| **An identity test fails** | Keep the existing access path available and review the safe validation error |
| **An event is unexpectedly read-only** | Check whether it is archived |

## Related pages

- [Organisation Administration](Organisation-Administration)
- [Users and Roles Administration](Users-and-Roles-Administration)
- [Organisation Settings](Organisation-Settings)
- [Wallet Passes - PassCreator Template Setup](Wallet-Passes-PassCreator-Setup)
- [Mail Delivery Administration](Mail-Delivery-Administration)
- [Identity and SSO](Identity-and-SSO)
- [Logs and Audit](Logs-and-Audit)
- [Technical Documentation](Technical-Documentation)
