# Organisation Settings

**Audience:** Superadmins · **Required role:** Superadmin · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.8

## What this page helps you do

Use the supported instance settings without confusing them with event-level settings.

Admitto shows this area as **Organisation settings**. These settings are available only to Superadmins, and some of them affect the whole instance.

## Before you start

Use a named Superadmin account, record the intended change, and prepare a synthetic test account or event.

## Steps

Open **Organisation settings**. Save one area at a time and verify the visible result.

| Tab | What it covers |
|-----|----------------|
| **General** | Instance behaviour and base configuration shown by the panel, including **Support contact** (used in the User-Agent for Nominatim and MET Norway requests) |
| **Branding** | Organisation name, logo, colour palette and fonts |
| **Mail** | The organisation-wide mail transport |
| **External services** | Weather and Maps connections, the Cloudflare Turnstile keys for guest registration, and the ways in to its form |
| **Notifications** | Security alerts to admin staff |
| **Security** | MFA, session policy, passkey sign-in, trusted script origins |
| **Archiving** | Retention and completed-event controls. Switch between Active and Archived lists (paginated). Each row can show who created and who last archived the event, and when |
| **Identity** | OIDC providers and Cloudflare Access |
| **Logs** | System, administration and security activity |
| **Health check** | Core infrastructure and External integrations status |

### Branding

One consolidated tab for organisation name, logo, colour palette, built-in fonts and custom font uploads, with one shared Save and Reset.

- **Theme by surface:** the Admin panel's colour and font pick are the instance's base. The Ticket page can keep matching the Admin panel automatically (**Same as Admin panel**), or use its own colour and font, independently of each other. The Registration form's controls are not available yet and stay disabled.
- **Logo upload:** uploading a logo opens an adjust popup, so you can trim margins before saving. Transparent PNG and WebP keep their transparency.
- **Re-crop behaviour:** **Edit image** restores the last crop and zoom after Save and reload, because Admitto keeps the full upload for re-edit. Organisation logos uploaded before crop persistence need one full-file upload the first time you re-crop. Later crop and zoom edits restore from that saved original. External web-link logos cannot be re-cropped in Admitto.

### External services

Shared outbound connections. They are configured in this tab, not through deploy-env toggles.

**Weather**

- Enable it and choose the provider: MET Norway or Open-Meteo.
- The forecast horizon is about 9 days (MET Norway) or up to 16 days (Open-Meteo).
- Open-Meteo's free host is for non-commercial use. Commercial deployments need a customer API key, a self-hosted base URL, MET Norway, or weather disabled.

**Maps**

- Enable it and choose the provider, OpenStreetMap/Nominatim, with the tile URL, attribution, max zoom and geocoding base URL.
- Turning **Maps** off disables static map tiles and map previews. Address lookup (Nominatim) for the Location tab keeps working.
- The Nominatim HTTP timeout (`GEOCODING_TIMEOUT_MS`) stays a deployment setting with no UI field.

**Guest registration**

- Save the Cloudflare Turnstile **Site key** and **Secret key** here. Turnstile checks that a visitor to the registration form is not a bot. A form that guests reach by a public link or a password stays closed until both keys are saved.
- The secret key is stored encrypted and is never shown again. Use **Set**, **Change** or **Clear** on it, then Save once for the whole tab.
- In Cloudflare, add the address of this instance to the hostnames of the widget.
- Cloudflare sees each visitor's IP address and browser details when the form opens. Name it in your privacy notice. See [SUBPROCESSORS.md](https://github.com/solarssk/admitto/blob/main/docs/security/SUBPROCESSORS.md).
- Guest registration itself is not available yet. The card only stores the keys that it will need.

**Ways in**

- Turn **Link** or **Password** on to let organisers choose it for their events. An organiser picks one way in for each event, on the **Access** tab of its **Registration** page.
- A way that is off cannot be chosen. Turning one off closes the form of every event that uses it, at once: guests see a page that is not found.
- Nothing is deleted when you turn a way off. Turn it on again and those forms open again.
- A way that is on opens a form only while the Turnstile keys are ready. The card warns you when they are not.
- Save once for the whole tab. The change is recorded in **Logs**, on the **Audit** view, as "Guest registration access methods updated".

**Support contact and Test connection**

- MET Norway and Nominatim both need **Support contact** on General for their User-Agent. Without it, weather forecasts and Maps **Test connection** stay unavailable.
- Use **Test connection** next to each provider to probe the draft settings without saving first.

**What this tab is not.** It is not Event Settings → Integrations, which is currently a placeholder tab reserved for a future inbound API connection and is not yet available. Apple and Google Wallet are configured per event, on that event's Settings → Wallet tab, not here.

### Notifications

Security alerts to admin staff, split across three cards. Every test action fires the same underlying check against the already-saved settings (not unsaved changes), and shows only the channels it owns.

- **Webhook:** the team destination (Discord, Slack, or generic JSON). There is one URL per organisation, shared by every admin, not per person. Its **Send test**, next to Payload format, reports the webhook and in-app results. The in-app result always goes to your own account, and shows in the bell in the top bar. There is no separate in-app card.
- **Email:** a table of extra recipients who get every alert enabled for the email column below, regardless of their own personal opt-out. Each row shows an optional description, when it was added and by whom. Each row has its own **Send test** (it targets that recipient), **Edit** (a small dialog to correct the email or description) and **Remove** (with a confirmation step).
- **Notification types:** a grid with one row per alert and one switch per channel (Webhook, Email, In-app). The alerts are repeated failed logins, emergency two-factor bypass use, login or security settings changed, admin login from a new country, and admin or superadmin role granted. Turn any single cell off to stop that alert going out on just that channel, independently of the other two. Turning a cell off only stops active delivery on that channel. The underlying security event is still recorded either way.

### Security

MFA, session policy, passkey and security-key sign-in, and trusted third-party script origins (Content-Security-Policy).

**Operators stay signed in on event day** (on by default)

- An operator who signs in on the day of an event they are assigned to stays signed in, with no inactivity timeout, until 06:00 the next morning (or the event's end if later).
- It works for every sign-in method and needs nothing from the operator.
- The day comes from the event's own date and timezone, so check both. An event over several days needs one event per day.
- Turning it off brings the operator limits back, including the inactivity limit for sessions already issued.
- Administrators and Superadmins are never affected.

**Passkey switches**

There are three. Each is usable only while the one before it is on.

1. Turns the whole feature on or off instance-wide: registration, the two-factor step, and step-up confirmation.
2. Adds a **Sign in with a passkey** option to the sign-in screen itself. Anyone with a registered passkey can then skip typing their password. A security key cannot be used this way, only at the two-factor step and for step-up.
3. **Autofill passkey suggestions** offers a saved passkey directly in the sign-in page's email field autofill (a browser or password-manager suggestion), so signing in does not need a click on **Sign in with a passkey** first.

**Trusted script origins**

- Each `https://` origin you add is allowed to run script, to receive data (`connect-src`), and, on sign-in pages, to render an embedded widget (`frame-src`). Examples: an analytics or monitoring beacon like Cloudflare Web Analytics, or a login challenge widget like Cloudflare Turnstile.
- This only affects the admin and operator SPA and the sign-in pages. It does not apply to the public ticket page.

**Session policy**

- By default, an operator is signed out after 2 hours without activity or 12 hours in total.
- An Administrator or Superadmin is signed out after 30 minutes without activity or 12 hours in total.
- While the **Operators stay signed in on event day** switch above is on, it replaces the operator limits on the day of the event, for operators assigned to that event.
- Review or revoke active sessions from **Users & roles**.

### Health check

Review Core infrastructure and External integrations status.

**Verdict.** A sentence above the groups summarizes any down or degraded checks, for example "No problems found." or "1 check is down and 2 are degraded."

**Guidance for a row**

- A down or degraded row that Admitto knows shows **Why** it is in that state, **What it affects** and **What to do** lines when expanded, above its own details. It has a link to the relevant settings tab where one applies. Known rows are the database, data encryption, rate limits, the background worker, the mail queue, the registration mail queue, sending mail, identity providers, Cloudflare Access, file storage, address lookup, weather, bounce detection and bot protection.
- A down or degraded row Admitto does not recognise yet says so under **Why**. It only suggests reloading, running live checks again and using **Copy for GitHub Issue**, without guessing what it affects.
- If the core checks cannot be read at all, the **Database**, **Rate-limit storage**, **Data encryption** and **Instance URL** rows say so (Degraded, "Could not evaluate ...") instead of claiming a specific problem. The **Database** row is Down only when its own probe fails.
- A healthy row shows only its details.
- **Wallet passes** lists how many events have Wallet turned on, how many are fully set up and how many are not fully set up yet. An event still being set up does not change the row's status.
- **Email sending** shows a quieter note instead when no organisation mail provider is set, or when the set provider only exports rather than sends. Each note links to Mail settings.

**Reading a row.** Each row has a status circle. Its colour and symbol show the state:

| Symbol | State |
|--------|-------|
| A check | Healthy |
| A warning triangle | **Degraded** |
| A cross | **Down** |
| A dash | **Not configured** |

- Within a group, problems come first: Down, then Degraded, then healthy, then Not configured. Down and Degraded rows open by themselves.
- **Not configured** is a quiet state, not a problem. The feature is simply not set up (for example, no mail provider). It does not change the verdict.
- **Instance URL** is Down when there is no valid address: nothing is set anywhere outside development, or `BASE_URL` or the saved address is not a valid URL. `BASE_URL` is read first, so a wrong one has to be corrected or removed before General settings can take over.
- **Instance URL** is Degraded ("BASE_URL not set") when the address is saved only in General settings. Links keep working, but the `BASE_URL` environment variable is the recommended place for it.

**Core and External**

- **Background worker** (in Core): a heartbeat from the Admitto worker process that drains mail and runs import and export jobs, bounce detection and retention. If that row is degraded, start the worker (`npm run worker` locally, or the compose `worker` service). Once its heartbeat is at least a minute old, its expanded details show **Last seen** (for example "12 min before this report"). It is measured against this report's own **Generated** time, not the current time.
- **Registration mail queue** (in Core) counts the emails that guest registrations queue, such as the confirmation link, the same way **Mail delivery queue** counts ticket emails. It is Degraded when an email failed and will be tried again, when an email failed for good in the last seven days (the mail service refused it, its text could not be used, or every attempt was used, so the worker has stopped trying), or when 50 or more are waiting. It shows counts only. A registration that is not confirmed within 24 hours is deleted, so a confirmation link that never arrives means the guest has to register again.
- **External rows** are labelled **role, provider**, for example `Address lookup, Nominatim`, `Map tiles, OpenStreetMap`, and `Weather, MET Norway` or `Weather, Open-Meteo`. Turning **Maps** off in External services marks **Map tiles** as Maps disabled. **Address lookup, Nominatim** stays available for the Location tab. Each configured identity provider appears as its own row. Cloudflare Access is listed separately.
- **Bot protection, Turnstile** is Degraded when guest registration by public link or password is on for an event but the Turnstile keys are not saved, or when the saved secret key cannot be read (often a changed `ENCRYPTION_KEY`). It is Not configured while no event needs the keys and none are saved. It does not call Cloudflare, so it does not show whether Cloudflare accepts the keys.
- **File storage** reports whether the local upload directory (`UPLOAD_DIR`) exists and is writable. If the folder is missing, it shows as not configured (Admitto creates it on the first branding upload). A misconfigured path that points at a file instead of a folder is reported as down.

**Run live checks and export**

- **Run live checks** is an on-demand probe. It covers address lookup, weather, mail transport (SMTP verify or Microsoft Graph token; Power Automate is listed as configured without a live probe), identity providers, Cloudflare Access and file storage. It can also probe the active weather provider when weather is enabled. Expand a row for diagnostics such as latency or endpoint host (no secrets).
- For file storage, it creates a missing upload folder, then writes and removes a tiny probe file in it. It shows Down with "Cannot create the upload folder" if that fails.
- **Copy for GitHub Issue** and **Export** produce a sanitized Markdown snapshot, with no secrets or instance URL in the dump.

## Expected result

The selected setting is saved, an audit record is created where supported, and the test confirms the intended behaviour.

## Important decisions

- Organisation settings can affect every organisation or staff login.
- Environment-locked values are read-only in the UI and cannot be overridden there.
- Event-specific mail settings can override the organisation transport for that event.
- Deployment and emergency recovery are not UI tasks. Use the technical documentation.

## What changes after this action

The change can affect future sessions, messages, branding, archiving, or logs, depending on the panel. Existing sessions or sent messages are not automatically rewritten unless the UI says so.

## Common problems

| Problem | What it means and what to do |
|---------|------------------------------|
| **A field is locked** | It is controlled outside the UI. Follow the approved deployment process |
| **A save succeeds but behaviour is unchanged** | Verify the correct scope, and whether an event override exists |
| **A tab shows grey boxes, or says "Taking longer than usual"** | The settings are being read from the server. Wait a moment and check your connection. After 30 seconds it stops waiting and shows "Could not load ..." with the reason and a **Retry** button. Nothing you could have changed is lost, because nothing has been shown yet. This applies to General, Branding, Mail, External services, Notifications, Security and Archiving, and to the Mailing tab of an event. The other tabs follow |
| **In Archiving, a warning says "Could not refresh this list, so it may show older details"** | The event was archived or restored, and it is already shown in its new place, but loading the list again afterwards failed. Press **Retry** in the warning |
| **A security change blocks a test user** | Restore access with another authorised Superadmin, not a shared account |

## Related pages

- [Superadmin Quick Start](Superadmin-Quick-Start)
- [Mail Delivery Administration](Mail-Delivery-Administration)
- [Identity and SSO](Identity-and-SSO)
- [Logs and Audit](Logs-and-Audit)
- [Technical Documentation](Technical-Documentation)
