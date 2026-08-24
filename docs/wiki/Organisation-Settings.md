# Organisation Settings

**Audience:** Superadmins · **Required role:** Superadmin · **Feature status:** ✅ Available · **Last verified:** Admitto 0.5.0

## What this page helps you do

Use the supported instance settings without confusing them with event-level settings.

Admitto shows this area as **Organisation settings**. These settings are available only to Superadmins, and some of them affect the whole instance.

## Before you start

Use a named Superadmin account, record the intended change, and prepare a synthetic test account or event.

## Steps

1. Open **Organisation settings**.
2. Use **General** for instance behaviour and base configuration shown by the panel, including **Support contact** (used in the User-Agent for Nominatim and MET Norway requests).
3. Use **Branding** as the single consolidated tab for organisation name, logo (crop before upload), colour palette, built-in fonts, and custom font uploads, with one shared Save/Reset. Uploading a logo opens an adjust popup so you can trim margins before saving; transparent PNG/WebP keep their transparency. **Edit image** restores the last crop and zoom after Save and reload (Admitto keeps the full upload for re-edit). Organisation logos uploaded before crop persistence need one full-file upload the first time you re-crop; later crop and zoom edits restore from that saved original. External web-link logos cannot be re-cropped in Admitto.
4. Use **Mail** for the organisation-wide transport.
5. Use **External services** for shared outbound connections: **Weather** (enable, provider MET Norway or Open-Meteo) and **Maps** (enable, provider OpenStreetMap/Nominatim, tile URL, attribution, max zoom, geocoding base URL). Weather provider choice and Maps tile/geocoding endpoints are configured in this tab (not deploy-env toggles). Turning **Maps** off disables static map tiles and map previews; address lookup (Nominatim) for the Location tab keeps working. Nominatim HTTP timeout (`GEOCODING_TIMEOUT_MS`) stays a deployment setting with no UI field. This is not the same as Event Settings → Integrations (inbound Ingest/RSVP tokens). MET Norway and Nominatim both need **Support contact** on General for their User-Agent; without it, weather forecasts and Maps **Test connection** stay unavailable. Open-Meteo free host is for non-commercial use; commercial deployments need a customer API key, a self-hosted base URL, MET Norway, or weather disabled. Forecast horizon is about 9 days (MET Norway) or up to 16 days (Open-Meteo). Use **Test connection** next to each Provider to probe the draft settings without saving first. Apple/Google Wallet is configured per event, on that event's Settings → Wallet tab — not here.
6. Use **Security** for MFA, session policy, and trusted third-party script origins (Content-Security-Policy). Each `https://` origin you add is allowed to run script, receive data (`connect-src`), and, on sign-in pages, render an embedded widget (`frame-src`), for example an analytics/monitoring beacon like Cloudflare Web Analytics, or a login challenge widget like Cloudflare Turnstile. This only affects the admin/operator SPA and sign-in pages; it does not apply to the public ticket page. Review or revoke active sessions from **Users & roles** instead.
7. Use **Archiving** for retention and completed-event controls. Switch between Active and Archived lists (paginated). Each row can show who created and who last archived the event, and when.
8. Use **Identity** for OIDC providers and Cloudflare Access.
9. Use **Logs** to review system, administration, and security activity.
10. Use **Health check** to review Core infrastructure and External integrations status. Core includes **Background worker** (heartbeat from the Admitto worker process that drains mail, runs import/export jobs, bounce detection, and retention). If that row is degraded, start the worker (`npm run worker` locally, or the compose `worker` service). External rows are labelled **role, provider** (for example `Address lookup, Nominatim`, `Map tiles, OpenStreetMap`, and `Weather, MET Norway` or `Weather, Open-Meteo`). Turning **Maps** off in External services marks **Map tiles** as Maps disabled; **Address lookup, Nominatim** stays available for the Location tab. Each configured identity provider appears as its own row; Cloudflare Access is listed separately. **File storage** reports whether the local upload directory (`UPLOAD_DIR`) exists and is writable; if the folder is missing it shows as degraded (Admitto creates it on the first branding upload). A misconfigured path that points at a file instead of a folder is reported as down. **Run live checks** also writes and removes a tiny probe file there, and can probe the active weather provider when weather is enabled. Expand a row for diagnostics such as latency or endpoint host (no secrets). Use **Run live checks** only when you need an on-demand probe of address lookup, weather, mail transport (SMTP verify / Microsoft Graph token; Power Automate is listed as configured without a live probe), identity providers, Cloudflare Access, or file storage. **Copy for GitHub Issue** / **Export** produce a sanitized Markdown snapshot (no secrets or instance URL in the dump).
11. Save one area at a time and verify the visible result.

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
