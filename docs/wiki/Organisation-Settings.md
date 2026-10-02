# Organisation Settings

**Audience:** Superadmins · **Required role:** Superadmin · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.8

## What this page helps you do

Use the supported instance settings without confusing them with event-level settings.

Admitto shows this area as **Organisation settings**. These settings are available only to Superadmins, and some of them affect the whole instance.

## Before you start

Use a named Superadmin account, record the intended change, and prepare a synthetic test account or event.

## Steps

1. Open **Organisation settings**.
2. Use **General** for instance behaviour and base configuration shown by the panel, including **Support contact** (used in the User-Agent for Nominatim and MET Norway requests).
3. Use **Branding** as the single consolidated tab for organisation name, logo, colour palette, built-in fonts, and custom font uploads, with one shared Save/Reset.
   - **Theme by surface**: Admin panel's colour and font pick are the instance's base. Ticket page can either keep matching Admin panel automatically (**Same as Admin panel**) or use its own colour and font, independently of each other. Registration form's controls are reserved for a future registration surface and stay disabled.
   - **Logo upload**: uploading a logo opens an adjust popup so you can trim margins before saving. Transparent PNG/WebP keep their transparency.
   - **Re-crop behaviour**: **Edit image** restores the last crop and zoom after Save and reload (Admitto keeps the full upload for re-edit). Organisation logos uploaded before crop persistence need one full-file upload the first time you re-crop; later crop and zoom edits restore from that saved original. External web-link logos cannot be re-cropped in Admitto.
4. Use **Mail** for the organisation-wide transport.
5. Use **External services** for shared outbound connections, configured in this tab (not deploy-env toggles):
   - **Weather**: enable, choose provider MET Norway or Open-Meteo. Forecast horizon is about 9 days (MET Norway) or up to 16 days (Open-Meteo). Open-Meteo's free host is for non-commercial use; commercial deployments need a customer API key, a self-hosted base URL, MET Norway, or weather disabled.
   - **Maps**: enable, choose provider OpenStreetMap/Nominatim, with tile URL, attribution, max zoom, and geocoding base URL. Turning **Maps** off disables static map tiles and map previews; address lookup (Nominatim) for the Location tab keeps working. Nominatim HTTP timeout (`GEOCODING_TIMEOUT_MS`) stays a deployment setting with no UI field.
   - MET Norway and Nominatim both need **Support contact** on General for their User-Agent; without it, weather forecasts and Maps **Test connection** stay unavailable. Use **Test connection** next to each Provider to probe the draft settings without saving first.
   - This tab is not the same as Event Settings → Integrations, which is currently a placeholder tab reserved for a future inbound API connection and is not yet available. Apple/Google Wallet is configured per event, on that event's Settings → Wallet tab, not here.
6. Use **Notifications** for security alerts to admin staff, split across three cards. Every test action fires the same underlying check against the already-saved settings (not unsaved changes) and shows only the channel(s) it owns.
   - **Webhook**: holds the team destination (Discord, Slack, or generic JSON; one URL per organisation, shared by every admin, not per-person). Its **Send test**, next to Payload format, reports the webhook and in-app results (in-app always goes to your own account; they show in the bell in the top bar; there is no separate in-app card).
   - **Email**: holds a table of extra recipients who get every alert enabled for the email column below, regardless of their own personal opt-out. Each row shows an optional description, when it was added and by whom, and has its own **Send test** (targets that recipient), **Edit** (a small dialog to correct the email or description), and **Remove** (with a confirmation step).
   - **Notification types**: a grid with one row per alert (repeated failed logins, emergency two-factor bypass use, login or security settings changed, admin login from a new country, admin or superadmin role granted) and one switch per channel (Webhook, Email, In-app). Turn any single cell off to stop that alert going out on just that channel, independently of the other two. Turning a cell off only stops active delivery on that channel; the underlying security event is still recorded either way.
7. Use **Security** for MFA, session policy, passkey/security-key sign-in, and trusted third-party script origins (Content-Security-Policy).
   - **Operators stay signed in on event day** (on by default): an operator who signs in on the day of an event they are assigned to stays signed in, with no inactivity timeout, until 06:00 the next morning (or the event's end if later). It works for every sign-in method and needs nothing from the operator. The day comes from the event's own date and timezone, so check both; an event over several days needs one event per day. Turning it off brings the operator limits back, including the inactivity limit for sessions already issued. Administrators and Superadmins are never affected.
   - **Passkey switches** (three, each usable only while the one before it is on):
     1. Turns the whole feature on or off instance-wide (registration, the two-factor step, and step-up confirmation).
     2. Adds a **Sign in with a passkey** option to the sign-in screen itself, letting anyone with a registered passkey skip typing their password (a security key can't be used this way, only at the two-factor step and for step-up).
     3. **Autofill passkey suggestions**: offers a saved passkey directly in the sign-in page's email field autofill (a browser/password-manager suggestion), so signing in doesn't need a click on **Sign in with a passkey** first.
   - **Trusted script origins**: each `https://` origin you add is allowed to run script, receive data (`connect-src`), and, on sign-in pages, render an embedded widget (`frame-src`), for example an analytics/monitoring beacon like Cloudflare Web Analytics, or a login challenge widget like Cloudflare Turnstile. This only affects the admin/operator SPA and sign-in pages; it does not apply to the public ticket page.
   - **Session policy**: by default an operator is signed out after 2 hours without activity or 12 hours in total, and an Administrator or Superadmin after 30 minutes without activity or 12 hours in total (while the **Operators stay signed in on event day** switch above is on, it replaces the operator limits on the day of the event for operators assigned to that event). Review or revoke active sessions from **Users & roles**.
8. Use **Archiving** for retention and completed-event controls. Switch between Active and Archived lists (paginated). Each row can show who created and who last archived the event, and when.
9. Use **Identity** for OIDC providers and Cloudflare Access.
10. Use **Logs** to review system, administration, and security activity.
11. Use **Health check** to review Core infrastructure and External integrations status.
    - **Verdict**: a sentence above the groups summarizes any down or degraded checks (for example "No problems found." or "1 check is down and 2 are degraded.").
    - **Guidance**: a down or degraded row known to Admitto (the database, data encryption, rate limits, the background worker, the mail queue, sending mail, identity providers, Cloudflare Access, file storage, address lookup, weather, and bounce detection) shows **Why** it is in that state, **What it affects** and **What to do** lines when expanded, above its own details, with a link to the relevant settings tab where one applies. A down or degraded row Admitto does not recognise yet says so under **Why** and only suggests reloading, running live checks again and using **Copy for GitHub Issue**, without guessing what it affects. If the core checks cannot be read at all, the **Database**, **Rate-limit storage**, **Data encryption** and **Instance URL** rows say so (Degraded, "Could not evaluate ...") instead of claiming a specific problem, and the **Database** row is Down only when its own probe fails. A healthy row shows only its details. **Wallet passes** lists how many events have Wallet turned on, how many are fully set up and how many are not fully set up yet; an event still being set up does not change the row's status. **Email sending** shows a quieter note instead when no organisation mail provider is set, or the set provider only exports rather than sends, each with a link to Mail settings.
    - **Reading a row**: each row has a status circle whose colour and symbol show the state: a check for healthy, a warning triangle for **Degraded**, a cross for **Down** and a dash for **Not configured**. Within a group, problems come first (Down, then Degraded, then healthy, then Not configured), and Down or Degraded rows open by themselves. **Not configured** is a quiet state, not a problem: the feature is simply not set up (for example no mail provider), and it does not change the verdict. **Instance URL** is Down when there is no valid address (nothing is set anywhere outside development, or `BASE_URL` or the saved address is not a valid URL; `BASE_URL` is read first, so a wrong one has to be corrected or removed before General settings can take over), and Degraded ("BASE_URL not set") when the address is saved only in General settings: links keep working, but the `BASE_URL` environment variable is the recommended place for it.
    - **Core**: includes **Background worker** (heartbeat from the Admitto worker process that drains mail, runs import/export jobs, bounce detection, and retention). If that row is degraded, start the worker (`npm run worker` locally, or the compose `worker` service). Once its heartbeat is at least a minute old, its expanded details show **Last seen** (for example "12 min before this report"), measured against this report's own **Generated** time rather than the current time.
    - **External**: rows are labelled **role, provider** (for example `Address lookup, Nominatim`, `Map tiles, OpenStreetMap`, and `Weather, MET Norway` or `Weather, Open-Meteo`). Turning **Maps** off in External services marks **Map tiles** as Maps disabled; **Address lookup, Nominatim** stays available for the Location tab. Each configured identity provider appears as its own row; Cloudflare Access is listed separately.
    - **File storage**: reports whether the local upload directory (`UPLOAD_DIR`) exists and is writable. If the folder is missing it shows as not configured (Admitto creates it on the first branding upload). A misconfigured path that points at a file instead of a folder is reported as down.
    - **Run live checks**: an on-demand probe of address lookup, weather, mail transport (SMTP verify / Microsoft Graph token; Power Automate is listed as configured without a live probe), identity providers, Cloudflare Access, or file storage. For file storage it creates a missing upload folder, then writes and removes a tiny probe file in it (Down with "Cannot create the upload folder" if that fails). It can also probe the active weather provider when weather is enabled. Expand a row for diagnostics such as latency or endpoint host (no secrets).
    - **Copy for GitHub Issue** / **Export**: produce a sanitized Markdown snapshot (no secrets or instance URL in the dump).
12. Save one area at a time and verify the visible result.

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
- **A tab shows grey boxes, or says "Taking longer than usual":** the settings are being read from the server. Wait a moment and check your connection. After 30 seconds it stops waiting and shows "Could not load ..." with the reason and a **Retry** button; nothing you could have changed is lost, because nothing has been shown yet. This applies to General, Mail, External services, Notifications, Security and Archiving, and to the Mailing tab of an event; the other tabs follow.
- **In Archiving, a warning says "Could not refresh this list, so it may show older details":** the event was archived or restored, and it is already shown in its new place, but loading the list again afterwards failed. Press **Retry** in the warning.
- **A security change blocks a test user:** restore access with another authorised Superadmin, not a shared account.

## Related pages

- [Superadmin Quick Start](Superadmin-Quick-Start)
- [Mail Delivery Administration](Mail-Delivery-Administration)
- [Identity and SSO](Identity-and-SSO)
- [Logs and Audit](Logs-and-Audit)
- [Technical Documentation](Technical-Documentation)
