# Organisation Settings

> **Audience:** Superadmins
> **Required role:** Superadmin
> **Feature status:** Available
> **Last verified:** Admitto Unreleased

## What this page helps you do

Use the supported instance settings without confusing them with event-level settings.

Admitto shows this area as **Organisation settings**. These settings are available only to Superadmins, and some of them affect the whole instance.

## Before you start

Use a named Superadmin account, record the intended change, and prepare a synthetic test account or event.

## Steps

1. Open **Organisation settings**.
2. Use **General** for instance behaviour and base configuration shown by the panel.
3. Use **Branding** for organisation name, logo, colours, and supported fonts. Uploading a logo opens an adjust popup so you can trim margins before saving; transparent PNG/WebP keep their transparency. **Edit image** restores the last crop and zoom after Save and reload (Admitto keeps the full upload for re-edit). Organisation logos uploaded before crop persistence need one full-file upload the first time you re-crop; later crop and zoom edits restore from that saved original. External web-link logos cannot be re-cropped in Admitto.
4. Use **Mail** for the organisation-wide transport.
5. Use **Security** for MFA and session policy. Review or revoke active sessions from **Users & roles** instead.
6. Use **Archiving** for retention and completed-event controls.
7. Use **Identity** for OIDC providers and Cloudflare Access.
8. Use **Logs** to review system, administration, and security activity.
9. Use **Health check** to review Core infrastructure and External integrations status. External rows are labelled **role, provider** (for example `Address lookup, Nominatim` and `Map tiles, OpenStreetMap`). Each configured identity provider appears as its own row; Cloudflare Access is listed separately. Expand a row for diagnostics such as latency or endpoint host (no secrets). Use **Run live checks** only when you need an on-demand probe of address lookup, identity providers, or Cloudflare Access. **Copy for GitHub Issue** / **Export** produce a sanitized Markdown snapshot (no secrets or instance URL in the dump).
10. Save one area at a time and verify the visible result.

## Expected result

The selected setting is saved, an audit record is created where supported, and the test confirms the intended behaviour.

## Important decisions

- Organisation settings can affect every organisation or staff login.
- Environment-locked values are read-only in the UI and cannot be overridden there.
- Event-specific mail settings can override the organisation transport for that event.
- Deployment and emergency recovery are not UI tasks; use the technical documentation.

## What changes after this action

The change can affect future sessions, messages, branding, archiving, or logs depending on the panel. Existing sessions or sent messages are not automatically rewritten unless the UI says so.

## Common problems

- **A field is locked:** it is controlled outside the UI; follow the approved deployment process.
- **A save succeeds but behaviour is unchanged:** verify the correct scope and whether an event override exists.
- **A security change blocks a test user:** restore access with another authorised Superadmin, not a shared account.

## Related pages

- [Superadmin Quick Start](Superadmin-Quick-Start)
- [Mail Delivery Administration](Mail-Delivery-Administration)
- [Identity and SSO](Identity-and-SSO)
- [Logs and Audit](Logs-and-Audit)
- [Technical Documentation](Technical-Documentation)
