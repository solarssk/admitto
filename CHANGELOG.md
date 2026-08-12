# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- My account: staff can choose 12-hour (AM/PM), 24-hour, or browser-default time input independently from their regional date format.
- **Add to Apple Wallet / Google Wallet.** The wallet badges on the public ticket page are now live — tapping one creates (or reuses) the attendee's wallet pass and opens it directly, without ever landing on a PassCreator-hosted page. If creation fails, the ticket page shows a retry notice instead of a broken redirect.
- **Event hours (start/end).** New Event and Event settings → Basic information now have an optional "Event hours" start/end time field, shown as a range on tickets and (later) wallet passes. Leave blank to omit.

### Fixed
- Instance Settings → Mail and an event's Mailing settings: when a stored SMTP password, Graph client secret, or Power Automate key can no longer be decrypted (for example after `ENCRYPTION_KEY` changes), the Test and Verify connection actions now show a clear message asking the admin to re-enter and save the credential, instead of a generic "Something went wrong" error. System logs now record `mail_secret_decryption_failed` instead of a bare unhandled exception. Sending or resending tickets, retrying a failed delivery, Organisation Settings → Health check, and an event's "Verify bounce" check now surface the same clear message instead of a generic failure or an opaque retry with no recorded reason.
- Communication → Templates: on phones, the selected template name is no longer covered by its status badge; the last-edited date is available from the Edit template control. **Delete event** now permits an otherwise-empty event whose only saved mail template is its non-deletable default Ticket email override; additional custom templates still block deletion.
- Organisation Settings → Health check: the mobile **More actions** menu now stays compact instead of expanding to fit its longest description.
- Organisation Settings → Logs: on iPhone browsers, opening Filters or typing a date no longer leaves the page or the calendar clipped behind the software keyboard. Filter and option panels now stay within the visible screen and scroll when necessary.
- Timezone selection now uses one global IANA timezone catalogue with legacy aliases folded into their preferred current names. Map suggestions, event saves, and the picker consistently use one entry, for example, `Asia/Calcutta` is accepted but shown and saved as `Asia/Kolkata`.
- My account: an account signed in only through an identity provider now correctly shows "Password is managed by your identity provider" and no longer asks for a current password it can never have. Unlinking SSO on such an account now fails with a clear message asking you to contact an administrator, instead of endlessly rejecting a password that doesn't exist. Existing accounts in this state are corrected automatically on upgrade.

### Added
- Organisation Settings → Security: superadmins can now allow specific third-party `https://` origins to run script, send data, and (on sign-in pages) render an embedded widget, for example an analytics/monitoring beacon like Cloudflare Web Analytics or a login challenge widget like Cloudflare Turnstile, without weakening the Content-Security-Policy for anything else.

### Security
- Users & roles: **Reset password** and **Reset two-factor** are now disabled for staff accounts signed in through an identity provider, in both the menu and the API, since resetting a password on an SSO-managed account previously created a working local sign-in path alongside the identity provider link with no warning shown.

## [0.4.14] - 2026-08-11

### Added
- **Deploy docs:** clearer first-boot checklist (what must be env vs UI), Portainer/NPM without compose nginx (Variant B), and a generated environment dictionary ([`deploy/ENV.md`](deploy/ENV.md)) built from code scan + [`deploy/env-catalog.json`](deploy/env-catalog.json) (`npm run docs:env`; drift checked by `npm run docs:check`).
- Event Overview's Recent activity now also shows attendees added and items issued/returned/revoked, alongside check-ins, mail failures, and imports.
- Event Overview now refreshes within ~3 seconds of a check-in, attendee add, or item issue/return/revoke (previously up to 30s), via a lightweight SSE signal that triggers an immediate refetch of the whole page.
- Event Overview now also refreshes within ~3 seconds of a mail send/failure or a finished import. The worker announces these over Redis pub/sub so live updates aren't limited to actions taken in the admin app itself. Falls back to the existing 30s poll if Redis is unavailable.

### Changed
- **GitHub Releases from `v0.4.13` onward are marked as the latest release instead of pre-release** — the release pipeline no longer marks every `v0.x.y` tag as pre-release; see [VERSIONING.md](VERSIONING.md).
- Living ops and security docs now match the current stack: generic **Upgrading** (manual backup first), no automatic pre-migration dump / root migrate, product retention and bounce on the **worker** (not app startup or a retention sidecar), and package README CLI notes aligned with workspace builds.
- **OIDC providers are configured only in Organisation settings → Identity.** Removed the unused `OIDC_ENABLED` / `OIDC_ISSUER` / `OIDC_CLIENT_*` / `OIDC_DISPLAY_NAME` env-seed documentation (the runtime never read those variables). Cloudflare Access optional env locks are unchanged.
- Identity provider editor shows the Redirect URI pattern on the Add form before the first save.
- **The deploy stack no longer takes an automatic database backup before applying a schema migration, and no container in the stack runs as root anymore.** Every upgrade previously got a guaranteed snapshot immediately before the migration; that guarantee is gone, so **take a manual database backup before every upgrade** (see `deploy/README.md` → Upgrading) — without it, your recovery point is whatever the nightly `db-backup` service last captured, which can be up to 24 hours old. Run `deploy/scripts/init-host-dirs.sh` before the first compose up so bind mounts are writable by the app user.
- **Failed login attempts now show the full attempted email in the Security audit log (and are searchable there), matching how successful sign-ins and other providers attribute activity.** Operational stdout / System logs still redact (`a***@example.com`). Superadmin-only durable table; matches the retention policy already documented for this trail.

### Fixed
- Admin table pagination now opens a compact **Rows per page** menu, and card headers keep a consistent height whether or not they contain actions.
- Event Settings → Images: the "file too large" messages on the event logo drop zone and the crop dialog now use the same bordered Notice style as the rest of the image library, instead of two different ad-hoc red-text treatments.
- Check-in's Recent scans no longer shows a duplicate "Checked in" row for the same admission after a follow-up action (e.g. issuing a badge) refreshes the sidebar: the persisted check-in timestamp now matches the one already shown by the optimistic local echo instead of being read from the database's own clock.
- Event Settings no longer crashes on load: the image library imports placeholder names from a browser-safe `@admitto/mail-templates` subpath instead of the package root (which pulled Prisma/Node APIs into the SPA).
- Event Settings → Images: Image name hint/error sits close under the field (standard field spacing), and invalid focused inputs keep a single error focus ring instead of blue border plus red glow.
- Requirements → Custom attendee fields: empty registry uses EmptyState (no empty table row), the table shows Description instead of Type, and the type icon has a hover tooltip. Field-type buttons share equal width; type hints describe attendee answers with examples. Event items and custom-fields tables share column layout and row height; IDs use monospace. Event item modal: header icon, slim scrollbar, Delete on the left with Cancel/Save on the right.
- Sessions and Security logs now show the actor's own timezone on the secondary time line (same pattern as Audit logs), capturing it at local login, initial `/setup`, and OIDC start. Older rows and non-browser clients still fall back to your browser timezone.
- Event settings: clearer card hints, Location **Remove pin** (no Find on map), safer ticket-type delete confirm, and Organisation Admins can manage the mail image library. Image uploads use a plain image name (server builds `{{token}}`), with clearer upload/remove errors.
- Attendees now show "No ticket type" instead of a dash when no type is assigned. Bulk delete and revoke confirmations are immediately actionable, while their confirmation dialog remains in place.
- Requirements now gives new Badge items (and untouched legacy seed badges) the Name badge issued at check-in description and badge icon, without overwriting cleared descriptions or an intentional package/default icon. Custom field types use clear labels and guidance, and the Requirements page links to its documentation.
- Users & roles: clearer labels (Identity provider / Local password; Two-factor / Authenticator app), Windows Chrome shows country flags in phone pickers via a bundled Twemoji font, and Invite user resists Chrome autofill into phone and temporary password.
- Events picker: **New event** stays on one row with the title on mobile and shows a calendar-plus icon.
- New event modal: location has a single Optional label, the link ID is generated from the title (no Link name field), Find on map is removed, the timezone hint is clearer, and the timezone list reopens with one click after closing it by clicking outside. Non-Latin titles still get a unique `event-<fingerprint>` link ID so Create stays enabled.
- Event Overview now shows completed setup checks alongside outstanding work, describes email activity consistently, and lets staff save key contact phone numbers with a country-code picker.
- Bulk ticket-send previews no longer use the three-send limit. Real bulk sends now explain the 10-minute limit when it is reached.
- Check-in cards label their dismiss action "Close", and Recent activity no longer shows duplicate-scan warnings as check-ins.
- Public HTML 404/500 pages no longer overflow on narrow phones, and show a clearer layout (large status code and icon instead of a small boxed notice).
- MFA enrollment: downloading backup codes no longer leaves the button stuck on "Please wait…".
- MFA setup on desktop no longer offers a misleading "Open in password manager" link (otpauth often does nothing on Windows Chrome); copy explains scanning the QR or pasting the setup key instead.
- Security and Audit logs now keep the staff member's email and display name on each row after their account is deleted, using immutable identity snapshot columns written at event time.
- Concurrent OIDC instance-superadmin revokes use true full-jitter backoff (0..cap ms) so Serializable retries no longer thrash under a floor+jitter delay.
- **Delete event** is no longer blocked by leftover operational action-log history after attendees and event-specific content are cleared (demo/test events can be removed again). Danger zone now lists the concrete remaining blockers when delete is disabled. Permanent delete also best-effort removes managed event branding and named image-asset uploads from storage (same cleanup as deleting a single asset).
- System logs' request-activity lines now include the client IP when the request came from an authenticated staff or check-in operator session, matching how an identity provider attributes its own activity log; anonymous/attendee-facing requests still omit it. A denied admin/superadmin request (insufficient role, password-change required) now keeps this same attribution instead of logging as anonymous.
- Settings → Logs & audit: the Audit and Security tabs no longer keep polling their endpoints in the background while you're looking at a different tab (System, or each other) — only the tab currently on screen refreshes itself.
- Modals on iOS Safari no longer trap scrolling: panel height now follows the dynamic toolbar (`dvh`) instead of a fixed `100vh` that could sit taller than the visible viewport, so Save/Cancel stay reachable. The check-in note popup gained the same height limit and scrolling it was missing entirely.
- Text inputs, search boxes, and the date picker no longer trigger iOS Safari's auto-zoom on focus (their font size is now 16px on touch devices, matching the platform's zoom threshold, regardless of viewport width or orientation).
- Organisation Settings → Health check: the version/build info no longer overflows off narrow screens, and "Run live checks" moves into the "More actions" menu on mobile so the header stays on one row.
- Organisation Settings → Security: the per-role authenticator switches (Superadmin/Administrator/Operator) stack one per row on mobile instead of wrapping unevenly.
- Organisation Settings → Mail: the "Use TLS" and "Require STARTTLS" switches stay next to their label on mobile instead of dropping to their own line.
- Audit and Security logs (Organisation settings → Logs) now span the full width of their card, matching every other table in the app; the table and its horizontal scrollbar previously stopped short of the card edge.

### Security
- **Self-hosted LAN identity providers (SSO):** ops can allow specific Issuer/endpoint hostnames (or IP literals) that resolve to private addresses via `SSO_PRIVATE_DESTINATION_ALLOWLIST` on `app`. One list covers every configured provider sharing those hosts (OIDC today; same guard for future SAML). HTTPS remains required. Separate from the mail allowlist.
- Weather (Open-Meteo) and geocoding (Nominatim) requests now pin the outbound connection to a freshly re-resolved, validated address instead of trusting the hostname check performed when the base URL was last saved, closing a DNS-rebinding gap that could let a superadmin-configured external service URL reach an internal/metadata address after passing that save-time check.
- **Self-hosted LAN mail in production:** ops can allow specific SMTP/IMAP/Power Automate hosts (or IP literals) that resolve to private addresses via `MAIL_PRIVATE_DESTINATION_ALLOWLIST` (app and worker). The lab-only `ALLOW_PRIVATE_MAIL_DESTINATIONS=true` flag remains ignored when `NODE_ENV=production`.

## [0.4.13] - 2026-08-09

### Added
- `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md` (`.github/`), completing GitHub's community standards profile; `CONTRIBUTING.md` covers using AI coding tools responsibly.
- Communication Templates: template label, icon, and description are editable from the Edit template dialog, which also lets you delete non-ticket templates.
- Send tab: a "Specific attendees" recipient option lets an operator search and pick individual attendees instead of only broad category filters.
- New Admitto background worker (`admitto worker` / `npm run worker`) now drains ticket mail sends/resends, attendee import commits, filtered exports, bounce detection, and scheduled retention off the request path; deploy compose runs it as a single `worker` service replacing the old `bounce-ingest` and `retention` sidecars, and Settings → Health shows its heartbeat.
- My account: users can unlink or connect their own SSO provider from the Profile card (requires setting a new password when unlinking, plus proof of identity), and can set their own internal contact phone number.
- OIDC provider editor shows the Redirect URI to register at the identity provider (with copy) after the first save, using the same public base URL as live OIDC start/callback.
- Identity provider settings gain configurable given name, family name, and phone claims; when the combined name claim is missing, the display name falls back to given + family name.
- Event bounce detection (IMAP ingest): superadmins can configure a per-event IMAP mailbox under Event settings → Mailing so forwarded delivery-failure/NDR messages mark matching deliveries as bounced, with the SMTP code and reason stored for Delivery details; the Mailing tab shows the last automatic check with a manual "Run check now" and a history of recent runs, and Settings → Health reports bounce-detection status.
- Delivery details modal shows a plain-English explanation of send/bounce status, with hover hints on technical fields (Sent at, Batch ID, Session ID, Client timezone), instead of raw provider dumps.
- Event settings → Mailing → Send test email gained an optional "Also verify bounce" switch that waits up to 90 seconds for a bounce to confirm mailbox connectivity.
- Organisation and Event mail settings gained a "Test connection" action that verifies SMTP host/port/login without sending mail.
- Organisation Settings gained a Health check page: a grouped system status view (core infrastructure vs. external integrations) with on-demand live checks (Nominatim, SMTP, Microsoft Graph, identity providers, Cloudflare Access, file storage, weather), plus Export and Copy for GitHub Issue.
- Communication → Delivery log now gives real diagnostics per send: View sent message (rendered subject/HTML with the QR/ticket link redacted for privacy) and View delivery details (provider, message id, attempt count, and a full Delivery Timeline across every send to that attendee); the same actions are available from the Attendee Detail page's Delivery history card.
- Info tooltips now explain what a section does across Instance Settings, Event Settings, Requirements, Reports, and My account, wherever a card's title alone doesn't convey a non-obvious rule or consequence.
- New consolidated Branding settings tab (Instance Settings) replaces the separate Organisation branding and Theme cards: a curated color palette, four self-hosted built-in fonts plus a custom-font upload flow (multiple weight/style files, magic-byte validated), and one shared Save/Reset.
- Instance Settings → Logs & audit: the Audit log gained severity badges, actor local time, an event-scope filter, and CSV export; a new "System logs" live-tail panel shows a filterable, near-real-time feed across the API, database, cache, mail transport, and admin actions.
- Loading states across nearly every admin page now wait briefly before showing a spinner/skeleton, so a near-instant response no longer flashes a loading glitch.
- Event Settings gained a Mailing tab letting a Superadmin send a specific event through its own SMTP/Microsoft Graph/Power Automate configuration instead of the organization's default transport (Organisation Admins do not see this tab).
- Attendees list gained a rows-per-page control, a single Export menu, row selection with a bulk "Send tickets" action, and a mobile card layout.
- Attendee Detail redesigned: a read-only profile view with a header Edit modal, a status strip (Registration, Attendance, Ticket delivery, Check-in, Wallet), richer Activity log entries describing what actually changed, and an Additional information card for custom fields.
- Event-day weather now shows on admin/operator event cards and the public ticket page, choosing between MET Norway (default) or Open-Meteo under Organisation Settings → External services.
- Event settings gained a Location tab for venue name/address, map coordinates, and directions/accessibility notes, replacing the old plain-text Location field; a typeahead search suggests venues/addresses and fills the map pin (map display itself is optional and can be turned off while keeping search).
- Admins can override a wrong auto-generated Google/Apple Maps deep link from the Location tab ("Pin wrong? Fix link"); mail templates gained location/map tokens (`{{event_address}}`, `{{directions_text}}`, `{{accessibility_text}}`, map links), and the browser ticket page now shows a "Getting there" section with a static map and directions when the event has a saved location.
- Edit user and Invite user gained an optional internal staff phone number field (country code + number, never shown on tickets).
- Edit user's Danger zone lets a superadmin delete a staff account or change their email address.
- Users & roles gained KPI tiles (Staff users, Via SSO, MFA coverage, Active sessions) above the tabs.
- Branding/image uploads now clean up orphaned files automatically (cancelled crops, replaced logos/fonts, deleted assets), plus a new `admitto storage gc` CLI command to sweep any remaining unreferenced uploads.
- Audit log, Security log, and Active sessions now show which country an IP address resolved to, computed offline with no third-party lookup.
- Instance Settings → Logs & audit gained a durable, database-backed Security audit log (login/MFA/logout/OIDC events) that survives a restart, retained 30 days by default (`SECURITY_AUDIT_LOG_RETENTION_DAYS`).
- The admin audit log and System logs now cover more actions that previously left no trail — identity provider changes, first-run setup completion, branding uploads, forced password changes, check-in/bulk operations, and more.
- Reports page redesigned: compact KPI tiles, a taller hourly chart, and new Attendance confirmation / Check-in method / By device breakdown cards.
- Event Overview redesigned: a compact Setup checklist card, a Check-in progress ring with a ticket-type breakdown, and a Recent activity feed merging check-ins, mail failures, and imports.
- Check-in now gives a beep and (where supported) a short vibration on every scan, distinct tones for valid/already-checked-in/invalid.
- My account gained a Download backup codes button next to the codes shown during 2FA enrollment.
- Settings → Security → Sessions gained an Edit action next to Revoke, letting a superadmin correct a session's device label after the fact.
- New "Support contact" section on Organisation settings → General, used to build an identifiable contact string for outbound geocoding/weather requests.
- Sidebar footer's version label now also shows the running build's commit.
- Attendee Detail gained a Notes tab shared with check-in operators' own notes, and a Revoke items action scoped to a single attendee.
- Admission log, CSV export, and PDF export now show which event-day items were issued to each admitted attendee.
- Attendees list bulk-selection bar gained many more actions: revoke check-in/items/pass, change ticket type or attendance status, check in without scanning, export just the selection as CSV, and a filter by mail delivery status; the search box also gained a clear button.
- Attendee import page redesigned: a drag-and-drop dropzone, an explicit Dry run/Commit toggle, an Import history card, and a success screen summarizing created/updated/skipped rows.
- Attendee Detail gained a Delete attendee action (GDPR erasure) with a typed-confirmation safeguard, previously only possible via internal tooling.
- Event Settings gained a Ticket types tab defining an event's ticket types (label + color) once instead of free-text guest types; every screen that used free text (attendee form, filters, import, Reports breakdown) now reads from this catalog.
- Requirements page gained a Custom attendee fields registry (dietary requirements, parking, etc.) defined once and reused consistently across check-in, the attendee form, import, and export.
- Event Settings → Danger zone gained "Revoke all check-ins" and "Revoke all items issued" bulk actions, and a "Delete event" action that permanently removes an event once it has zero real activity — each with a confirmation delay or typed confirmation.
- Event Settings → Branding gained an image asset library for custom email tokens (e.g. a sponsor logo), referenced in templates as `{{name}}`, plus its own event-scoped logo/header override.
- The public ticket page shows the event's (or organisation's) logo when configured, instead of the generic Admitto wordmark.
- Admin/superadmin can now revoke a single attendee's check-in or a single handed-out item directly from the Check-in card or Attendee Detail, without needing the event-wide Danger zone actions.
- The Archiving tab now shows who created and who last archived each event, and when.
- Logo and event image uploads gained a crop step (drag to trim margins) before upload.

### Changed
- Security and compliance docs consolidated under `docs/security/` (architecture-for-auditors, incident response, GDPR one-pager, DSAR procedure, subprocessors, corporate deployment). README documentation map clarifies that self-hosted deploy needs a developer or IT contractor.
- Project license is formally Apache-2.0: root `LICENSE`, slim Apache `NOTICE`, `package.json` `"license": "Apache-2.0"`, and `THIRD-PARTY-NOTICES.md` for redistributed OFL fonts and LGPL libvips (via sharp). The production Docker image copies all three license files into `/app`.
- Attendee add/edit and CSV/XLSX import now use separate First name and Last name fields; a single combined "name" column/field is no longer accepted.
- Creating an event opens Overview instead of the Attendees list.
- Role/scope pickers (Invite user, Edit user, Active sessions bulk revoke) show a visible caption above the dropdown, and skip the search box for short option lists.
- Attendance status pickers now show a status icon next to each option, matching the status badge's color grouping used elsewhere.
- Background mail drain retries soft-failed deliveries with exponential backoff (up to 8 attempts) before marking a row non-retryable.
- Bounce detection's IMAP/NDR parsing now handles more character sets and additional MTA formats (Postfix, mailhop, Synology) reliably.
- "Also verify bounce" now explains what it tests in plain language, and a bounce result translates the SMTP code into a plain-English explanation.
- Send test email and bounce-probe messages now use a simple branded HTML template (organisation/event logo, a Transport OK mark) instead of a plain message.
- Health check accuracy improved across mail queue status, Redis/rate-limit labeling, encryption status in development, and live-probe behavior for SMTP, Microsoft Graph, and Power Automate.
- Settings fields managed by environment variables now show a compact "From environment" badge in the card header instead of a long inline label or a separate redundant banner.
- Delivery log table now uses the same responsive desktop-table/mobile-card layout, status badges, and pager as Attendees/Reports.
- Inline warning/notice boxes across the admin UI now consistently use the same styled component, fixing several that silently rendered with the wrong color due to undefined CSS variables.
- Event Settings no longer has one page-level Save button; each card that needs saving (Basic information, Branding, Mail transport) now has its own Save/Reset.
- Admin topbar's scattered status icons (connection, mailer, role badge) are now two dropdowns: System status (one glanceable indicator, full detail for superadmins) and an Account menu (name, role, My account, Sign out).
- Check-in header no longer repeats the event title/date/location already shown in the sidebar; the server-connection indicator moved into the global topbar.
- Weather and maps requests no longer send placeholder emails like `@example.com` as the User-Agent contact, which providers were rejecting.
- Event list weather chips use °C or °F based on the operator's browser timezone rather than locale; the public ticket page always shows both units.
- New event dialog now matches the Add attendee pattern (icon title, shared field styling); the Link name field explains it's a permanent ID used in agency ticket links and can't change after creation.
- Event list/picker cards (shared between admin and operator) now show a static map preview or a "No location" / "Maps unavailable" placeholder, date, status badge, attendee count, and location line; default map tiles are OpenStreetMap unless overridden.
- The Location tab's Address card now matches the design mockup: one card for search + map + an always-visible structured address grid, with a timezone-mismatch notice and Google/Apple Maps links that include the venue name.
- Public ticket page redesigned to match the mockup: Admitto branding, official Apple/Google Wallet badges, a two-line address layout, and accessibility icons.
- The admin/operator sidebar is simplified and unified across every instance shell — the desktop collapse-to-icon-rail is removed (sidebar stays fully expanded), tablet-portrait shows a persistent icon-only rail that expands on tap, `/account` now uses the same sidebar chrome as the rest of the app, the brand mark now also shows in the mobile/tablet topbar while the nav drawer is closed, and "My account" is removed from the sidebar footer (still reachable from the topbar user menu).
- Edit user modal redesigned to match the design mockup: a single Role selector replaces the old multi-role list (a person holds exactly one role type at a time, with organization/event scopes still cumulative within it), plus self-service SSO unlink, a real Recent logins list, and quick actions grouped into a More actions menu.
- "Sessions" and "Bulk revoke operator sessions" moved from Organisation settings → Security into a new "Active sessions" tab under Users & roles, with the same table/pagination/search conventions as the rest of that page; staff role labels (Superadmin/Administrator/Operator) are now consistently capitalized and spelled out everywhere.
- My account page redesigned: a two-column Profile layout, a read-only Sign-in row showing password/SSO status, and side-by-side Password/Two-factor authentication cards with a clearer TOTP enrollment flow.
- Reports' admission log, "By operator" breakdown, and exports now attribute each check-in to the authenticated operator who performed it, not just a self-declared device label.
- Health check's File storage row now actively probes the local uploads directory (writable/searchable, live write test) instead of assuming it's fine.
- Prisma upgraded from 5.22 to 7.9.1 across all workspace packages — driver adapters are now mandatory, the generated client moved to a repo-local path re-exported from `@admitto/db`, and connect/idle pool timeouts are set explicitly so an exhausted pool fails fast instead of hanging.
- Organisation settings → Archiving tab redesigned: Active/Archived is one toggle instead of two permanently stacked tables, each view paginates, and the empty state and mobile layout match the rest of Settings.
- Admin SPA now code-splits by route, cutting the initial JS bundle by roughly 60% (each page loads on demand instead of one large entry chunk).
- Check-in's item hand-out list ("Items to hand out") is now labeled and shows each item's admin-written description, and the hand-over button reads "Mark issued" / "Mark given" as an attestation rather than an instruction.
- Requirements → Event items: new events start empty except an always-present "Badge" item (auto-backfilled for legacy events); Badge can't be deleted, only disabled, and the "Issue badge at entry" toggle now always stays in sync with Badge's own Active / "Issue on check-in" state so the two settings can't drift apart.
- Requirements → Event items list and edit modal redesigned: items show their icon, the options textarea for select-type fields supports multi-line entry, edits open in a centered modal with focus trap and inline validation instead of a side drawer, and Active-toggle changes confirm with a toast.
- Check-in camera viewfinder (desktop) shrank from a full-width video panel to a QR-sized square matching the design mockup, hides once a scan result is showing, and the header/toolbar now reads "Disable camera" while active.
- Check-in sidebar (desktop) and the operator mobile camera overlay both realigned to the design-system mockup: Recent scans is no longer hidden on phones, rows are now clickable to reopen that attendee's card, the scan result on mobile is a full-color status card, and mobile Manual search is now a full-screen live-search view.
- Check-in scan bar's hint text now describes what actually happens in plain language instead of technical "keyboard wedge" jargon, and pressing Enter on a pasted/typed ticket token, URL, or agency QR code now correctly tries a scan before falling back to a name/email search.
- Attendee Detail's actions are reorganized: Revoke pass and Revoke check-in are consolidated into one red Revoke button with a small menu, Revoke items and Delete attendee live in the More actions menu (which also absorbs Edit below the 768px breakpoint), and Restore pass now goes through its own confirmation dialog instead of applying immediately.
- "Registration" renamed to "Pass" on the Attendee Detail page's status strip, for consistency with the rest of the app.
- Overview page's KPI tiles now share consistent sizing with Reports' stat tiles, stop wrapping awkwardly at tablet widths, and use the same segmented-control and contrast conventions as the rest of Instance Settings.
- Requirements' "Event behaviour" card is renamed to "Check-in behaviour" for clarity.
- Event Settings reorganized from one long scrolling page into tabs: General, Location, Ticket types, Images, Mailing, Wallet, Integrations, and Danger zone.
- Unhandled API errors now return a structured JSON error instead of a plain-text "Internal Server Error".
- "Settings" renamed to "Organisation settings" (sidebar nav and page heading) to avoid confusion with the per-event "Event settings" page.
- Staff admin content now fills the full width beside the sidebar on wide monitors; a few intentionally narrow surfaces (operator check-in, auth forms) keep their own width.
- Settings → General gained an "Organisation branding" card so superadmins can update the organisation name and logo after setup without redoing the wizard.
- Filter and picker dropdowns across Audit/System logs, External services, Attendees, and Reports are now searchable comboboxes, matching the rest of the admin SPA.
- Creating an event opens Overview instead of the Attendees list, matching the rest of the staff app's landing for an event workspace.

### Fixed

- My account Profile: the SSO menu no longer stretches the card header; Connect / Unlink SSO floats over the page like other staff menus.
- Public HTML 404/500 pages use one branded Admitto card (status code + short generic copy) instead of a bare error page; global unmatched paths skip the branding DB lookup so junk URL floods cannot hammer settings reads.
- Revoked or cancelled public ticket links show the branded ticket card with a clear notice (no QR, wallets, or map).
- Ticket types row: preview badge, attendee count, and delete sit on the right again.
- Health check: Address lookup (Nominatim) stays available when Maps is off; Wallet placeholder says Coming in v0.5.
- External services Save no longer greys out and flashes every input while Save runs.
- MFA code entry no longer triggers Chrome accessibility warnings for an orphaned label on the digit group caption.
- Location settings stay editable when map tiles are off or fail to load; venue search, directions, and accessibility notes remain available and the map is replaced with the existing "Map display is disabled" notice. Event list cards with a pin but no preview image now say "Preview unavailable" instead of "Maps unavailable".
- SSO sign-in now re-syncs the account's display name and phone number from the identity provider on every login (not just the first), while a superadmin's manual edit in the Edit user modal still takes precedence; a one-time backfill repairs accounts left stale by the old behavior.
- Event item / ops-config admin API now retries on wrapped Postgres serialization conflicts (`40001`/`TransactionWriteConflict`), not only Prisma's `P2034` code, instead of failing the request outright.
- The bounce-ingest System Logs POST now aborts after 2 seconds so a hung app can't stall the mailbox poll.
- Audit log now shows friendly labels for bounce detection and other previously unmapped actions instead of raw snake_case values.
- Edit user modal: Role & access Add/chip-remove buttons now disable while a profile save is in flight; a role-type change now closes the modal on success instead of leaving stale chips visible; `useOverscrollBounceGuard` now re-attaches once a dialog's scroll element actually mounts; and `useDropdownMenu`'s upward-flip check now accounts for a clipping ancestor (e.g. a modal's own scrollport), not just the viewport.
- The "Also verify bounce" test no longer reports success based on an older hard bounce for the same address still sitting in the 14-day IMAP window.
- "Also verify bounce" now returns a failed probe result when the bounce mailbox can't be opened, instead of a generic server error.
- Bounce detection now matches NDR recipient addresses case-insensitively, so an attendee like `John.Doe@Example.com` is still marked bounced when the MTA reports lowercase.
- "Also verify bounce" no longer reports a false timeout when the bounce-ingest sidecar already processed the same mailbox UID; the probe now examines messages in its own session.
- "Also verify bounce" now treats a brief IMAP disconnect as a retry instead of returning a generic 500.
- Event Mail tab Save no longer skips a pending bounce-settings save when only the "Revert to organization" confirmation dialog is open on the mail card.
- The bounce detection panel now refreshes after saving the Mail card, so switching to Dedicated SMTP unlocks "Use SMTP username & password" without a full page reload.
- "Also verify bounce" now keeps one IMAP login open for the whole wait instead of reconnecting every few seconds, avoiding provider throttling and false timeouts.
- The bounce-ingest sidecar now rejects an invalid `BOUNCE_INGEST_INTERVAL_SECONDS` (empty, zero, non-integer) at startup instead of spinning or exiting silently.
- Send test email now stamps each transport test with a unique subject/body, so SMTP relays that suppress duplicate sends actually deliver a repeat test.
- Attendee Detail → Delivery history (and its Delivery details modal) now shows send times in the actor's browser timezone, always lists the recipient as `→ email`, uses a compact status-tinted row instead of three stacked full-width lines, drops the raw SMTP/error code from the row (kept on the Raw fields tab), and scrolls within a fixed-height panel with compact sent/bounced icon counts in the header.
- Bounce NDR parsing no longer lets an unrelated trailing paragraph (e.g. a confidentiality disclaimer) leak into the stored bounce reason, and now decodes HTML entities correctly.
- Resend/bulk send now returns a clear operator message instead of a bare "Internal Server Error" when the mail destination can't be resolved or resolves to a private address (SSRF guard); local lab SMTP on RFC1918 addresses still needs `ALLOW_PRIVATE_MAIL_DESTINATIONS=true`.
- `ALLOW_PRIVATE_MAIL_DESTINATIONS=true` is now honored at mail-config validation too, so a lab SMTP host given as a literal RFC1918 address (not just a hostname) can be saved.
- Delivery log fixes: Search now also matches a delivery's own recorded recipient email (not just the attendee's current profile); Export log now uses the same debounced search value shown on screen; the Delivery Details modal labels each timeline step from its own recorded purpose instead of guessing by row position; and a failed delivery-log load now shows the standard inline EmptyState + Retry.
- A deleted custom mail template's past sends could no longer be told apart from default-template sends, since `template_id` is nulled on delete; a new `EmailDelivery.template_label_snapshot` column now preserves the template's label at send time everywhere it's shown, exported, or filtered, backfilled for existing deliveries.
- Event Settings → Mailing no longer shows two independent page scrollbars when switching mail transport provider.
- Instance Settings → Identity provider and Cloudflare Access editors now open as modals over the list instead of a separate page — the list stays visible and refreshes in place on close, deep links still open the right modal, and the discard-unsaved-changes guard, Discover/Test connection, and env-locked fields are preserved. Each provider row shows an icon tile distinguishing OIDC from Cloudflare Zero Trust, `/login`'s SSO buttons show a neutral shield icon instead of a Google logo, and a disabled toggle shows a dimmed overlay instead of misleadingly rendering as "off".
- `Tooltip` is now a single shared component used everywhere in the admin SPA; on narrow viewports it falls back to above/below instead of rendering off-screen, and the Mail transport tile grid's clickable area now fills its full grid column.
- The Attendee Detail header no longer repeats the attendee's name in a redundant breadcrumb, now shows a purpose subtitle under the title, and "Resend ticket" is a proper button instead of a text link.
- Resend ticket (single or bulk "Send tickets") now shows a clear inline message instead of a raw "Internal Server Error" when no mail transport is configured for the event or organization.
- Instance Settings → Mail transport panel is redesigned: sections use a two-column grid, the SMTP option is labeled "SMTP (recommended)" instead of naming an internal vendor, TLS/STARTTLS sit side by side, SMTP tuning fields live behind a collapsible "Advanced tuning" section, secret fields show a masked value with "Change"/"Clear" actions, "Send test email" is disabled with a tooltip until a transport is saved, and a persistent result panel shows a simulated "mail preview" with status/timestamp/provider/message ID.
- Archived events now grey out all mutating admin controls across Attendees, Requirements, Communication, and Import (not just check-in), while read-only actions like exporting and viewing stay enabled.
- Topbar connection/mailer status indicators are now compact colored icon badges instead of text pills that didn't fit narrow viewports, and the connection badge now shows in every state instead of disappearing when the connection degrades.
- Users & roles: inviting or editing a staff account now validates the email format client- and server-side, and the Active status badge now renders green instead of incorrectly falling back to gray.
- Weather/Maps connection-test toasts no longer show raw machine codes like `invalid_base_url`; operators now get clear URL guidance instead.
- Venue search, date picker, and timezone panels now use `position: fixed` so they no longer get clipped or grow scroll height inside the New event modal.
- Location map pan/zoom no longer relocates the pin on a single click; only a double-click drops or relocates it, and zoom-only changes no longer re-center the map on the pin.
- Restoring Location "Verified" status now works when only `geocoding_provider` is sent, instead of the PUT rejecting it as an empty patch.
- Static map attribution text now stays readable on dark custom tiles via a light text outline, and malformed tile URLs containing userinfo are now redacted in error logs instead of leaking credentials.
- Location pin provenance is now always visible: the Address footer shows "From OpenStreetMap" or "Set manually" depending on how the pin was set, empty fields show "Not filled" instead of a bare dash, and re-selecting the same map pin persists provenance so status survives reload.
- `GET /m/{eventId}.png` now retries the tile composite once, then serves a cached "Map unavailable" placeholder instead of an empty error when static map tiles are down; a public ticket map failure now shows the same "Map unavailable" message instead of a broken image icon.
- Static map attribution is now burned into the PNG only (removing a duplicate HTML credit under the ticket image), strips all HTML tags from the configured attribution text, and the cache-buster now includes map zoom so a zoom-only Location save no longer leaves mail clients showing a stale image.
- Ticket venue/date meta now stays centered with the pin inline instead of drifting for long wrapped names, and long address tokens wrap instead of overflowing.
- `{{event_address}}` / "Getting there" no longer repeats a name-only venue when a richer formatted address is stored.
- The static map image is now omitted from ticket pages and `{{event_map_url}}` when maps are disabled, instead of embedding a link that always 404s; Google/Apple Maps links still work when coordinates exist.
- Static map tile downloads now abort once they exceed 512 KiB, preventing a misconfigured or malicious tile server from forcing unbounded memory allocation on the public map route.
- Renaming a venue as free text no longer restores a stale "Verified on OpenStreetMap" badge.
- Street addresses for large venues (stadiums, hotels) now reliably get a house number via improved label merge and re-run reverse geocoding when the street line has none.
- The Location tab now keeps the map pin when you edit the venue display name, with related hardening: a failed/empty reverse geocode after a pin move no longer pairs old address data with new coordinates, and the map is disabled during save.
- Picking a venue suggestion now applies the pin and name immediately and enriches the address grid in the background, so saving during that lookup no longer persists only the typed query.
- Location tab map zoom is now persisted to the draft via the Leaflet zoom controls, the Nominatim usage-policy notice shows as soon as the tab loads, venue search results use a shorter format, and clicking or dragging the map pin reverse-geocodes the point while preserving a name already typed.
- Event Overview's Pinned note, Key contacts, and Important links & files cards now use `@admitto/ui`'s real components instead of unstyled raw HTML; the duplicate "Event date" KPI tile is replaced with a "Failed delivery" tile, all four KPI tiles get an icon, and the Attendees KPI's "Registered" sub-label is renamed "Active" and no longer flashes the wrong total while loading.
- A `check_in_revoked` activity log entry now shows a proper icon/label and the event's local timezone instead of the raw action string in UTC.
- Opening any dropdown-menu popover no longer jumps a scrolled page, and a panel opened near the bottom of the page now flips above its trigger instead of rendering off-screen; a Filters button's tooltip no longer stays open once its panel is open.
- Users & roles' search, filter, and picker dropdowns (Role/Status, Event, Sign-in method, bulk-revoke Event picker, Role) now use a consistent searchable combobox instead of plain `<select>` elements, filters moved behind a shared Filters button, and the toolbar/search boxes no longer show a doubled focus ring or mismatched control height.
- Users & roles mobile layout is decluttered: Edit/Reset-sessions/Revoke actions moved into small icon buttons in the card header, the detail grid no longer collapses to a single column, "Invite user" stays beside the title at compact size, and Search/Filters share one row when there's room.
- Edit user modal: Role picker, scope picker, and Add/Change button now sit in one row instead of stacking; clearing a phone number and saving no longer silently keeps the old value; "Unlink SSO" moved into the More actions menu and shows (disabled, with a reason) for local-only accounts; footer Save button is labeled "Save profile" with a hint that Role & access changes save immediately and separately; and Recent logins now filters by the target's exact user ID instead of a fuzzy email match that could surface another account's logins.
- Role assignments gained an event filter (superadmin/admin only) and its Granted column now shows both UTC and the viewer's local time.
- A staff account with no usable role assignment now lands on My Account with a clear "no role assigned" notice instead of being silently redirected back to a blank sign-in form.
- Staff user role badges now show the full role name instead of two-letter codes, the Disabled status badge uses higher-contrast color, revoking a role now refreshes the Staff users list and any open Edit modal immediately, and the rows-per-page picker only offers 25/50 (matching the API's actual cap).
- The Invite user modal dropped the disabled, unwired "Send invite email" switch, and both Invite user and Reset password now show an "At least 12 characters" hint matching the enforced password policy.
- OIDC group sync now retries transaction conflicts more patiently, so two superadmins losing a mapped group at the same time no longer fails concurrent logins.
- Staff timestamps that were bare UTC now show the correct local zone where known across Mail Send test, Account → Sessions, Event Settings/Overview, Health check, and Audit/Security logs.
- The shared `Tooltip` component's trigger is now reachable by keyboard and announced to screen readers even when its content has no focusable element of its own.
- The Archiving tab's creator/archiver backfill was missing from the production migration entrypoint, so a real deployment's pre-existing events would have kept a blank creator/archiver; caught and fixed before release.
- The Users and Attendees pages had the same unconditional page-reset bug as the Audit log: their search-box debounce reset to page 1 on every mount even when the search term hadn't changed; all three now no-op when it's unchanged.
- The 6-digit MFA code entry on the login screen no longer overflows narrow phones.
- Branding tab fixes: an upgrade from the old single-file font format now converts on first read instead of losing the font; a crafted theme request could smuggle CSS-breaking characters through a "local" font path into the public ticket page's CSS, now blocked; built-in fonts without a real italic file no longer show a misleading real-italic preview; concurrent re-uploads to the same row no longer risk an older upload overwriting a newer one; an org at the font-family limit now sees a locked "Limit reached" tile; and a custom family can no longer be saved under a built-in font's name.
- Borders weren't rendering in several places because two CSS custom properties were referenced but never defined; all occurrences now use the existing design-token border color.
- Instance Settings → Security → Audit log: expanding a row's Details no longer pushes rows below it down, a UTC/Local toggle was added for the Time column, and Previous/Next no longer jump the page to the top of Settings.
- Instance Settings → Logs: the Security audit log is folded into the same System/Audit/Security toggle instead of a separate stacked card, reusing Audit's toolbar/filters/search/pagination/mobile-card conventions; Security gained its own superadmin-gated "Export logs" CSV button, and all three views gained a Live/Paused toggle with a degraded-connection banner.
- OIDC/SSO login could fail closed or silently extend a single-use token's validity for hours depending on the database server's session timezone; the lookup now always compares against UTC regardless of the database server's local clock.
- Health check's version/commit now matches the sidebar by reading the actual running staff SPA build instead of live git state.
- Attendee PDF export now truncates long emails with an ellipsis instead of wrapping mid-word and overlapping the next row.
- Check-in's "Manual lookup is disabled for this event" message now fires as a toast instead of a persistent inline banner.
- Check-in's connection-loss UI no longer shows up to three overlapping "you're offline" indicators at once, and a stale "Request failed" banner now clears itself once the connection recovers or a different lookup succeeds.
- Every screen that reads the ticket-type catalog now shows an inline error with Retry if the fetch fails, and shows a type's real label and color instead of its internal key throughout exports, search, and the live check-in feed.
- Ticket-type catalog hardening: a type can no longer be deleted while still assigned to an attendee mid-request; creating or renaming a type to a label already used in the same event is rejected; switching events no longer briefly shows the previous event's types; and a database-level constraint now backs up the existing application checks.
- The public ticket page rendered with no visual styling for every attendee on every event, since it never loaded the design-token stylesheet; every affected style now carries an inline fallback.
- A UX polish bundle: the Attendees table now shows a skeleton on first load and dims existing rows during a re-fetch, the check-in scan bar's submit button is now a proper touch target, and `prefers-reduced-motion` is respected across several animations.
- Check-in (desktop) with "Auto-advance after valid check-in" on no longer clears an attendee's card instantly when they have hand-out items configured, matching the mobile overlay.
- Recent scans sidebar now shows a distinct "Undone" or "Revoked" row for a reversed check-in, instead of leaving it shown as a permanently green "Checked in" row; "Revoke check-in" is hidden once the attendee's pass itself has been revoked; and revoking a pass now also auto-clears any current admission in the same transaction.
- Check-in attendee search no longer matches on company or department, only name and email.
- Archived events now fully lock down check-in: excluded from the operator's check-in event list, every check-in route returns 403, and the emergency ops CLI enforces the same check; archived events remain reachable from the events picker (Overview/Settings still open) with a distinct "Archived" card style, and archiving/unarchiving now takes effect immediately across every page without a reload.
- Event Overview no longer crashes when ticket-type breakdown data is missing from an older backend's response.
- Communication template Preview images now load correctly on a local dev instance.
- Product brand SVGs now ship in the production container image again, fixing 404s on deployed containers.
- Organisation and event logos now keep the full pre-crop upload and last crop/zoom framing, so "Edit image" reopens the adjust popup after a refresh instead of forcing a new file pick.
- Storage garbage collection now rechecks file references immediately before each delete so a concurrent save can't lose a newly referenced upload.
- Event timestamps now show an unambiguous numeric UTC offset instead of locale-dependent abbreviations like `CEST` or `IST`.
- Signing in as an admin or superadmin and landing on `/operator` now redirects straight to `/admin`.

### Security
- Weather (Open-Meteo / MET Norway) and Nominatim geocoding fetches refuse HTTP redirects (`redirect: "error"`), so a public base URL cannot 30x the process into loopback/private/cloud-metadata addresses after the save-time host check. Open-Meteo also refuses to attach an API key to a non-HTTPS base URL.
- Public `/uploads/*` now serves only branding assets (other file types return 404); async filtered-export jobs scrub the raw search query from stored job results once finished.
- `nanoid` constrained to `^3.3.17` (lockfile resolves `3.3.18`), fixing a high-severity infinite-loop flaw (GHSA-2v37-7h3g-55p8).
- Event-level dedicated mail transport (SMTP/Power Automate) closed several SSRF and credential-leak paths found in a security review: it now requires superadmin (matching organization-wide Mail settings) instead of any event admin, can no longer silently reuse the organization's SMTP password/API key while pointing at a different server, and every destination (SMTP host, Power Automate URL, bounce-detection IMAP host) is checked against a private/loopback/cloud-metadata blocklist and DNS-pinned at connect time, closing a DNS-rebinding gap.
- Bulk ticket send/resend now records which admin triggered it directly on the delivery row instead of a best-effort log write that could silently drop the attribution.
- Attendee detail no longer decrypts and exposes a bearer ticket token preview the admin UI stopped rendering long ago.
- Weather/geocoding base URLs and static map tile fetches are now checked against the same private/loopback/cloud-metadata blocklist before use; tile fetches reject SSRF-prone redirects, validate PNG magic bytes, and redact any credentials embedded in a custom tile URL from failure logs.
- Several role-management authorization gaps closed: a superadmin can no longer strip their own role, switch their own role type, or unlink their own SSO; a role-type switch now re-authorizes and re-checks IdP-managed protection for every assignment it implicitly replaces, not just the new grant; and unlinking a JIT-provisioned SSO account's only sign-in method now requires setting a new password in the same step so the account can't be locked out.
- `X-Forwarded-For`/`-Host`/`-Proto` are no longer trusted from any direct connection once `TRUST_PROXY=true` — the request's direct peer must also match a new `TRUSTED_PROXY_CIDRS` allowlist (loopback-only by default) before those headers are honored, closing a rate-limit/CSRF/cookie-security bypass.
- Delete event's zero-activity guard (7 independent signals) is re-validated server-side on every request, never trusting the client's hint, and requires typing the event's exact title to confirm.
- Self-service account actions (password change, MFA enroll/reset, session revoke) are now recorded in the admin audit trail.
- Fixed a self-lockout where enrolling MFA from Account settings while already logged in could silently break the current session.
- Resetting your own 2FA or changing your own password now requires a current authenticator/backup code (not just your password) for accounts whose role requires MFA, closing a password-only-compromise path to strip MFA or lock out the real owner; MFA verify rate-limit buckets are now namespaced per action so one self-service flow can no longer rate-limit an unrelated one.
- Creating a staff account now checks for a duplicate email before running the password hash, so a flood of duplicate-email requests can no longer be used to burn CPU and slow down other users' logins.
- The production Docker image no longer runs as root; a new one-shot `migrate` service handles pre-migration backups and schema migration, and the main `app` container now starts directly as an unprivileged user with no filesystem access to backups.
- Trusted-device ("remember this device") enrollment is now recorded in the audit trail, and 5 consecutive failed logins against the same admin/superadmin account now raises a repeated-failures alert in System logs.
- Sessions now enforce an idle timeout in addition to the existing absolute lifetime (admin: 30 min idle / 12h absolute, down from 7 days; operator: 2h idle / 12h absolute), configurable under Settings → Security, which now also warns inline when a lifetime or idle value is set unusually high.
- Password fields now reject the ~250 most common passwords and trivial patterns (repeated/sequential characters) server-side across every place a password is set, per NIST guidance; the strength meter shown while typing scores length and character variety instead of rewarding predictable substitutions like `P@ssw0rd1`.
- `npm run dev` for the web app no longer binds to every network interface by default (localhost only, unless a local HTTPS cert is present for LAN camera testing); production is unaffected.
- Attendee list/detail/export responses (including CSV/PDF/XLSX) now send `Cache-Control: no-store` so a shared cache or browser can't retain personal data longer than intended.
- Attendee search gained a rate limit (120 requests/minute per user per event) — previously unlimited, unlike neighboring import/export endpoints.
- Ops System Logs ingest now rejects credential-bearing field names so a buggy sidecar can't land secrets in the live-tail buffer.
- Admin SPA migrated from `react-router-dom` to `react-router` v8, resolving a high-severity advisory (GHSA-qwww-vcr4-c8h2) flagged by `npm audit` (not actually exploitable in this app's usage, but no patched version existed in the old package).
- Bumped `svgo` and `brace-expansion` (build/test-only dependencies) to fix high-severity `npm audit` advisories.
- Staff email format validation no longer risks a slow backtracking regex on operator-submitted input (polynomial ReDoS).
- Branding image uploads are re-encoded on the server (stripping EXIF/IPTC/XMP metadata); only decoded pixels are written to storage.
- Admin API error responses across the SPA and the Identity JSON API no longer forward raw server error detail to the client; unexpected errors return a generic code with full details logged server-side only.
- Every `/api/*` JSON response now carries baseline security headers (nosniff, X-Frame-Options, Referrer-Policy, HSTS) at the application layer, not only the ops health-check endpoints.

## [0.4.12] - 2026-07-06

### Added
- Vitest code coverage (`npm run coverage`) across workspaces with LCOV upload to Codecov on CI — reporting only, no coverage gate yet.
- CI PR pipeline shortened: lint merged into `build-test`, Semgrep and Docker build smoke run on `main` merge (not every PR); `SECURITY.md` documents when each control runs.
- Identity providers + Cloudflare Access JSON API (`/api/admin/identity/providers*`, `/api/admin/identity/cf-access*`) for the SPA Settings → Identity migration: list, get, create, update, toggle, discover, test, and CF Access get/update/test endpoints. Reuses `@admitto/auth` logic unchanged; gated by `requireAdminAccess` (superadmin) to match the legacy HTML routes. PUT contract: `mappings` is required on every PUT (replace-all, mirroring the HTML form; omitting it returns `mappings_required` so editing other fields can never silently delete mappings) and omitting `login_button_label` preserves the stored value (`null`/`""` clears); create defaults omitted `mappings` to `[]`. `mappingSchema` enforces `scope_id` for `organization`/`event` scopes. Toggle uses a conditional `updateMany` and returns `409` on a concurrent toggle (TOCTOU-safe). CF Access `test` endpoint shares the `adminAuthProviderOpsRateLimit` bucket with OIDC discover/test. Schemas use `z.strictObject()` (zod v4). Legacy HTML routes remain until the SPA editor lands (#266).
- Settings → Identity & SSO SPA overview (#266 slice 2): new `/admin/settings/identity/*` routes under the existing `InstanceSettingsShell` render the OIDC providers list (with optimistic enable/disable toggle) and a Cloudflare Access summary card. The Settings "Identity" tab and the legacy `?tab=identity` query now hand off to the canonical `/admin/settings/identity/providers` route, keeping the SPA shell consistent instead of jumping to raw HTML. Add/Edit provider and CF Access Manage still bridge to the legacy HTML editors until the SPA editor lands in slices 3–4.
- Identity provider SPA editor — Basics, Endpoints, Claims, login button label (#266 slice 3a): new `/admin/settings/identity/providers/new` and `/identity/providers/:providerId` routes render a full form editor under the SPA shell. Create POSTs a new provider; edit loads by id and PUTs the full form (mappings carried through unchanged until the repeater lands in slice 3b). Client-side validation mirrors the slice-1 Zod contract; the stored client secret is preserved on edit when left blank; a dirty guard warns on navigation. The providers list Add/Edit actions now SPA-navigate to these routes instead of the legacy HTML bridge.
- Identity provider SPA editor — group→role mapping repeater, Discover/Test, SSO preview (#266 slice 3b): the editor gains an editable mapping repeater (add/remove rows, role + scope selects, conditional scope_id) with replace-all save semantics; Discover autofills OIDC endpoints from the issuer's `.well-known` config and Test probes the connection (edit mode only, both with 401 routing to login); a live SSO login button preview reflects the custom label or the product default. Mapping validation (group required, scope_id required for organization/event scopes) blocks save with inline row errors.
- Identity provider SPA editor — draft test and discover in create mode (#266): `POST /api/admin/identity/providers/test` and `POST /api/admin/identity/providers/discover-preview` are stateless endpoints that probe OIDC connectivity and autofill endpoints without requiring a saved provider record; Discover and Test connection are now available in create mode (previously edit-only). Partial endpoint sets (fewer than all three of auth/token/jwks) fall back to discovery so the test always reflects the same endpoint resolution as save. Issuer URL is validated against the same SSRF guard as the save path before any explicit-endpoint test. Save and Cancel buttons are disabled while discovery is in flight; stale discover and test responses are silently discarded when the issuer or endpoint draft diverges mid-flight.
- Cloudflare Access SPA editor (#266 slice 4): new `/admin/settings/identity/cloudflare` route renders the CF Zero Trust config editor under the SPA Identity sub-tab, replacing the slice-2 placeholder. Edits team URL, Application Audience (AUD), and protected URL paths (comma-separated lists), toggles enabled, and Test connection probes the team domain's JWKS endpoint (sends the draft team URL so operators can test before saving). Per-field env locks disable the locked inputs and show a "Locked by env" badge; the PUT body omits locked fields so the server keeps the env-managed value. A dirty guard (router `useBlocker` + `beforeunload`) and 401 routing to login match the OIDC provider editor patterns. The Identity overview "Manage" action now SPA-navigates here instead of bridging to the legacy HTML editor.
- HTTP access log on `app` container stdout (`LOG_HTTP_REQUESTS`, on by default in deploy compose): one JSON line per request with method, redacted path, status, and duration — no IPs, query strings, or ticket/QR tokens; successful health probes are skipped. Documented per-container log expectations in `deploy/README.md` (#237).
- Password strength meter on first-run `/setup`, forced `/change-password`, and admin Account password change — text label plus segmented bar (not color-only); confirm fields show match feedback on setup and change-password pages (#226).
- Overview page: per-event **Pinned note** — short operational sticky visible to all admins; editable inline, highlighted in the right column (#291).
- Overview page: per-event **Key contacts** — list of on-site contacts with name, role, phone and email action links; add/edit/delete inline (#291).
- Overview page: per-event **Important links & files** — list of linked documents and URLs with title and optional description; add/edit/delete inline, shows first 4 with "View all" toggle (#291).
- Audit log: all mutations to pinned note, key contacts, and important links are recorded in `AdminAuditLog` with actor, session, IP, and action type — visible to superadmins in the Audit viewer (#291).

### Changed
- Settings shell unified for Identity IA (#266 slice 7b): `SettingsLayout` wraps `/admin/settings/*` so the primary tabs (General | Mail | Security | Archiving | Identity) remain visible on the Identity overview and on all detail views (add/edit provider, Cloudflare Access editor). The second tab row (Providers | Cloudflare Access) is removed — Identity overview is a single page with both cards. The `?tab=identity` legacy query still redirects to the canonical `/admin/settings/identity/providers` route. Editor dirty guards (`useBlocker`) still trigger when switching primary tabs or leaving detail views.
- Docs: sync CI/security narrative (Semgrep on `main`, Codecov data note, required merge checks), fix stale deploy examples (Node 24), README documentation map, identity SPA status in admin README, contributor coverage commands.
- Overview page: redesigned as an event command center — "Quick actions" nav grid removed; new two-column layout with Needs attention alerts (email failures, queued tickets, missing operators), Event readiness checklist (attendees, tickets, delivery, operators), Email delivery breakdown, live Recent check-ins feed (SSE), and compact Event info block (#276).
- Account page: sidebar nav structure now consistent with AdminShell — "My account" link is in the nav area (not the footer), back link stays in the footer; empty aria-hidden placeholder div removed (#267).
- Reports: tile/panel spacing is now correct — `--space-md/sm/lg` and `--surface-elevated` were undefined tokens resolving to 0/transparent; replaced with `--space-4/3/5` and `--surface-sunken` throughout `reports-page.css`. Progress bars in "By ticket type" use `--primary` consistently (removed threshold-based traffic-light coloring that flagged <50% admission as a warning at the start of every event). Hourly chart is accessible by keyboard and screen reader — bars have individual `aria-label` with hour and count; `role="img"` removed so the accessibility tree is not flattened (#269).
- Topbar: mailer status indicator now uses the shared `Badge` component (pill with dot) instead of bespoke markup — visually consistent with every other status badge in the app; label still hides at narrow viewports (#275).
- Check-in: `AttendeeCard` status display now differentiates positive, warning, and blocking-error states — VALID/PREVIEW show status inline in the identity header; ALREADY_CHECKED_IN uses a compact warning strip; REVOKED/INVALID show a unified tinted alert block with status and reason text merged into one message. Item action buttons (Give gift bag, Return headset) use chip-matching geometry without a border or background (#270).
- Toast notifications: unified design-system stack (Tabler icons, deduplicated messages, bottom-right placement); admin pages and settings panels use `useToast()` for save/load feedback instead of inline status text.
- Account page: profile, password, and MFA success/error feedback uses toasts instead of inline status text; locale-change reminder stays until dismissed (#239).
- Toast stack z-index sits below check-in camera overlay so mobile lookup warnings do not cover overlay controls.
- Setup wizard mail step: provider select order/labels, per-provider field grouping (SMTP username+port grid), and test-send row aligned with design mockup.
- First-run routing: unauthenticated staff entry (`/`, `/login`, `/admin`, `/operator`, and related HTML gates) redirects to `/setup` until the first user exists; login form is shown only after bootstrap.
- Setup wizard system check: allow `http://127.0.0.1` / `localhost` BASE_URL in production (local Docker smoke); non-loopback HTTP still fails.
- First-run mail wizard: ignore deploy env placeholders for field locks and test send until setup wizard completes (`setup_complete`).
- Setup SSR (`/setup`): mockup-aligned copy, login-aligned `autocomplete="username"` on email, confirm password, and `passwordrules` for password managers.
- Setup wizard shell: “Set up your instance” header, numbered stepper with labels, Continue arrow on primary CTA; custom date picker and timezone combobox; ready step summary chips.
- Password strength meter: jsdom test executes the generated inline script end-to-end (meter, aria-label, confirm match); shared sample passwords move to the `@admitto/auth/password-strength-fixtures` test-only export (#254).
- Settings page: the active in-page tab is persisted in the URL (`?tab=general|mail|security|archiving`, merged via `replace` so tab clicks don't stack history or wipe unrelated params) — Back from the Identity sub-section now restores the operator's tab instead of resetting to General (closes the #296 TODO); `?tab=identity` still redirects to the canonical Identity route. A SPA-side catch-all inside `/admin` redirects any unmatched `/admin/*` (including removed legacy `/admin/auth/*` URLs) to the events picker so old bookmarks/docs links don't land on a blank outlet (#266 slice 5).

### Removed
- Identity providers migration cleanup (#266 slice 5): the legacy server-rendered identity admin is removed — `/admin/auth/providers*` and `/admin/auth/cf-access*` HTML routes, their handlers (`auth-providers-routes.ts`, `cf-access-routes.ts`), the HTML renderers (`auth-providers-html.ts`, `cf-access-html.ts`), and the `renderAdminShell` sidebar + `SETTINGS_SUBNAV_ITEMS` + `ADMIN_PAGE_CSS` block in `shared-auth-styles.ts`. The SPA at `/admin/settings/identity/*` is now the only identity admin surface; the JSON API (`/api/admin/identity/*`, slice 1) is unaffected. The `cf-access-routes` integration test was retargeted from the deleted HTML routes to the `/admin` SPA shell (and `/api/admin/identity/providers` for the CF no-role 403 message); the `oidc-admin-routes` and `auth-providers-html` unit tests were removed with the code they covered. Docs/env examples and `security/SECURITY-CONTROLS.md` updated to reference Settings → Identity; the stale `/admin/auth` Vite dev-proxy rule was removed.

### Security
- Login and MFA pages (verify, enroll, backup codes) ship inline scripts gated by a per-response CSP nonce instead of `script-src 'unsafe-inline'` (MFA) or a policy that blocked them in strict browsers (login) (#253).

### Fixed
- Check-in: manual lookup no longer shows every guest as green "Ready to check in" — the result card now derives its state from the loaded card, so an already-admitted guest opens as **Already checked in** (with the entry time, no Confirm button) and a revoked/cancelled pass opens as **Revoked** immediately, with badge/gift-bag/headset issue actions disabled instead of failing after the click. Selecting a lookup result also clears the search query and result list (#379). The scan-bar typeahead's "checked in" hint could still show green for a guest whose pass was revoked after admission (a stale `admitted_at` with no status check) — `lookupAttendees` now excludes revoked/cancelled passes the same way `getCheckInStats` does, so the dropdown never contradicts the red Revoked card the operator sees on select.
- Check-in: the admitted / total stats now count **active attendees only** — revoked and cancelled guests (who don't consume capacity and aren't expected at the door) are excluded from both counts, matching the Overview KPI denominator; the sidebar label reads "expected" instead of "total" (#380).
- Admin: compact check-in timestamps (Attendees CHECK-IN column, Overview recent check-ins, check-in Recent scans) now show the **date + time** when a scan happened outside the event's calendar day (e.g. a test check-in weeks before the event), instead of a time-only value that looked like an event-day admission; comparison uses the event timezone via a shared `formatAdmissionDisplay` helper (#359).
- Admin: checkboxes were invisible across the SPA — the `Checkbox` component never rendered the visual `.at-check__box` element its CSS expects, so only bare labels showed (Instance Settings → Security "Require 2FA for roles" collapsed into an unreadable `superadminadminoperator` string). The component now renders the box + check icon, the MFA roles fieldset is a vertical group with human labels (Superadmin / Admin / Operator; API slugs unchanged), and disabled checkboxes get a distinct visual state for env-locked settings (#413).
- Communication: Delivery log no longer shows a successful SMTP/Graph send as yellow "Pending" with an empty Sent column — `accepted` status now renders as green "Sent" (ADR 0007 `accepted_only`: provider handoff is operator-visible success), `accepted_at` is included in the delivery DTO (API + SPA), and the Sent / Failed column and attendee drawer delivery list fall back to it when `sent_at` is null. The attendee list Mail column had its own duplicate status map (still yellow "Pending" for `accepted`); `MailStatusBadge` now delegates to the shared `resolveStatusMeta` so all mail-status surfaces stay in sync (#403).
- Admin: dialogs on the shared `.add-attendee-modal` shell (Send tickets, Add attendee, Communication send, Create template) no longer render with a transparent panel that let the page table "ghost" through — `var(--surface-raised)` was referenced but never defined in the token set (same class of bug as #286); replaced with `var(--surface-card)` here and in the other remaining usages (icon picker, setup wizard card). The modal panel border referenced undefined `var(--border-subtle)` and silently didn't render; now uses `var(--border)` (#357).
- Admin: modal and panel backgrounds (confirm dialog, note modal, create-event modal, attendee drawer, requirements, reports, users) were transparent — `var(--surface)` was referenced but never defined in the token set; replaced with `var(--surface-card)` (#286).
- Check-in: scan input stays enabled and queues submissions while a previous scan/lookup is still processing, instead of disabling the field and silently dropping keyboard-wedge keystrokes for the next attendee (#261).
- Check-in: duplicate-scan debounce and buffer-clear-on-accept are now measured at the moment a scan or manual-lookup query is accepted, not once it reaches the front of the FIFO queue — a slow first request could otherwise let a genuine duplicate through, or leave stale query text for a later wedge scan's keystrokes to land on (producing a corrupted, unmatchable scan payload). The mobile camera overlay's own manual-entry field had the same gap (no disabled state at all) and is fixed the same way. Auto-advance also no longer clears an unrelated, still-in-progress scan's buffer, and Confirm check-in, item actions, notes, manual-lookup select, and Undo now all queue behind an in-flight scan instead of racing it — previously a slower response from one of these could overwrite the card of an attendee scanned afterward, or (for Undo) roll back the wrong check-in (#277 review follow-up).
- Mail settings: `SMTP_HOST`/`MAIL_FROM_ADDRESS` left at their shipped `deploy/.env.example` placeholder values (`smtp.example.com` / `events@example.com`) no longer falsely report as "managed by environment" — Settings → Mail is editable for deployments that configure the transport from the admin UI instead of env (#264).
- Check-in: manual lookup no longer misfires as a QR scan for queries over 20 characters — this now covers pressing Enter/Search after slowly typing a long name or email (not just the auto-submit debounce timer) and any single-event bulk insert into an empty field (paste, browser autofill/autocomplete, drag-and-drop, IME composition, voice dictation), in addition to the original mid-typing case; wedge auto-submit still requires burst-speed keystrokes arriving one character at a time, not just buffer length. Burst detection also now uses the input event's own timestamp instead of wall-clock time at handler execution, so a busy main thread (e.g. an unrelated scan's response resolving) can no longer misclassify a genuinely fast wedge scan as manual typing (#262).
- Admin shell: entering an event from the events picker (or right after creating one) no longer re-fetches the whole events list and no longer flashes a blank spinner screen in place of the sidebar/topbar — the picker passes the already-loaded event along, so the event shell renders instantly; the passed-along event is consumed once and cleared from that history entry, so a later browser back/forward revisit still re-validates event access from the server instead of trusting a stale snapshot. Deep links and refreshes still resolve the event from the API as before (#274).
- Reports: hourly admissions chart and peak hour bucket check-ins in the event timezone — previously shifted by the UTC offset for non-UTC events (#268).
- Sidebar: unreleased lifecycle sections (Approval, Passes, Fulfilment, Post-event) render as plain disabled items — stale “Soon v0.4.9”-style release badges removed; placeholder pages drop internal jargon (#263).
- New events seed default event items (gift bag, badge, headset) at creation, so Requirements → Event items is populated before the first check-in (#238).
- Setup wizard step 1: Retry on failed check load, **Run checks again** after results, inline fix hints; single-column check list with status on the right (#223).
- Setup wizard system check: four rows like mockup (Database includes migration status; no separate Migrations row).
- Setup wizard steps 2–5: mockup parity — mail test row, branding logo zone/toasts, typed date picker, timezone list layout, ready screen footer; step labels no longer truncated (#243).
- Setup wizard: restore last step after browser refresh; unsaved-refresh notice only when a dirty form was lost (saved mail/branding kept).
- `POST /api/admin/setup/complete` requires passing system checks (409 `setup_not_ready` when checks fail).
- Mail transport test: actionable admin error messages for TLS hostname mismatch, auth, and port mode (no hostnames in API responses) (#244).
- Check-in: server-connected status moves to a compact page-header pill; full-width green banner only for connection problems (#234).
- Check-in: persistent screen-reader live region announces connection recovery after offline/degraded states.
- Check-in search fields: suppress password-manager autofill hints on scan bar and manual lookup (#231).
- Check-in manual lookup: warning toast when search returns no attendees (#232).

## [0.4.11] - 2026-07-02

### Fixed
- Redis rate-limit integration test: wait for fresh fixed window before asserting block (flaky `build-test` on `main` after v0.4.10)

## [0.4.10] - 2026-07-02

### Changed
- Remove instance-superadmin ceiling: multiple active `superadmin@instance` assignments are allowed; OIDC group→superadmin grants are no longer capped at one. The dropped index was redundant with the Serializable `user.count()` guard in `POST /setup`; first-run bootstrap protection is unchanged.
- Consolidate rate-limit factories into declarative policy registry (no behavior change)
- Centralize MFA enroll rate-limit constants in `RATE_POLICIES`; add registry edge-case and wiring tests
- Extract inline-only rate limits to `INLINE_RATE_LIMITS` (excluded from `RatePolicyName`; compile-time guard against `rateLimit()` misuse)
- Remove unused SSE message variant and stale nginx metrics location; fix dangling ADR links in deploy docs
- Docs: superadmin runbook for multiple instance admins and OIDC offboarding prerequisites (`security/SECURITY-CONTROLS.md`, `deploy/README.md`)

### Security
- Fix event-settings GET authz-order oracle (404→403 for cross-org probing of non-existent events); add defense-in-depth `assertEventManageAccess` to `handlePatchEvent` handler body (route wrapper already enforced scope); reduce QR image cache TTL from 24h to 5min
- Emergency CLI attendee export: enforce mode 0600 on overwrite; writable `emergency-exports` bind mount; reject `--out` under public `UPLOAD_DIR` or outside `EMERGENCY_EXPORT_DIR` when those env vars are set; reject `EMERGENCY_EXPORT_DIR` when it is a public alias under `UPLOAD_DIR` raw or realpath (including symlinked upload roots); require raw `--out` under raw `EMERGENCY_EXPORT_DIR` (not only canonical realpath); resolve symlinks before path checks; write via validated canonical path with `O_NOFOLLOW` (loop until full buffer is written)

### Fixed
- `POST /setup` maps Serializable transaction conflicts (`P2034`) to `409 already_initialized` when two first-run submissions race with different emails
- `bootstrap-superadmin --force` recovery path works after removing the single-superadmin partial unique index
- OIDC group-sync cannot revoke the last active instance superadmin (floor-guard with audit event `auth.oidc.superadmin_revoke_blocked`; Serializable transaction on active instance-superadmin revoke; inactive owners skip the floor check; retries `P2034` serialization losers so concurrent OIDC logins do not fail)

### Added
- CLI: `admitto` emergency ops binary (`apps/cli`) — checkin admit/lookup, attendees export, mail retry-failed, auth bootstrap-superadmin/reset-mfa, sessions revoke/purge, retention run
- Automated retention cron (auth sessions, mail delivery snapshots) and nightly pg_dump backup sidecar in deploy compose

## [0.4.9] - 2026-07-02

### Added
- Admin: Instance URL setting (Settings → General) for email logo absolute URLs when BASE_URL env is unset
- Backend: live check-in SSE at `GET /api/checkin/events/:eventId/stream` (operator/admin `canPerformCheckIn` auth)
- Backend: multiple email templates per event (`name`/`label`, CRUD under `/api/admin/events/:eventId/templates`)
- Backend: bulk send `POST /api/admin/events/:eventId/send` with `templateId`, recipient filters, and `dryRun` recipient count
- Backend: send batch status `GET /api/admin/events/:eventId/send/status/:batchId`
- Backend: per-template test send `POST /api/admin/events/:eventId/templates/:templateId/test-send`
- `EmailDelivery.template_id` foreign key to `MailTemplate` (delivery audit per template)
- Admin SPA: `useEventStream` hook for live check-in SSE with reconnect and auth-error heuristic
- Admin SPA: Check-in page live feed (prepend history, dedup, offline banner)
- Admin SPA: Event overview optimistic `admitted_count` from SSE
- Admin SPA: Communication page multi-template editor, bulk send dialog with dry-run and batch polling

### Changed
- Docs: align contributor roadmap in `AGENTS.md`, `README.md`, and `VERSIONING.md` (v0.5 ingest API → v0.6 Wallet → v0.7 RSVP); `AGENTS.md` points at `CHANGELOG.md` and the open GitHub milestone instead of a hardcoded active milestone

### Fixed
- Admin: corrupt uploaded logo files clear the upload value in LogoUploadZone and show an error; external HTTPS URLs keep the value for manual correction
- Admin: attendee resend and bulk resend use DB instance URL for ticket links when BASE_URL env is unset
- Instance URL validation rejects bare `?` or `#` delimiters (prevents malformed ticket and QR link paths)
- Admin SPA: event overview reuses check-in TTL dedup map for SSE admits (no full clear on server refresh; TTL prune on poll keeps map bounded)
- Admin SPA: communication page refetches inherited ticket template on each virtual-ticket selection (avoids stale legacy cache)
- Admin SPA: communication page clears editor actions after delete when ticket fallback load fails (avoids targeting deleted template; re-select or create reloads editor)
- Admin: revoke and restore pass from attendees list
- Email templates (reminder and custom) can be deleted even after deliveries were sent (delivery log keeps rows; template reference cleared)

## [0.4.8] - 2026-07-01

### Fixed
- Event capacity: pass restore (`status: registered`) respects capacity limits; manual create and import share an advisory lock to prevent concurrent over-capacity writes
- PATCH reactivation from `cancelled` or `revoked` to `registered` enforces capacity the same way as manual create
- Event overview `attendee_count` excludes revoked attendees (aligned with capacity enforcement)
- Event overview `admitted_count` uses the same active scope as `attendee_count` (excludes revoked/cancelled)
- Event capacity counts exclude `cancelled` as well as `revoked` passes
- CSV import capacity override (`?force=1`) records `forced: true` in `attendees_imported` audit metadata
- Import overwrite-only commits allowed when `toCreate === 0` even if event is already over capacity
- Event overview email card surfaces `email_bounced` separately from failed deliveries
- Branding upload validates magic bytes and uses async filesystem I/O

### Added
- Admin: logo upload zone in setup wizard (server upload or external HTTPS URL)
- Admin: bounce alert on Communication page with link to delivery log
- Backend: `saveEventUpload` helper for event-scoped branding paths (`/uploads/{orgId}/events/{eventId}/…`; no HTTP endpoint yet)
- Branding save accepts validated `/uploads/…` logo paths in addition to HTTPS URLs
- Email template render absolutizes `/uploads/…` branding assets using `BASE_URL` (required for logo in outbound mail)
- Admin: revoke and restore pass on attendee detail (PATCH `status`, capacity-aware restore)
- Admin: CSV import shows `event_full` capacity banner; superadmin can override with force commit
- Admin: TOTP enrollment QR code on Account page
- Admin: device label pre-filled from browser user agent
- Admin: sidebar pin/unpin (desktop), lifecycle nav labels (Passes, Post-event), Administration section
- Event capacity enforcement on manual attendee create and CSV import commit: returns `409 event_full` when the limit would be exceeded; instance superadmin may override with `?force=1` (audited)
- `PATCH /api/admin/events/:eventId/attendees/:id` supports `status: registered | revoked` with `pass_revoked` / `pass_restored` attendee action log entries
- Local branding upload API: `POST /api/admin/uploads` (PNG/JPG/WebP, max 2 MB, superadmin-only) and `GET /uploads/*` static serve; Docker Compose volume for `./uploads`
- Event overview: separate `email_bounced` count distinct from `email_failed` (failed + rejected only)
- Attendee status `revoked` in database (migration) — revoked passes are not admittable at check-in

## [0.4.7] - 2026-06-30

### Security
- Rate-limit admin export endpoints: PII export 5/h, attendees/reports export 10/h per user per route (global across events)

### Added
- Bulk **Send tickets** on the attendees list: `POST .../attendees/bulk-resend` with `target` `unsent` (default, `purpose: initial` with atomic claim) or `all` (resend, max 500 per request); rate limit 3 requests per 10 minutes per admin; response reports provider-accepted (`queued`), `skipped`, and `failed` counts; confirmation modal in admin SPA; audit via `mail_bulk_resend` in attendee action log
- CSV import preview: first 20 valid rows returned as `sampleRows` with `attributeFieldLabels`; admin Import page shows a scrollable "Data preview" table before commit (dynamic optional columns + event custom attributes)
- Requirements v2 (admin): Tabler icon picker on event items (`EventItem.icon`); contents metadata (`type`, `required`, `options`); ops-config flags `allow_manual_lookup` and `auto_advance_on_valid` (defaults true)
- Check-in runtime: enforces `allow_manual_lookup` (403 on lookup API; UI hides manual lookup and blocks short-query lookup); `auto_advance_on_valid` clears scan state after VALID admission; `GET /api/checkin/ops-config`; item icons on AttendeeCard (Tabler)
- Contents metadata runtime: enforce `type`/`select`/`boolean`/`required`/`options` on attendee create and patch; type-aware admin fields; required markers and formatted values on check-in item detail
- CSV import: dynamic event-item attribute columns (`source_field` slugs) validated and stored in `custom_data`; template includes configured fields; export-style label headers accepted on re-import
- Per-user preferred locale (`User.preferred_locale`) with date-format picker on Account page; admin SPA date displays respect the stored locale via module-level locale store
- Per-event IANA timezone on events — create/settings/wizard picker, reports/exports/mail preview use event timezone
- Event overview dashboard at `/admin/events/:id/overview` with admission rate, email delivery stats, event countdown, and dedicated `GET /api/admin/events/:eventId/overview` endpoint

### Fixed
- Event settings PATCH: `audit_failed` 500 uses `{ error }` shape
- Communication template editor: cursor restored after inserting placeholders into subject/body fields
- Event overview: auto-refresh stats every 30s during event
- CSV import: ignore `source_field` slugs that collide with standard import columns (`email`, `company`, etc.); event item contents API and admin form reject those reserved slugs on save
- CSV import: validate merged `custom_data` at commit (including overwrite with existing attributes); return 400 when event attribute config has conflicting select options
- Settings tabs preserve in-progress panel state (drafts, filters) when switching tabs without eager-loading every panel on first visit

### Changed
- Settings: replace mixed SPA/SSR horizontal tabs with four grouped in-app tabs (General, Security, Archiving, Identity); OIDC and Cloudflare Access remain server-rendered manage links
- Admin timestamp display clarity: event operational times use event timezone with abbreviation; admin/system times (audit log, mail deliveries, sessions, archived_at) always show UTC with label
- `client-ip` / healthz rate-limit helpers import `resolveTrustProxy` from lightweight `env-flags` module (avoids flaky CI load of `@admitto/auth` barrel → `@admitto/tickets` → Prisma singleton)
- Shared `@admitto/shared` locale whitelist (`SUPPORTED_LOCALE_TAGS`) used by API validation and Account picker; invalid DB values sanitized on read
- Audit log date filters use UTC calendar-day bounds (aligned with UTC table display)
- Existing events migrated to UTC — update timezone in Event Settings after deploy
- Known limitation: Account page TOTP enrollment still shows an `otpauth://` URI string (HTML `/mfa/enroll` shows QR; SPA QR deferred to v0.5)

## [0.4.6] - 2026-06-27

### Changed
- Admin and operator check-in: desktop camera renders inline in the main panel (stats sidebar stays visible); mobile keeps fullscreen camera overlay; operator mobile autostart with "Use camera" button to reopen after close; desktop inline shows lookup errors in the scan bar area and renders full AttendeeCard (items, notes, undo) below the camera preview
- Attendee note modal includes a one-line reminder not to record medical, dietary, or other sensitive personal data
- Staff SPA Content-Security-Policy allows HTTPS branding logo URLs in setup wizard and settings preview (aligned with existing `font-src https:` for theme fonts)
- Privacy docs: retention tables distinguish product-automated cleanup (sessions, email snapshots) from operator-controlled data (IP logs, attendee lists); OIDC IdP group membership documented; attendee erasure documented as API-only (no SPA delete button)
- `SECURITY.md`: Trivy HIGH remediation SLA (30 days when fix available); blocking HIGH gate deferred to v1.0
- `deploy/README.md`: container startup documents auth-state and email snapshot retention purge steps
- README: MFA first-login flow notes backup-code acknowledgment is persisted in the database

### Added
- Account self-service at `/account` for all signed-in staff: profile, password change (re-auth), TOTP enrollment/reset, and session management (`/api/account/*`)
- Nullable `User.password_hash` for OIDC-only accounts (additive migration; existing rows unchanged)
- IAM Users & roles page at `/admin/users`: staff user table (search, filters, pagination), invite-user modal, edit-user modal with role management, reset MFA/password/sessions, and role-assignments tab
- `GET/POST/PATCH /api/admin/users` and role grant/revoke, reset-2fa, reset-password, revoke-sessions endpoints with anti-lockout guards and audit logging (superadmin; org admin may grant/revoke operator@event only)
- `GET /api/admin/role-assignments` for non-instance role grants
- `must_change_password` on `User` with server-rendered `/change-password` flow after login or admin password reset
- First-run setup: server-rendered `/setup` for empty-database superadmin bootstrap; 5-step React onboarding wizard (system checks, mail, org branding, first event, completion) gated by `setup_complete` in `SystemSettings`
- Settings audit log viewer: superadmin-only paginated table of `AdminAuditLog` entries with action-type and date filters (`GET /api/admin/audit-log`)
- Event reports page at `/admin/events/:id/reports`: admission stats, hourly CSS chart, ticket-type breakdown, paginated admission log, CSV export, and printable HTML/PDF export via `GET /api/admin/events/:eventId/reports` and `/reports/export`; exports write `reports_exported` to the event audit log
- Admin attendee erasure now has a GDPR-ready `DELETE /api/admin/events/:eventId/attendees/:id` path that removes dependent delivery, wallet, and check-in rows in one transaction while preserving an event-scoped audit entry (PRIV-001, PRIV-004)

### Fixed
- Check-in camera result panel shows the actual admission timestamp on repeat scans instead of a hardcoded "Entered earlier today" subtitle
- Attendee note modal privacy hint is linked to the textarea via `aria-describedby` for screen readers
- Ops health/readiness rate limiters import audit logging via `@admitto/auth/audit` so unit tests do not load the full auth barrel (flaky `PrismaClient` init in CI)
- Account page (`/account`): profile Save disabled when unchanged; live password-confirm mismatch feedback; Spinner loading states; SPA `Link` navigation to account from staff/operator shells
- `@admitto/auth` `runInTransaction` no longer value-imports `PrismaClient`, avoiding flaky `healthz-rate-limit` unit tests when the auth barrel loads before `prisma generate`
- First-run `POST /setup` bootstrap race: Serializable transaction re-checks empty user table so only one superadmin can be created
- IAM anti-lockout guards (`last_superadmin` on role revoke and superadmin deactivation) run atomically in Serializable transactions; idempotent role DELETE returns 204 instead of 500 when the assignment is already gone; 404 when the assignment exists under a different user id in the URL
- Setup wizard no longer bypassed on `/operator` — `setup_complete` included on `/api/auth/me` for instance superadmins
- Event slug helper truncates before trimming trailing dashes; wizard step 4 disables Continue when slug is empty and uses max slug length 80 (aligned with API and CreateEventModal)
- DB partial unique index enforces at most one instance-scoped superadmin `RoleAssignment`
- Admin mutations that write `AdminAuditLog` now persist audit rows in the same database transaction as the primary change (users IAM routes, mail settings PUT); audit failure rolls back the mutation instead of leaving inconsistent state (BE-001, BE-002)
- Concurrent attendee import commits for the same event are serialized with a PostgreSQL advisory lock so duplicate bulk audit rows cannot be written (BE-004)
- Agency `public_ref` backfill processes attendees in bounded batches instead of loading all rows at once (BE-005)
- User deactivation revokes sessions after the Serializable user-update transaction commits, avoiding serialization conflicts with concurrent `last_seen_at` updates (Bugbot)
- Import commit transaction timeout raised to 120s so a second commit can wait on the per-event advisory lock without aborting mid-queue (Bugbot)
- `Attendee.rsvp_status` now has a database CHECK constraint matching the application enum, preventing invalid RSVP states from raw SQL or future scripts (DATA-002)
- `OidcRoleGrant` now uses partial unique indexes for scoped and instance grants, correctly enforcing uniqueness when `scope_id` is `NULL` (DATA-004)
- Attendee, check-in, and event item state status columns now have database CHECK constraints matching persisted application values (DATA-003)
- Destructive migration scanning now flags `DELETE FROM` DML in new Prisma migrations unless explicitly approved (DATA-006)
- Staff account creation audit metadata and import CLI skipped-row output now redact email addresses, and privacy/DSAR docs now document attendee-note special-category risk plus manual erasure FK ordering (PRIV-001, PRIV-002, PRIV-003, PRIV-004, PRIV-006)
- Container startup now wraps the agency `public_ref` backfill in a 120-second timeout, and PR-Agent comments are limited to collaborators/members/owners to prevent public API-credit drain (INFRA-002, INFRA-003)
- Container startup now attempts a best-effort purge of expired/revoked `Session` and `TrustedDevice` rows after migrations/backfills with a 120-second timeout; operators can also run `npm run cli -w @admitto/auth -- purge-auth-retention --dry-run` to preview counts, reducing stale auth-state retention (DATA-001, PRIV-005)
- Container startup now nullifies stale `EmailDelivery.rendered_html` / `rendered_subject` snapshots on terminal deliveries older than 60 days (configurable via `EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS`); operators can preview counts with `npm run cli -w @admitto/mail-delivery -- nullify-delivery-snapshots --dry-run` (DATA-005, PRIV-001)

### Security
- Forced password change is now enforced as a dedicated `change_password_required` session stage: a user whose password was reset by an admin cannot reach any protected route (API or UI) until they set a new password — the previous `next: change_password` hint was a UI directive only and could be ignored by any HTTP client (IAM-001)
- Backup recovery codes must be acknowledged before a full session is granted, even after a fresh login or when the completion request lands on a different process: acknowledgment is now persisted on `UserMfaMethod` (`backup_codes_acknowledged_at`) instead of an in-memory stash, closing a bypass where a returning user could skip saving recovery codes (IAM-002)
- Forced password-change form now enforces the same 12-character minimum as all other self-set passwords (was 8) (IAM-003)
- Granting `superadmin@instance` to a second user now returns HTTP 409 `single_superadmin_limit` instead of an unhandled 500 (IAM-004)
- Known limitation: OIDC group→role mappings are fully reconciled at OIDC login only; deployments using OIDC-managed admin/superadmin roles should set admin session TTL to 8h or less and follow the documented offboarding runbook (accepted risk, IAM-005)
- Attendee CSV export now uses the shared CSV formula-injection sanitizer (covers newline-prefixed formulas and whitespace-padded `=`) across attendee, event-settings PII, and reports exports (SEC-001)
- Printable HTML/PDF event report export now sends a restrictive Content-Security-Policy header (SEC-003)
- `EmailDelivery.error` sanitization now redacts URLs (e.g. Power Automate webhooks) before persistence (BE-006)
- REVOKED check-in audit rows are written inside a transaction for consistency with other check-in paths (BE-003)
- Known limitation: automated post-event attendee PII purge deferred to v1.0 — use Attendees export + per-attendee `DELETE` API (no SPA delete button yet)
- Known limitation: OIDC group→role reconciliation runs at OIDC login only — shorten admin session TTL and follow offboarding guidance in `security/SECURITY-CONTROLS.md`
- Known limitation: Account page TOTP enrollment shows an `otpauth://` URI string; HTML `/mfa/enroll` shows a QR code — SPA QR deferred to v0.4.7
- Known limitation: ticket token may appear in server access logs when operators open ticket URLs — accepted risk; control via reverse-proxy log retention

## [0.4.5] - 2026-06-24

### Added
- MFA enrollment split into three steps: TOTP QR/setup-key confirm → dedicated backup-codes page → full session; new `backup_codes_required` session stage and DB migration
- `POST /mfa/enroll/backup-codes` route and `handleTotpBackupCodesComplete` API endpoint; session promoted to `FULL` only after backup-codes acknowledgment
- 6-digit centered OTP input field with auto-focus, paste support, keyboard navigation, and backup-recovery-code toggle
- `GET /` smart redirect: authenticated users land on `/admin` (or `/operator`), unauthenticated users on `/login`
- Admitto favicon set: SVG, 32 × 32 PNG, Apple touch icon, and ICO fallback served from `/favicon.*`
- SSO button label per identity provider (`login_button_label`); default falls back to "Continue with SSO"
- Admin sidebar: checkmark brand mark (correct `admitto-mark.svg`), `All events` + `Settings` items always pinned to footer
- Settings sub-navigation: horizontal tab bar (General · Identity providers · Cloudflare Access) rendered on both SPA and SSR settings pages
- Identity-provider and Cloudflare Access admin pages rendered with full sidebar shell matching the SPA layout (sticky layout, design-system CSS tokens)
- Event card: date icon, location pin icon, attendee count stat with user icon; hover lift effect
- Event overview landing page at `/admin/events/:id/overview` with quick stats and navigation links to live admin sections
- Shared admin shell (`StaffShell`): sidebar with independent scroll, slim topbar, optional settings subnav, and mobile drawer navigation
- Staff topbar: mailer status indicator (configured dot + provider label), role badge (SA/AD/OP), icon-only sign out
- Sidebar footer: **Users & roles** link for org admins and superadmins (page ships in a follow-up PR)
- Dev-only demo bar (`import.meta.env.DEV`) to trigger sample toasts from the admin shell
- Admin check-in v2: split layout with scan bar, connection banner, stats/progress sidebar, color-dot recent scans, and fullscreen camera overlay with QR viewfinder
- Create event UI: `POST /api/admin/events`, New event modal (title, slug, date, location), redirect to attendees after create
- Events picker visual polish: active status badge, responsive 2/3-column grid, empty state with Create event CTA
- Attendees v2: `rsvp_status` migration, wider list table (STATUS/MAIL/CHECK-IN/actions), manual `POST /attendees`, full attendee detail page with activity log, Add attendee modal
- Event settings page at `/admin/events/:id/settings`: edit title, date, location, capacity; superadmin PII CSV export; archive/unarchive from danger zone; `capacity` field on Event

### Changed
- `GET /api/admin/me` includes `mailer_status` (provider presence only — no credentials); `/api/auth/me` unchanged for operator sessions
- Toast stack position: top-right below the staff topbar (`--topbar-h`) instead of bottom-right
- Admin check-in: keyboard wedge `inputMode="none"`, auto-submit for long tokens, Esc to clear result state
- README: local dev onboarding (`Run locally`), Node `engines` alignment, `infra/` vs `deploy/` distinction; new [`apps/admin/README.md`](apps/admin/README.md)
- Admin Vite dev proxy: forward `/mfa` to `@admitto/web` so MFA enrollment works on `:5173`
- Login page `<title>` fixed to "Admitto"; added `application-name`, `og:site_name`, and `description` meta tags for password-manager naming
- MFA page heading changed from `<h1>` to `<p class="auth-page-action">` to preserve correct document semantics; Admitto brand uses `<h1>`
- CSRF fix: Nginx forwards `$http_host` (with port) in `Host` and `X-Forwarded-Host` headers so `127.0.0.1:8080` logins no longer return 403
- Superadmin instance settings at `/admin/settings` with branding panel — live theme preview, anti-lockout guards, and links to OIDC / Cloudflare Access admin pages (#96)
- Settings → Mail transport panel: configure provider, masked secrets, env-locked fields, and test send (#99)
- Settings → Sessions and Security panels: list/revoke staff sessions, bulk operator revoke, session TTL and MFA policy; `GET`/`PATCH /api/admin/system-settings` (#112)
- Event archiving: `Event.archived_at` hides completed events from default lists; superadmin archive/unarchive; archived events read-only on admin mutating APIs; Active/Archived tabs; check-in stays available (ADR 0022) (#116)
- Admin shell layout: single main scroll region (subnav + page content), `100dvh` viewport, Overview in live event sidebar segments; events picker opens archived tab when no active events remain; active event cards are fully clickable
- MFA enrollment and verify: step progress indicator (`Step X of 3`), no OTP autofocus on the QR step, auto-submit after six digits, and submit loading state on auth forms
- Settings horizontal subnav uses consistent styling across SPA and SSR; Identity providers and Cloudflare Access open via full-page navigation to SSR admin pages
- Admin sidebar chrome trimmed: redundant context labels and duplicate Instance settings header action removed
- `@admitto/ui` design system: `Spinner`, `EmptyState`, `Skeleton`, and `ToastProvider` / `useToast` (#120)
- Admin app root wrapped with `ToastProvider`; recoverable `ErrorBoundary` on render errors (#97, #120)
- Admin UX micro-fixes: import column reference table and CSV template download; delivery log purpose filter; compose dirty-state guard; attendee drawer discard confirmation; check-in stats admitted/total (#121)
- `POST /mfa/enroll/download-codes` — backup codes as `.txt` during enrollment (#117)
- Check-in: `NoteModal` replaces `window.prompt` for attendee notes (#114)
- Runtime upgraded to Node 24 LTS; React 18 → 19 across admin and web (#111, #110)
- Login, MFA, and superadmin identity-provider HTML pages aligned with Admitto design tokens (#117)
- OIDC group mapping role picker uses a select; provider list supports inline enable/disable (#117)
- Cloudflare Access admin form shows status badge, fall-through explanation, and enable warning (#117)
- Requirements and Communication panels use `ConfirmDialog` instead of native `window.confirm` (#97)

### Fixed
- Guest ticket page now prints correctly (white background, no wallet buttons, no shadows)
- Export: sanitize dynamic attribute column headers against formula injection (#97)
- Local dev: login/MFA CSRF when `Origin`/`Referer` absent (Safari); admin SPA dist path after `npm run build -w @admitto/admin` (#115)
- Admin page shell document title uses event name prefix without regressing the visible `h1` (#118)
- SSO failure on `/login` shows a dedicated fallback banner; removed placeholder “SSO coming soon” when no IdP is configured (#117)
- Check-in card coloured left border per scan status (#114)
- Login page title and heading: “Sign in to Admitto” (#114)
- Sidebar Overview section shows “Soon” until built (v1.0) (#114)
- Settings subnav active tab uses path prefix matching instead of exact pathname equality
- Sidebar “Soon” badges render with correct styling (`.nav-item--soon`, `.nav-item__badge`)
- Global link hover underline no longer appears on sidebar brand, navigation items, or button-styled links (SPA and SSR settings shell)
- OIDC admin form: URL fields use `type="url"`; group→role mapping rows can be added/removed; scope type select; SSO button live preview on provider form; failed save re-renders submitted mapping drafts
- Cloudflare Access settings: clearer operator copy and field hints; test action labeled “Test connection”
- Events picker: search by title/location; content width capped at 1100px; grid capped at three columns on wide screens
- Check-in camera: removed fullscreen toggle (browser instability); debounce repeated ZXing decodes; extract ticket token from QR URLs with trailing slash or query (`packages/tickets`)
- Check-in invalid/revoked scans show dedicated feedback card instead of silent failure
- Requirements: `@admitto/ui` Switch missing thumb restored; item table uses name + auto-generated key; drawer layout cleanup
- Event picker cards: removed hover lift/underline noise
- Vercel Git deploys disabled via root `vercel.json` (self-hosted Docker only)

### Security
- Branding `font_family_name` allowlist on save and ticket-page render (blocks CSS/HTML injection via custom fonts) (#96)
- `deploy/validate-env.sh` pre-flight for `deploy/.env`; production boot fails fast when `REDIS_URL` is missing, unauthenticated, or `ENCRYPTION_KEY` is invalid
- PENtest hardening: structured audit events for rate limits, MFA, OIDC login, logout, admin 403, and settings changes — ISO `ts` on each event (#123)
- Production `BASE_URL` must use `https://` (except `localhost` / `127.0.0.1` smoke) (#123)
- OIDC ID token verification restricts JWT algorithms to RS/ES/PS family (no `none`) (#123)
- Deploy Redis requires `REDIS_PASSWORD`; compose wires authenticated `REDIS_URL` (#123)
- Nginx proxy baseline security headers (HSTS, nosniff, frame deny); Docker bridge gateway for RealIP behind NPM (#123)
- `/healthz` and `/readyz` responses include baseline security headers (#123)
- GitHub Releases for `v0.x.y` are **pre-release** until `v1.0.0`; `publish-container` sets the flag automatically (#123)
- PENtest follow-up: rate limits on MFA enroll, `/healthz`, admin import/template preview, and OIDC provider discover/test; OIDC outbound fetch resolves DNS before connect; malformed `X-Forwarded-For` falls back to socket IP (no shared `unknown` bucket)
- `docs/security/SECURITY-CONTROLS.md`: rate-limit matrix, `TRUST_PROXY` trust model, SSRF/DNS-rebind guards, PEN retest checklist for operators

## [0.4.4] - 2026-06-19

### Security
- Bump transitive `undici` 6.26.0 → 6.27.0; addresses CVE-2026-12151 (high), CVE-2026-9679 (moderate), CVE-2026-11525 and CVE-2026-6733 (low) (#94)

### Fixed
- Container publish workflow: `workflow_dispatch` on branch refs runs scan-only (Trivy SARIF, CRITICAL gate) without SBOM path or Docker metadata failures (#93)
- GHCR push, provenance attestation, and release SBOM restricted to `refs/tags/v*.*.*` semver refs; semver-shaped branch names can no longer trigger a publish

## [0.4.3] - 2026-06-19

### Added
- Attendee list export to CSV, XLSX, and PDF with check-off column and formula-injection sanitization (#88)
- Dynamic custom attributes in admin drawer: edit fields driven by `EventItem.config.contents` instead of hardcoded `shirt_size` (ADR 0030, #91)
- Export columns follow `EventItem.config.contents` definitions; check-in parity preserved
- `security/SECURITY-CONTROLS.md`: configurable security capabilities table with TOTP and OIDC implementation detail
- `CORPORATE-DEPLOYMENT.md`: self-hosted model, customer-hosted stack, no SaaS
- `ARCHITECTURE-FOR-AUDITORS.md`: scope, generic exposure overview, roadmap flows
- `GDPR-ONE-PAGER.md`, `SUBPROCESSORS.md`: purposes, retention, subprocessor template, DSAR options
- `DSAR-PROCEDURE.md`: organizer-mediated access and erasure template (Option B)
- `INCIDENT-RESPONSE.md`: rotation, rollback, severity template; GDPR Art. 33/34 72-hour breach notification
- Zod validation on `custom_data_fields` keys; stable export column order (`orderBy: key`)
- Duplicate Excel headers disambiguated as `Label (source_field)`; PDF column widths scale down when many attributes exceed printable width
- Export integration tests use isolated events

### Changed
- `DATA-PROTECTION.md` updated with legal basis note (LIA for legitimate interest)

### Fixed
- Drawer degrades gracefully when event-items API fails

### Security
- Removed `|| true` from Semgrep CI step — SAST findings now block pull requests (baseline verified at 0 findings before merge)

## [0.4.2] - 2026-06-19

### Added
- Admin attendee table with pagination, search, status and ticket-type filters, and badge parity with operator UI
- Edit drawer: change guest fields in-place, view communication history, resend ticket email
- CSV and XLSX import: canonical column headers, row preview and validation errors, overwrite toggle, agency UUID/QR payload support
- Event-day configuration: event items (gift bag, badge, headset), `ops_config` toggles, content fields linked to attendee data
- Admin mail UI: edit MJML/HTML templates, preview with sample data, send a test message
- Delivery log: browsable per event (status, retries; no rendered HTML in list views)
- `GET /readyz` token-protected readiness check for database, Redis, and migration status (ADR 0026)
- Pre-migration database backup on container start when pending migrations exist (ADR 0027)
- CI guard against destructive migration SQL; rollback runbook; smoke test for backup path
- Trivy image scan and CycloneDX SBOM in CI; `SECURITY.md` updated
- Export also matches selected fields inside `custom_data` JSON

### Changed
- Backend routes are event-scoped (wrong event returns 403) with CSRF on mutating calls
- Migrations apply automatically on container start (fail-fast); no manual `migrate deploy` for operators
- Requires Node ≥ 22.13 for exceljs ↔ uuid interop (`require(esm)`)

### Fixed
- Concurrent edits: second save on the same guest returns a clear stale-write response instead of silently overwriting (ADR 0028)
- Request body limits and safe error messages on mail endpoints; export-only dev sink for local mail testing (ADR 0029)
- Transitive `uuid` forced to 14.0.0 (#13); patch bumps for vitest, eslint, argon2

### Database migrations
- `20260618120000_event_item_contents` — metadata for configurable event-item content
- `20260618140000_attendee_updated_at` — `updated_at` on attendees for optimistic locking

## [0.4.1] - 2026-06-17

### Added
- Attendee card after scan or manual lookup: guest name, company, ticket type, check-in status, warnings, item rows, recent notes, audit context; stacks on narrow screens (< 1024 px)
- Item fulfilment at the door: gift bag (shirt size shown on row), badge (auto-issue on check-in when configured), headset (issue and return)
- Every item and check-in change logged in `AttendeeActionLog` (who, session, device, IP)
- Manual lookup by name or email: PII in request body (not URL); also matches `company` and `department` inside `custom_data`
- Scan history sidebar with admitted count; operator notes (max 2 000 characters, author + timestamp)
- Per-tablet undo of last check-in: rolls back admission and auto-issued badge; requires device label at login
- Opt-in camera QR decode via dynamically loaded `@zxing/browser`; USB keyboard wedge remains primary scan path

### Changed
- Manual lookup uses the same admit path as scan — no double admission on repeat tap (CAS)
- Undo hidden when session has no device label (matches server 409 response)

### Database migrations
- `20260617120000_event_day_ops` — `custom_data`, `ops_config`, event items, item states, notes, action log
- `20260617130000_attendee_note_body_check` — DB CHECK on note body length

## [0.4.0] - 2026-06-17

### Added
- `@admitto/ui` design system: tokens, status badges, 13 React primitives, theme vars with anti-lockout branding fallback
- Admin and operator shells served from the same origin as the API; role-based redirect to correct surface after login
- Auth-aware heartbeat (`ConnectionStateProvider`) so tablets know when the server session is alive
- Staff SPA at `/admin`, `/operator`; public ticket page `/t` reskinned to match
- Scanner-first check-in entry: autofocus buffer, Enter to submit, refocus after each scan, ~300 ms duplicate debounce
- Scan result card with status badge; shared check-in route for admin and operator URLs
- Self-hosted Tabler Icons and Inter font — no runtime dependency on jsDelivr or Google Fonts (ADR 0012)
- Defense-in-depth headers on staff SPA shell (CSP, `nosniff`, `no-referrer`, `frame-ancestors 'none'`) (ADR 0017)

### Changed
- Semantic theme tokens replace hardcoded hex in `components.css` and `ticket.css`
- `Tabs` reconciles `active` when the `tabs` prop changes after mount

### Fixed
- Controlled redirects when post-login path resolution fails (no HTTP 500 on auth edge cases)

## [0.3.7] - 2026-06-16

### Added
- `scripts/release-tag.sh` for signed annotated tags (`git tag -s`) with pre-push checks
- `VERSIONING.md` with SSH/GPG signing setup and release steps including GitHub Release
- Re-signed tags `v0.3.3`–`v0.3.6` on GitHub (verified: true); future tags use the script

## [0.3.6] - 2026-06-16

### Added
- Multi-stage production Docker image for `apps/web`; migrations run on container start
- `deploy/docker-compose.yml`: app + Postgres + Redis + nginx (loopback `:8080`; app internal `:3000`)
- `GET /healthz` with database ping for Docker health checks
- CI `docker-build` job; `publish-container` pushes `ghcr.io/solarssk/admitto:0.x.y` and rolling `:0.x` on each semver tag (ADR 0018)
- Optional `deploy-smoke` `workflow_dispatch`

## [0.3.5] - 2026-06-15

### Added
- Cloudflare Access JWT validation on `/admin*` and `/api/admin*`; missing JWT redirects to `/login`, not 401 (ADR 0017)
- Per-request CF identity resolution via `ExternalIdentity` seam — no long-lived Admitto session for CF logins
- Superadmin UI to configure team domain, audience, JWKS test; env locks override DB as kill switch
- Group-to-role mapping synced on each valid CF JWT; boot fail-fast when CF Access enabled without team domain/AUD
- `CF_ACCESS_ENABLED=false` env override as emergency kill switch

### Database migrations
- `20260615200000_cf_access_settings` — system settings defaults for CF Access keys

## [0.3.4] - 2026-06-15

### Added
- OIDC login (Authentik-first): Authorization Code + PKCE; full ID token validation (JWKS, issuer, audience, nonce)
- JIT provisioning: new OIDC users get zero roles unless a configured group-to-role rule matches (fail-closed)
- Account linking: explicit `?link=1` step-up (password + TOTP when required); `link_step_up_at` on OAuth state (5 min TTL)
- `OidcRoleGrant` tracks OIDC-provisioned roles; demotion revokes grants without touching manual `RoleAssignment` rows
- Superadmin UI for OIDC provider config; client secrets encrypted at rest; SSRF guards on discovery URLs
- `resolveOrCreateUserFromExternalIdentity` shared seam for Cloudflare Access

### Changed
- SMTP adapter requires TLS 1.2+ (`minVersion: "TLSv1.2"`)
- Check-in history `limit` clamped to 1–100 at HTTP and domain layers

### Fixed
- Duplicate `RoleAssignment` rows removed; partial unique indexes on scoped and instance roles
- OIDC provider save resolves HTTP endpoints before DB transaction (no network I/O inside transactions)
- Idempotent grant creation under concurrent OIDC logins (`P2002` → safe no-op)
- `prisma migrate deploy` on `admitto_auth_test` before auth integration tests in CI

### Database migrations
- `20260615120000_oidc_linking` — `IdentityProvider`, `ExternalIdentity`, OAuth state tables
- `20260615140000_oidc_hardening` — schema and index hardening
- `20260615160000_oidc_scope_normalization` — scope normalization for group-to-role mappings
- `20260615170000_oidc_link_step_up` — `link_step_up_at` on OAuth state
- `20260615180000_oidc_role_grants` — `OidcRoleGrant` + group mapping tables
- `20260615190000_role_assignment_unique` — dedup, partial unique indexes, grant repoint, FK cascade

## [0.3.3] - 2026-06-14

### Added
- TOTP 2FA for admin and superadmin roles; operators unchanged (full session after password, no MFA friction on event day)
- Partial session stages: `mfa_pending` and `enrollment_required` gate privileged routes until TOTP completes
- Backup recovery codes (argon2id-hashed, one-time use)
- Optional trusted-device cookie (hash-only in DB); skips TOTP on known browsers; revoked on logout, MFA reset, and session revoke
- Break-glass CLI: `reset-mfa`, `generate-emergency-recovery` (superadmin@instance only, audit log)
- `SystemSettings`: session TTL, operator session TTL, trusted device days, `mfa_required_roles` (env lock → DB → default)

### Security
- CSRF origin check honours `X-Forwarded-Proto` and `X-Forwarded-Host` only when `TRUST_PROXY=true` (aligned with rate-limit client-IP policy)
- TOTP replay protection: `last_totp_time_step` + otplib `afterTimeStep`; conditional DB update guards parallel replay

### Changed
- Dependency updates: `hono` 4.12.25, `@hono/node-server` 2.0.4, `redis` 6.0.0, `zod` 4.4.3, `@typescript-eslint/parser` 8.61.0, CodeQL action SHA bump
- `RedisRateLimitStore` adapted for redis v6 (`withAbortSignal()`, two-arg `eval()`)

### Database migrations
- `20260614130000_2fa_totp` — `Session.stage`, `UserMfaMethod`, `TrustedDevice`, `SystemSettings` seed; active elevated sessions re-staged
- `20260614210000_totp_replay_protection` — `UserMfaMethod.last_totp_time_step`

## [0.3.2] - 2026-06-14

### Added
- Server-rendered operator auth: `GET/POST /login`, `GET /operator`, `POST /logout`
- Session cookie (`httpOnly`, `SameSite=Lax`); optional device label; CSRF on login/logout and `POST /api/checkin/scan`
- Login rate limits: IP-based and per-email on failed attempts
- `Attendee.public_ref` (unique, non-guessable) for agency ticket URLs
- Public routes `/t/:slug/a/:ref` and `/q/:slug/a/:ref.png` resolve by `public_ref`, not internal `Attendee.id`
- Backfill on deploy: agency attendees without `public_ref` receive one automatically
- `scripts/test-web-like-ci.sh` for local CI parity; test contract in `apps/web/test/README.md`

### Changed
- Default `ALLOW_CHECKIN_BEARER=false`; session + event scope required for scan and history; Bearer token is break-glass only
- Per-operator scan/history rate limits applied after authentication (not shared with unauthenticated IP quota)
- Integration tests stabilized: Vitest unit (no Postgres) vs integration (one `globalSetup` with `migrate deploy`); integration files under `test/integration/`

### Fixed
- CI failures from shared `admitto_web_test` DB (`P3005`, Prisma segfault on repeated `force-reset`): fixture cleanup instead of per-file DB resets

## [0.3.1] - 2026-06-14

### Added
- Local `User` accounts with argon2id password hashing and `is_active` state
- Break-glass superadmin bootstrap CLI: `npm run auth:bootstrap` (password from stdin, not argv)
- `@admitto/auth` package: login, logout, session validation, password verification, auth audit logging, capability-aware authorization helpers
- HTTP auth endpoints: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- Event-scoped check-in RBAC: `superadmin@instance` (all events), `admin@organization` (org events), `operator@event` (assigned event only)
- DB-backed `Session` records: opaque high-entropy tokens (only `token_hash` stored), expiry, single-session revoke, event-scoped bulk revoke
- Role-sensitive session lifetimes: shorter for operators, longer for admin and superadmin

### Changed
- `/api/checkin/*` extended to accept a valid session or the transitional legacy Bearer token; ADR 0003 deploy policy preserved

### Security
- Uniform unauthorized responses for bad email and bad password to reduce user enumeration risk
- Dummy verification path for missing users; structured login audit logs without password or session token leakage
- Login rate limiting; `httpOnly` session cookie with `SameSite=Lax` and `Secure` outside development

## [0.3.0] - 2026-06-13

### Added
- Provider-level test-send: one message per event without triggering bulk delivery
- Read-only mail config inspection with masked secrets
- Delivery log listing without exposing full rendered HTML bodies
- Redis-backed shared rate limiting on public `/t/*` and `/q/*` routes; in-memory fallback when Redis is not configured

### Changed
- Rate limiting fails open when Redis is configured but unavailable — ticket access prioritized over strict limiting during an outage

## [0.2.4] - 2026-06-11

### Fixed
- Defensive DB `CHECK` constraints on `RoleAssignment`
- Crypto key-version behavior hardened
- Seed fails predictably when encryption is misconfigured

## [0.2.3] - 2026-06-11

### Added
- `Organization` as the tenant boundary; `organization_id` threaded through the event and delivery model
- Role and scope groundwork: `superadmin`, `admin`, `operator`
- Attendee ticket tokens encrypted at rest via `@admitto/crypto` (AES-256-GCM, ADR 0006)

## [0.2.2] - 2026-06-11

### Added
- Docker Compose for local development with PostgreSQL
- CI service wiring for real database path
- Relational constraints preventing cross-event check-in mistakes at the DB layer

### Changed
- Standardized on PostgreSQL as the single database engine across development, CI, and production (ADR 0004)

## [0.2.1] - 2026-06-11

### Added
- Atomic single-use check-in: one QR/token cannot admit twice (CAS, ADR 0001)
- Recent check-in history endpoint
- Temporary operator Bearer gate on `/api/checkin/*`

## [0.2.0] - 2026-06-08

### Added
- CSV/XLSX attendee import with agency UUID preservation
- Internal QR/token issuance; agency UUID/external payload support
- Public ticket page (`/t/:slug`) and hosted QR image routes (`/q/:slug`)
- Split between internally generated token-based tickets and agency-provided identifiers

## [0.1.0] - 2026-06-08

### Added
- Monorepo setup with initial DB schema and package boundaries
- CI pipeline and basic security baseline (CodeQL, Semgrep, gitleaks, npm audit, Dependabot)
- Mail adapter groundwork
- Gate 0 outcome recorded: Power Automate as MVP mail path; Graph/SMTP remain future re-validation candidates

[Unreleased]: https://github.com/solarssk/admitto/compare/v0.4.14...HEAD
[0.4.14]: https://github.com/solarssk/admitto/compare/v0.4.13...v0.4.14
[0.4.13]: https://github.com/solarssk/admitto/compare/v0.4.12...v0.4.13
[0.4.12]: https://github.com/solarssk/admitto/compare/v0.4.11...v0.4.12
[0.4.11]: https://github.com/solarssk/admitto/compare/v0.4.10...v0.4.11
[0.4.10]: https://github.com/solarssk/admitto/compare/v0.4.9...v0.4.10
[0.4.9]: https://github.com/solarssk/admitto/compare/v0.4.8...v0.4.9
[0.4.8]: https://github.com/solarssk/admitto/compare/v0.4.7...v0.4.8
[0.4.7]: https://github.com/solarssk/admitto/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/solarssk/admitto/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/solarssk/admitto/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/solarssk/admitto/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/solarssk/admitto/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/solarssk/admitto/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/solarssk/admitto/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/solarssk/admitto/compare/v0.3.7...v0.4.0
[0.3.7]: https://github.com/solarssk/admitto/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/solarssk/admitto/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/solarssk/admitto/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/solarssk/admitto/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/solarssk/admitto/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/solarssk/admitto/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/solarssk/admitto/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/solarssk/admitto/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/solarssk/admitto/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/solarssk/admitto/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/solarssk/admitto/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/solarssk/admitto/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/solarssk/admitto/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/solarssk/admitto/releases/tag/v0.1.0
