# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each entry is one line that starts with a verb and links to the pull request with the details.

## [Unreleased]

### Added

- Add rate limits for the upcoming public registration form, tunable with `RATE_LIMIT_OVERRIDES` (`registration:page`, `registration:submit`, `registration:confirm`, `registration:password`, `registration:event`, `registration:mail-recipient`) ([#1753](https://github.com/solarssk/admitto/pull/1753))
- Add the groundwork for guest registration mails: four English default messages, a signed email-confirmation link, and `confirm_url`, `contact_name` and `contact_email` variables ([#1749](https://github.com/solarssk/admitto/pull/1749))
- Add a Turnstile card to Organisation settings > External services and a "Bot protection" row to the Health check, for the coming guest registration form ([#1767](https://github.com/solarssk/admitto/pull/1767))
- Add legal texts per event (privacy notice, event terms, extra consents) with an admin API and public pages at /legal, for the coming registration form ([#1769](https://github.com/solarssk/admitto/pull/1769))
- Give attendee fields a saved order and a registration-form setting, and refuse a Required field the form would not ask ([#1766](https://github.com/solarssk/admitto/pull/1766))
- Show tabs between an event's published legal texts on the public /legal pages ([#1770](https://github.com/solarssk/admitto/pull/1770))
- Add long text, date, date and time and phone answer types and format rules for attendee fields, in the API and the import ([#1773](https://github.com/solarssk/admitto/pull/1773))
- Add a worker job that sends guest registration mail and deletes registrations not confirmed in 24 hours, with a Health check row for its queue ([#1775](https://github.com/solarssk/admitto/pull/1775))
- Add the guest registration form at /r/<event slug> for events that use the public link; it stays a not-found page until an event turns registration on ([#1776](https://github.com/solarssk/admitto/pull/1776))
- Add long text, date, date and time and phone questions to the registration form, with the field's rules as hints ([#1783](https://github.com/solarssk/admitto/pull/1783))
- Add icons, suggestions and "show only when" conditions to attendee fields (admin API); a question that is not shown is never required or saved

### Fixed

- Save an attendee's email in lower case when staff add or edit it, and refuse an address that differs from another's only in capitals ([#1781](https://github.com/solarssk/admitto/pull/1781))

### Security

- Add a strict nonce-based security policy and a uniform not-found page for the coming public registration form ([#1752](https://github.com/solarssk/admitto/pull/1752))
- Clear an attendee's earlier addresses, recorded when staff edited them, from other attendees' mail and saved import results when the attendee is erased or removed ([#1768](https://github.com/solarssk/admitto/pull/1768))

## [0.7.7] - 2026-10-18

### Fixed

- Fade the content of every tab in, the same way: attendee page, Users & roles, Settings, Event settings, Account, events list ([#1746](https://github.com/solarssk/admitto/pull/1746))
- Fit a tooltip to its longest line, so it no longer has an empty strip on its right ([#1746](https://github.com/solarssk/admitto/pull/1746))

## [0.7.6] - 2026-10-18

### Changed

- Show times with no recorded time zone in UTC, the same for every viewer: Wallet card, Activity, delivery history, notes, import history, Recent activity ([#1743](https://github.com/solarssk/admitto/pull/1743))
- Show a wallet pass as "Pending" on the attendee's page while it is being made ([#1690](https://github.com/solarssk/admitto/pull/1690))
- Document `migrate` and P3009 recovery, `app` memory sizing, container hardening, the sign-in limit, SSO two-factor and what Redis holds ([#1695](https://github.com/solarssk/admitto/pull/1695))

### Fixed

- Start every Activity label with a capital letter, also for an action type the list does not know ([#1743](https://github.com/solarssk/admitto/pull/1743))
- Show the same day labels in the cumulative charts of the wallet and mail reports for every viewer, including those far east of UTC ([#1743](https://github.com/solarssk/admitto/pull/1743))
- Read CSV files with semicolons, tabs or Windows-1250 letters (Polish Excel), and refuse UTF-16 and NUL files with a message to save as CSV UTF-8 ([#1742](https://github.com/solarssk/admitto/pull/1742))
- Show one "archived" bar above every page of an archived event, with "Restore event" for a Superadmin ([#1687](https://github.com/solarssk/admitto/pull/1687))
- Remove the repeated "archived" line from the other Event settings tabs and the image library ([#1686](https://github.com/solarssk/admitto/pull/1686))
- Remove the "archived" note from the Check-in settings tab and centre its switches on their labels ([#1685](https://github.com/solarssk/admitto/pull/1685))
- Return 400 instead of a server error for unreadable pinned-note, key-contact and link requests, and stop an empty pinned-note request from clearing the note ([#1700](https://github.com/solarssk/admitto/pull/1700))
- Fit the staff top bar on a phone so the account menu stays open ([#1698](https://github.com/solarssk/admitto/pull/1698))
- Accept long generated passwords, such as 64 hex characters or two UUIDs, instead of refusing them as too common or calling them weak ([#1741](https://github.com/solarssk/admitto/pull/1741))

### Security

- Delete export and import files that no job names (counted as `orphaned_job_files`), so a killed process cannot leave an attendee list in storage ([#1688](https://github.com/solarssk/admitto/pull/1688))
- Delete a wallet pass that Admitto never recorded when its attendee is erased or removed from an event ([#1690](https://github.com/solarssk/admitto/pull/1690), [#1691](https://github.com/solarssk/admitto/pull/1691))
- Refuse an XLSX file with too many rows or cells before it is read into memory ([#1693](https://github.com/solarssk/admitto/pull/1693), [#1697](https://github.com/solarssk/admitto/pull/1697))
- Stop converting an XLSX file as soon as its text passes the 10 MiB limit ([#1697](https://github.com/solarssk/admitto/pull/1697))
- Answer malformed requests with 400 or 404 instead of a server error, and log failed sign-ins with unusual e-mail characters ([#1699](https://github.com/solarssk/admitto/pull/1699))
- End the identity provider's session when a user signs out of an SSO session, in every browser ([#1694](https://github.com/solarssk/admitto/pull/1694))
- Make SSO sign-in stricter: bound provider replies, require ID token claims and log the reason a sign-in failed ([#1696](https://github.com/solarssk/admitto/pull/1696))
- Read an XLSX import in a separate process with fixed memory and time limits; a stopped file is logged as `xlsx_decode_stopped` ([#1716](https://github.com/solarssk/admitto/pull/1716))
- Send `Cache-Control: no-store` on every API answer, except the live check-in stream, so a shared check-in tablet's browser is told to keep none ([#1741](https://github.com/solarssk/admitto/pull/1741))

## [0.7.5] - 2026-10-14

### Added

- Add `admitto attendees erase` and `admitto attendees find` to the emergency CLI in place of the manual SQL delete ([#1633](https://github.com/solarssk/admitto/pull/1633))
- Retry deleting the wallet pass of an erased attendee at the provider in the daily retention run and `admitto retention run` ([#1632](https://github.com/solarssk/admitto/pull/1632))
- Cap the worker's log relay at 90 lines a minute, 20 per message, so a burst cannot hide the run summary ([#1632](https://github.com/solarssk/admitto/pull/1632))
- Delete export files and staged import CSVs after 7 days (`EXPORT_FILE_RETENTION_DAYS`, `IMPORT_STAGED_FILE_RETENTION_DAYS`) and at once after an erasure ([#1631](https://github.com/solarssk/admitto/pull/1631))
- Add staff API routes to remove an attendee from an event for good, with a reason from a fixed list ([#1629](https://github.com/solarssk/admitto/pull/1629))
- Let staff erase an attendee's personal data from the screens, with a read-only page for the erased attendee ([#1627](https://github.com/solarssk/admitto/pull/1627))
- Show on an erased attendee's page who erased the person, when and from where ([#1643](https://github.com/solarssk/admitto/pull/1643))
- Replace "Delete attendee" with "Remove from event", which asks for a reason ([#1630](https://github.com/solarssk/admitto/pull/1630))
- Leave erased attendees out of wallet passes, updates and pushes ([#1615](https://github.com/solarssk/admitto/pull/1615))
- Make the staff API treat an erased attendee as read-only and leave them out of lists and exports ([#1617](https://github.com/solarssk/admitto/pull/1617))
- Add a staff API to erase the personal data of one attendee or a selection ([#1618](https://github.com/solarssk/admitto/pull/1618))
- Keep the row of an erased attendee for Reports while clearing every personal detail ([#1611](https://github.com/solarssk/admitto/pull/1611))
- Leave erased attendees out of ticket emails and wait for a running erasure ([#1614](https://github.com/solarssk/admitto/pull/1614))
- Make check-in, item handout, notes and the activity log refuse an erased attendee ([#1612](https://github.com/solarssk/admitto/pull/1612))
- Let the automated pull request review request a Codex review when Claude is unavailable ([#1570](https://github.com/solarssk/admitto/pull/1570))
- Add one loading standard to the staff app: named loading screens, placeholders, a slow-load notice and a Retry on timeout ([#1522](https://github.com/solarssk/admitto/pull/1522))
- Keep one status comment on each pull request from the automated review, and confine the reviewer to read-only tools ([#1589](https://github.com/solarssk/admitto/pull/1589), [#1600](https://github.com/solarssk/admitto/pull/1600))

### Changed

- Place the "View" popover of the audit logs with the shared positioning code used by the other menus ([#1654](https://github.com/solarssk/admitto/pull/1654))
- Open the date, time and timezone pickers and the venue suggestions with the shared positioning code ([#1651](https://github.com/solarssk/admitto/pull/1651))
- Make the automated review read the nested `AGENTS.md` files and `standards/` pages of the area a change touches ([#1645](https://github.com/solarssk/admitto/pull/1645))
- Add `RATE_LIMIT_OVERRIDES` to retune any rate limit without a new release or image; recreate the container to apply it ([#1638](https://github.com/solarssk/admitto/pull/1638))
- Raise the per-address limits on sign-in, passkey sign-in and single sign-on to 30, 30 and 60 a minute ([#1638](https://github.com/solarssk/admitto/pull/1638))
- Remove `DELETE .../attendees/:id` and `POST .../attendees/bulk-delete` (they answer 404) in favour of `POST .../attendees/:id/remove` and `.../bulk-remove` ([#1630](https://github.com/solarssk/admitto/pull/1630))
- Add jitter to check-in live-update reconnects, so devices that lost the connection together do not all return at once ([#1638](https://github.com/solarssk/admitto/pull/1638))
- Raise the number of open check-in streams per operator and event from 3 to 6 ([#1638](https://github.com/solarssk/admitto/pull/1638))
- Raise the automated review limits to 100 attempts per pull request and 1000 per day ([#1635](https://github.com/solarssk/admitto/pull/1635))
- Make the loading spinner take the colour of the button or text around it ([#1522](https://github.com/solarssk/admitto/pull/1522))
- Move every screen of the staff app onto the shared loading standard, with identical busy buttons and load errors ([#1522](https://github.com/solarssk/admitto/pull/1522))
- Keep operators signed in on the day of their event instead of "Keep me signed in": the `OPERATOR_EVENT_DAY_SESSIONS` switch replaces `OPERATOR_REMEMBER_ME_DAYS` ([#1531](https://github.com/solarssk/admitto/pull/1531))

### Fixed

- Stop one unrenderable stored message from blocking the mail queue ([#1684](https://github.com/solarssk/admitto/pull/1684))
- Share per-delivery ownership between email retries and worker sends, so concurrent attempts are skipped ([#1681](https://github.com/solarssk/admitto/pull/1681))
- Keep a quoted multiline field in a CSV or XLSX import as one attendee record ([#1679](https://github.com/solarssk/admitto/pull/1679))
- Keep address-search and map-pin lookups, and each event's time zone, in separate caches ([#1678](https://github.com/solarssk/admitto/pull/1678))
- Give the Docker Compose worker the same Redis credentials as the app and migration service ([#1675](https://github.com/solarssk/admitto/pull/1675))
- Fall back to the default for an invalid or out-of-range import recovery interval ([#1677](https://github.com/solarssk/admitto/pull/1677))
- Share the event-capacity lock between manual creation, restoration and imports, so the last place is never taken twice ([#1674](https://github.com/solarssk/admitto/pull/1674))
- Serialise undo check-in and new admissions per event and device, so a repeated undo cannot clear a newer admission ([#1673](https://github.com/solarssk/admitto/pull/1673))
- Fix the Chrome DevTools form-field warnings (label `for`, missing `id` or `name`) in the staff app ([#1653](https://github.com/solarssk/admitto/pull/1653))
- Make the arrows of a scrolling tab strip cover the clipped tab names again ([#1652](https://github.com/solarssk/admitto/pull/1652))
- Place menus and pickers with Floating UI, so they stay inside the window and open above the button when needed ([#1646](https://github.com/solarssk/admitto/pull/1646))
- Fade dialogs out over 120 ms, and keep a dialog with fields open when a click lands outside it ([#1640](https://github.com/solarssk/admitto/pull/1640))
- Use a select for the reason in "Remove from event" ([#1640](https://github.com/solarssk/admitto/pull/1640))
- Fit the Reports hourly chart to its card, and stop clipping the Danger zone text and tab focus rings ([#1640](https://github.com/solarssk/admitto/pull/1640))
- Let running text fill its column instead of wrapping into short even lines ([#1639](https://github.com/solarssk/admitto/pull/1639))
- Fade every page in over 150 ms and let dialogs rise in with their backdrop ([#1639](https://github.com/solarssk/admitto/pull/1639))
- Stop short-named buttons reserving room for a busy text and spinner ([#1639](https://github.com/solarssk/admitto/pull/1639))
- Give the table in the automated review's status comment real column headings ([#1636](https://github.com/solarssk/admitto/pull/1636))
- Stop text wrapping one word to a line or being cut off across the staff app ([#1623](https://github.com/solarssk/admitto/pull/1623))
- Fix the Activity log and Notes layout on the attendee page on a phone ([#1626](https://github.com/solarssk/admitto/pull/1626))
- Show fewer columns in the Active sessions table on a laptop, so its rows stay short ([#1628](https://github.com/solarssk/admitto/pull/1628))
- Put keyboard focus on the scan field after a successful Retry of the check-in history, so a hardware scanner keeps working ([#1620](https://github.com/solarssk/admitto/pull/1620))
- Show template previews on the Communication page of an archived event ([#1607](https://github.com/solarssk/admitto/pull/1607))
- Make the body of an archived event's template searchable with Ctrl+F or Cmd+F ([#1607](https://github.com/solarssk/admitto/pull/1607))
- Switch off the actions the server refuses on an archived event (Count recipients, Resend, Dismiss bounce, placeholder chips) and hide the Live badge ([#1607](https://github.com/solarssk/admitto/pull/1607))
- Shorten the empty Events list text when every event is archived ([#1607](https://github.com/solarssk/admitto/pull/1607))
- Grant a policy approval when Claude is unavailable or the automatic review budget is used up ([#1569](https://github.com/solarssk/admitto/pull/1569))
- Refresh the session in place after the setup wizard or a device label, instead of resetting the whole app ([#1523](https://github.com/solarssk/admitto/pull/1523))
- Shorten the wallet confirm dialogs, notices and report descriptions ([#1527](https://github.com/solarssk/admitto/pull/1527))
- Remove the extra gap above the Danger zone notice ([#1510](https://github.com/solarssk/admitto/pull/1510))
- Polish the wallet settings: one switch for Pass expiration, one notice in Field mapping, and disabled API key links that look disabled ([#1511](https://github.com/solarssk/admitto/pull/1511))
- Shorten the "Void every active wallet pass" and "Refresh the wallet status" dialogs and the pass hints on Attendees and in Reports ([#1511](https://github.com/solarssk/admitto/pull/1511))
- Make Health check rows look the same before and after expanding ([#1513](https://github.com/solarssk/admitto/pull/1513))
- Explain why a Health check problem happened, and add advice to the rows that had none ([#1514](https://github.com/solarssk/admitto/pull/1514))
- Explain how many passes are still inside the 24-hour wait on "Remove inactive passes" ([#1525](https://github.com/solarssk/admitto/pull/1525))
- Keep icons invisible until the icon font has loaded, instead of showing empty boxes ([#1526](https://github.com/solarssk/admitto/pull/1526))
- Stop the check-in entry screen flashing "No events with check-in access" when you have exactly one event ([#1528](https://github.com/solarssk/admitto/pull/1528))
- Stop the Bitwarden extension offering an e-mail address in the check-in search field ([#1528](https://github.com/solarssk/admitto/pull/1528))
- Announce a repeated Retry failure in dialogs and keep keyboard focus inside them ([#1529](https://github.com/solarssk/admitto/pull/1529))
- Keep keyboard focus on a busy button instead of dropping it to the page ([#1530](https://github.com/solarssk/admitto/pull/1530))
- Draw the loading spinner as a turning arc in Windows High Contrast mode ([#1532](https://github.com/solarssk/admitto/pull/1532), [#1552](https://github.com/solarssk/admitto/pull/1552))
- Stop saving on the Account page from replacing the whole page with a loading screen ([#1534](https://github.com/solarssk/admitto/pull/1534))
- Announce every failed load to screen readers as an alert, and add a Retry to the events list on the start screen ([#1535](https://github.com/solarssk/admitto/pull/1535))
- Announce the stale-save, live-update and crash warnings as alerts ([#1544](https://github.com/solarssk/admitto/pull/1544))
- Announce a failed ticket-type, custom-field or item list on Attendees, and keep its Retry on screen ([#1545](https://github.com/solarssk/admitto/pull/1545))
- Show the thin progress bar in Windows High Contrast mode ([#1550](https://github.com/solarssk/admitto/pull/1550))
- Keep keyboard focus on Previous and Next under paged lists ([#1551](https://github.com/solarssk/admitto/pull/1551))
- Move focus to the tab's own panel when a Retry works on an Organisation or Event settings tab ([#1556](https://github.com/solarssk/admitto/pull/1556))
- Show a failed cropped-logo upload inside the crop window instead of on the page behind it ([#1563](https://github.com/solarssk/admitto/pull/1563))
- End the logo area's busy state when a logo is removed or its preview breaks during an upload ([#1565](https://github.com/solarssk/admitto/pull/1565))
- Stop a second copy of a ticket being emailed when two sends overlap ([#1601](https://github.com/solarssk/admitto/pull/1601))
- Stop the topbar System status saying "All systems normal" before the health checks have answered ([#1606](https://github.com/solarssk/admitto/pull/1606))
- Keep keyboard focus on "Mark all as read", "Clear all" and "Undo last check-in" while they work ([#1548](https://github.com/solarssk/admitto/pull/1548))

### Security

- Refuse request bodies over 32 KiB on the check-in POST routes and over 64 KiB on the worker's log relay with 413 ([#1683](https://github.com/solarssk/admitto/pull/1683))
- Cap weather provider replies at 1 MB, and document that `GEOCODING_TIMEOUT_MS` limits one geocoding request ([#1682](https://github.com/solarssk/admitto/pull/1682))
- Keep quoted HTML attributes intact in custom email templates when a value contains angle brackets ([#1680](https://github.com/solarssk/admitto/pull/1680))
- Leave uploaded filenames out of import upload and queue logs ([#1676](https://github.com/solarssk/admitto/pull/1676))
- Send only a fixed error category in production browser error reports ([#1672](https://github.com/solarssk/admitto/pull/1672))
- Use fixed error messages and safe log categories for wallet provider failures ([#1671](https://github.com/solarssk/admitto/pull/1671))
- Store fixed, privacy-safe messages for import and export failures ([#1670](https://github.com/solarssk/admitto/pull/1670))
- Make earlier exports unavailable at once when an attendee is erased or removed ([#1668](https://github.com/solarssk/admitto/pull/1668))
- Require a `step_up` proof (an existing code, backup code or passkey) before adding a second factor to an account that already has one ([#1583](https://github.com/solarssk/admitto/pull/1583))
- Allow "Remember this device" only in a session that has just passed two-factor sign-in, and forget remembered devices when a second factor is removed ([#1582](https://github.com/solarssk/admitto/pull/1582))
- Stop "Remember this device" from outliving a simultaneous "forget all devices" ([#1587](https://github.com/solarssk/admitto/pull/1587))
- Bind TOTP and identity provider client secrets to their purpose (AES-GCM additional data); a build older than this one cannot read values saved afterwards ([#1579](https://github.com/solarssk/admitto/pull/1579))
- Bind stored mail, wallet, IMAP and webhook secrets to their purpose; `npm run db:rebind-secret-contexts` upgrades them all, and an older release cannot read them afterwards ([#1585](https://github.com/solarssk/admitto/pull/1585))
- Apply an SMTP bounce only when its notice names the Message-ID recorded at send time, so relays that rewrite it lose bounce matching ([#1579](https://github.com/solarssk/admitto/pull/1579))
- Block carrier-grade NAT, multicast, reserved and hidden-IPv4 destinations for outbound requests; allow an exact host with `SSO_PRIVATE_DESTINATION_ALLOWLIST` or `MAIL_PRIVATE_DESTINATION_ALLOWLIST` ([#1579](https://github.com/solarssk/admitto/pull/1579))
- Validate the pre-crop original path of a named event image like the event logo, and reject anything else with `invalid_original_url` ([#1579](https://github.com/solarssk/admitto/pull/1579))
- End admin and superadmin sessions after 12 hours at most, as documented; a stored 7-day setting is reset to 12 hours, so set it again if you chose 7 days ([#1537](https://github.com/solarssk/admitto/pull/1537))
- Limit sign-in code guesses per account, and count an IPv6 /64 network as one client ([#1567](https://github.com/solarssk/admitto/pull/1567))
- Apply the per-email sign-in limit before the password is checked ([#1567](https://github.com/solarssk/admitto/pull/1567))
- Sign out every trusted device when you change your own password ([#1567](https://github.com/solarssk/admitto/pull/1567))
- Refuse oversized requests to sign-in, setup, two-factor entry (over 16 KB) and wallet webhooks (over 64 KB) before reading them ([#1567](https://github.com/solarssk/admitto/pull/1567))
- Measure the real size of an `.xlsx` import while unpacking it, to stop decompression bombs ([#1567](https://github.com/solarssk/admitto/pull/1567))
- Stop a wallet webhook sent to one event from changing the registration counts of another event's pass ([#1567](https://github.com/solarssk/admitto/pull/1567))
- Limit signed wallet provider deliveries per event only after their signature has verified ([#1579](https://github.com/solarssk/admitto/pull/1579))
- Close a live check-in or overview feed within about 25 seconds when its permission ends ([#1579](https://github.com/solarssk/admitto/pull/1579))
- Trust a replaced wallet API key for incoming webhooks at once, without a restart ([#1579](https://github.com/solarssk/admitto/pull/1579))
- Take the client address from the rightmost `X-Forwarded-For` entry not listed in `TRUSTED_PROXY_CIDRS`; list every proxy of a chain there ([#1579](https://github.com/solarssk/admitto/pull/1579))

## [0.7.4] - 2026-09-30

### Added

- Add a "Keep me signed in" duration setting (0 to 14 days) to Security settings; `OPERATOR_REMEMBER_ME_DAYS` makes it read-only ([#1431](https://github.com/solarssk/admitto/pull/1431))
- Let operators tick "Keep me signed in" so a check-in tablet stays signed in for 3 days by default ([#1430](https://github.com/solarssk/admitto/pull/1430))
- Keep the last forecast of an ended event as "Last forecast" on its card ([#1435](https://github.com/solarssk/admitto/pull/1435))
- Show "Wallet passes installed" in the Overview check-in progress ([#1458](https://github.com/solarssk/admitto/pull/1458))
- Add "Void active passes" to Attendees, More actions, run in the background for the whole event ([#1466](https://github.com/solarssk/admitto/pull/1466))
- Add "Remove inactive passes" to Attendees, More actions, removing voided or expired passes from the wallet service after a day ([#1476](https://github.com/solarssk/admitto/pull/1476), [#1497](https://github.com/solarssk/admitto/pull/1497))
- Add a one-sentence verdict above the Health check groups ([#1479](https://github.com/solarssk/admitto/pull/1479))
- Add a "Pass expiration" setting to Event settings, Wallet, that expires passes when the event ends ([#1489](https://github.com/solarssk/admitto/pull/1489), [#1498](https://github.com/solarssk/admitto/pull/1498))
- Add "what it affects" and "what to do" guidance to the known Health check problem states ([#1487](https://github.com/solarssk/admitto/pull/1487))
- Extend Health check guidance to file storage, address lookup, weather and bounce detection ([#1493](https://github.com/solarssk/admitto/pull/1493))

### Changed

- Pass the release GitHub App's Client ID instead of the deprecated App ID in the token workflows ([#1501](https://github.com/solarssk/admitto/pull/1501))
- Let the automated pull request review read the description as the author's notes, and stop blocking on settings it cannot see ([#1503](https://github.com/solarssk/admitto/pull/1503))
- Approve documentation-only pull requests by a path rule, without running the AI review ([#1500](https://github.com/solarssk/admitto/pull/1500))
- Run the automated pull request review on the maintainer's Claude subscription, with caps on attempts per pull request and per day ([#1499](https://github.com/solarssk/admitto/pull/1499), [#1504](https://github.com/solarssk/admitto/pull/1504))
- Add a manual "AI review backtest" workflow with a selectable reasoning effort ([#1492](https://github.com/solarssk/admitto/pull/1492), [#1496](https://github.com/solarssk/admitto/pull/1496))
- Wait one minute after the last push before the automated review starts, and leave lockfiles out of what it reads ([#1490](https://github.com/solarssk/admitto/pull/1490), [#1494](https://github.com/solarssk/admitto/pull/1494))
- Review the maintainer's pull requests automatically from a second identity, which approves or comments but never merges ([#1486](https://github.com/solarssk/admitto/pull/1486))
- Retire the ESLint warning baseline, so any warning fails `npm run lint` ([#1469](https://github.com/solarssk/admitto/pull/1469), [#1467](https://github.com/solarssk/admitto/pull/1467))
- Build bounce-mail patterns through one audited helper and enforce `detect-non-literal-regexp` as an error ([#1459](https://github.com/solarssk/admitto/pull/1459), [#1461](https://github.com/solarssk/admitto/pull/1461))
- Use plainer words in the wallet confirmation dialogs and menu hints ([#1465](https://github.com/solarssk/admitto/pull/1465))
- Close the "Add to Wallet" buttons once the event is over or the pass is voided, expired or removed ([#1456](https://github.com/solarssk/admitto/pull/1456))
- Enforce `detect-object-injection` as an error for the server packages and replace computed key lookups ([#1455](https://github.com/solarssk/admitto/pull/1455), [#1454](https://github.com/solarssk/admitto/pull/1454))
- Enforce `no-misused-promises` in the staff app and mark intentional background work ([#1453](https://github.com/solarssk/admitto/pull/1453), [#1451](https://github.com/solarssk/admitto/pull/1451))
- Show an amber notice with "Restore event" on the Overview of an archived event ([#1452](https://github.com/solarssk/admitto/pull/1452))
- Notice a wallet pass that PassCreator voided or expired on its own, in the background sync and "Refresh status" ([#1439](https://github.com/solarssk/admitto/pull/1439))
- Treat PassCreator's voided notification as a signal to read the pass again, so a late redelivery cannot void a restored pass ([#1439](https://github.com/solarssk/admitto/pull/1439))
- Allow "Void wallet pass", "Delete wallet pass" and "Refresh status" on an archived event or with Wallet switched off ([#1449](https://github.com/solarssk/admitto/pull/1449))
- Add "Remove from provider" for a voided or expired pass, keeping the local record and the Reports history ([#1449](https://github.com/solarssk/admitto/pull/1449))
- Offer only "Delete wallet pass" and "Remove from provider" for an expired pass ([#1449](https://github.com/solarssk/admitto/pull/1449))
- Raise the default check-in stream request limits to 120 a minute per operator and event and 240 per operator ([#1429](https://github.com/solarssk/admitto/pull/1429))
- Make the check-in live-update limits configurable with `CHECKIN_STREAM_*` environment variables; recreate the container to apply them ([#1429](https://github.com/solarssk/admitto/pull/1429))
- Line up the Overview cards at one height per row ([#1458](https://github.com/solarssk/admitto/pull/1458))
- Simplify Check-in progress on Overview to one large checked-in number beside the ring ([#1458](https://github.com/solarssk/admitto/pull/1458))
- Add a progress bar to the Overview setup checklist, with problems first and a link on every row ([#1458](https://github.com/solarssk/admitto/pull/1458))
- Call bringing an archived event back "Restore" everywhere ([#1463](https://github.com/solarssk/admitto/pull/1463))
- Show a numeric time zone offset as UTC+2 instead of GMT+2 on the ticket page, in emails and on wallet passes ([#1471](https://github.com/solarssk/admitto/pull/1471))
- Tidy the Health check header and the "Run live checks" tooltip ([#1470](https://github.com/solarssk/admitto/pull/1470))
- Split the Wallets report lifecycle card into Pass validity, Provider state and Registration state ([#1478](https://github.com/solarssk/admitto/pull/1478))
- Show a status circle and a badge on Health check rows ([#1481](https://github.com/solarssk/admitto/pull/1481))
- Sort Health check rows by severity and open the problem rows automatically ([#1482](https://github.com/solarssk/admitto/pull/1482))
- Make the Health check detail list readable, and show the worker's "Last seen" ([#1483](https://github.com/solarssk/admitto/pull/1483))
- Give pull request checks readable names, such as "Privacy guard" ([#1491](https://github.com/solarssk/admitto/pull/1491), [#1505](https://github.com/solarssk/admitto/pull/1505))
- Remove the disabled "Revoke all Wallet passes" placeholder from the Danger zone ([#1506](https://github.com/solarssk/admitto/pull/1506))
- Read the automated review's prompt and rules from `.github/ai-review/`, and count cancelled runs against its limits ([#1492](https://github.com/solarssk/admitto/pull/1492), [#1499](https://github.com/solarssk/admitto/pull/1499))

### Security

- Collapse long runs of blanks in bounce messages before matching, so a crafted bounce cannot stall the worker ([#1467](https://github.com/solarssk/admitto/pull/1467))
- Attach release SBOMs before signing them, and tag the release on the commit whose CI passed ([#1484](https://github.com/solarssk/admitto/pull/1484), [#1485](https://github.com/solarssk/admitto/pull/1485))
- Add a manual "Sign release assets" workflow that signs the SBOMs of v0.7.0 to v0.7.3 ([#1485](https://github.com/solarssk/admitto/pull/1485))
- Attach a Sigstore signature for each SBOM and a signed provenance file to every release ([#1484](https://github.com/solarssk/admitto/pull/1484))
- Attach a BuildKit SBOM attestation to published container images ([#1433](https://github.com/solarssk/admitto/pull/1433))
- Keep identity provider names, map tile addresses and exact database versions out of Health check exports ([#1474](https://github.com/solarssk/admitto/pull/1474))
- Keep unexpected weather errors and unrecognised file storage provider names out of Health check exports ([#1473](https://github.com/solarssk/admitto/pull/1473))

### Fixed

- Validate the phone and email of key contacts on Overview, in the browser and on the server ([#1457](https://github.com/solarssk/admitto/pull/1457))
- Skip the provider update for a pass already removed from the provider when an attendee is edited ([#1464](https://github.com/solarssk/admitto/pull/1464))
- Ignore a late answer after switching events, so the old event's details no longer linger ([#1452](https://github.com/solarssk/admitto/pull/1452))
- Stop the Overview countdown tile cutting "Ended 4 days ago" short; it now reads "4 days ago" under "Event ended" ([#1452](https://github.com/solarssk/admitto/pull/1452))
- Keep zooming or panning the Location map view-only, so it no longer changes the map in tickets, emails and event cards ([#1434](https://github.com/solarssk/admitto/pull/1434))
- Show readable context instead of internal identifiers in security notification emails ([#1436](https://github.com/solarssk/admitto/pull/1436))
- Stamp the commit that was actually checked out on published images, and fail the build if the label disagrees ([#1433](https://github.com/solarssk/admitto/pull/1433))
- List the newest admission first in the Reports admission log and its CSV and PDF exports ([#1428](https://github.com/solarssk/admitto/pull/1428))
- Open the on-screen keyboard when the check-in scan field is tapped on a phone or tablet ([#1427](https://github.com/solarssk/admitto/pull/1427))
- Stop showing a false "Weather unavailable" on event cards once the event is over ([#1435](https://github.com/solarssk/admitto/pull/1435))
- Tie the event-wide "Push updates" and "Refresh status" confirmations to the event they were opened on ([#1468](https://github.com/solarssk/admitto/pull/1468))
- Stop the "Void active passes" confirmation reappearing after switching events ([#1472](https://github.com/solarssk/admitto/pull/1472))
- Give a Health check row that is down the red border it was meant to have ([#1470](https://github.com/solarssk/admitto/pull/1470))
- Show benign Health check states as "Not configured" instead of "Degraded", and let "Run live checks" create a missing upload folder ([#1477](https://github.com/solarssk/admitto/pull/1477))
- Stop a slower instance overwriting an issued wallet pass with "failed" on a multi-instance deployment ([#1480](https://github.com/solarssk/admitto/pull/1480))
- Correct stale Setup checklist hints for the database and Instance URL checks ([#1495](https://github.com/solarssk/admitto/pull/1495))
- Add a "Background worker" row to the topbar System status menu ([#1502](https://github.com/solarssk/admitto/pull/1502))
- Mark a wallet pass "Expired" only once its event's current end time has passed ([#1498](https://github.com/solarssk/admitto/pull/1498))
- Check again that a new wallet template supports pass expiration when the template ID or API key changes ([#1498](https://github.com/solarssk/admitto/pull/1498))
- Reload the Health check report when returning to the tab after fixing a problem elsewhere ([#1507](https://github.com/solarssk/admitto/pull/1507))
- Stop the Overview countdown tile saying "Event ended" while the event is still going ([#1507](https://github.com/solarssk/admitto/pull/1507))
- Stop the bounce banner promising that bounced addresses "will not receive future mail" ([#1507](https://github.com/solarssk/admitto/pull/1507))
- Hide the "Failed (unexpected)" row of the Wallets report unless it is above 0 ([#1507](https://github.com/solarssk/admitto/pull/1507))
- Make the Archive event and Restore event confirmations say the same thing everywhere ([#1507](https://github.com/solarssk/admitto/pull/1507))
- Stop a file rename making the automated review treat the file as unreviewable ([#1500](https://github.com/solarssk/admitto/pull/1500))
- Scan the platform that was actually built when creating the vulnerability report and SBOM of a release image ([#1426](https://github.com/solarssk/admitto/pull/1426))
- Keep the dividers in long "More actions" menus and stop them flashing past their button ([#1507](https://github.com/solarssk/admitto/pull/1507))
- Apply `EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS` to the worker's cleanup and `admitto retention run`, not only to `nullify-delivery-snapshots` ([#1509](https://github.com/solarssk/admitto/pull/1509))

## [0.7.3] - 2026-09-23

### Added

- Disable "Add attendee" with a tooltip showing the count against the limit once an event is at capacity ([#1414](https://github.com/solarssk/admitto/pull/1414))

### Changed

- Shrink the production Docker image by assigning file ownership as files are added, instead of copying the application twice ([#1405](https://github.com/solarssk/admitto/pull/1405))

### Fixed

- Count attendees who received their ticket in the Overview "Tickets sent" tile, instead of every delivered email ([#1419](https://github.com/solarssk/admitto/pull/1419))
- Show a capacity message instead of "already registered" when adding an attendee to a full event ([#1414](https://github.com/solarssk/admitto/pull/1414))
- Count each attendee's first send of any template as "Initial" in the Mail report chart ([#1417](https://github.com/solarssk/admitto/pull/1417))
- Darken the "no results yet" text and the checked-in percentage on the check-in page to meet the contrast minimum ([#1422](https://github.com/solarssk/admitto/pull/1422))
- Darken pale tab labels, the green "Live" indicator and "issued" item text to meet the contrast minimum ([#1424](https://github.com/solarssk/admitto/pull/1424))

## [0.7.2] - 2026-09-20

### Fixed

- Keep the Logs layout stable, so Audit and Security history keeps its full height after a visit to My Account ([#1395](https://github.com/solarssk/admitto/pull/1395))
- Page an attendee's Activity log with a rows-per-page choice, instead of loading only the newest 50 entries ([#1393](https://github.com/solarssk/admitto/pull/1393))

### Changed

- Keep an attendee's selected tab in the address (`?tab=activity`, `?tab=notes`) ([#1394](https://github.com/solarssk/admitto/pull/1394))
- Open a notification's full message from the topbar bell ([#1391](https://github.com/solarssk/admitto/pull/1391))

## [0.7.1] - 2026-09-19

### Added

- Add a "Ticket status" value to the wallet field mapping ([#1383](https://github.com/solarssk/admitto/pull/1383))
- Let the wallet field mapping use Single choice and Yes/No custom fields ([#1384](https://github.com/solarssk/admitto/pull/1384))
- Show an "Added from" row (browser and OS) on the attendee's Wallet card once a pass is confirmed installed ([#1342](https://github.com/solarssk/admitto/pull/1342))
- Show the city next to the country in audit logs, sessions and new-location alerts (GeoLite2 City; `MAXMIND_LICENSE_KEY` fetches the data directly) ([#1378](https://github.com/solarssk/admitto/pull/1378))

### Changed

- Enforce the `no-unsafe-*` lint rules by typing admin, API, import, map and settings boundaries explicitly ([#1374](https://github.com/solarssk/admitto/pull/1374), [#1375](https://github.com/solarssk/admitto/pull/1375), [#1376](https://github.com/solarssk/admitto/pull/1376), [#1377](https://github.com/solarssk/admitto/pull/1377), [#1379](https://github.com/solarssk/admitto/pull/1379))
- Enforce `no-floating-promises`, `only-throw-error`, exhaustive hook dependencies and static email asset paths ([#1380](https://github.com/solarssk/admitto/pull/1380), [#1381](https://github.com/solarssk/admitto/pull/1381), [#1386](https://github.com/solarssk/admitto/pull/1386), [#1387](https://github.com/solarssk/admitto/pull/1387))
- Start loading a deep link's destination while the event context resolves, and load one event instead of the full picker list ([#1330](https://github.com/solarssk/admitto/pull/1330))

### Fixed

- Re-check the saved pass before a second creation attempt, so simultaneous wallet-link taps cannot issue a duplicate ([#1382](https://github.com/solarssk/admitto/pull/1382))
- Keep cached formula values and Excel error values when importing attendees from XLSX ([#1368](https://github.com/solarssk/admitto/pull/1368))
- Stop repeating the session check on startup through the connection-status heartbeat ([#1330](https://github.com/solarssk/admitto/pull/1330))
- Stop security alert emails inheriting the organisation's Reply-To address, which sent some alerts to Spam ([#1343](https://github.com/solarssk/admitto/pull/1343))
- Show readable labels and real recipients for notification events in the Security log ([#1344](https://github.com/solarssk/admitto/pull/1344))
- Show the full country name, device, IP address and time in new-location sign-in alerts ([#1366](https://github.com/solarssk/admitto/pull/1366))
- Send a referrer with interactive map tile requests, so OpenStreetMap stops answering 403 ([#1385](https://github.com/solarssk/admitto/pull/1385))

## [0.7.0] - 2026-09-13

### Added

- Shut the `app` container down gracefully on `docker stop`: finish in-flight requests for up to 6 seconds, then disconnect the database ([#1277](https://github.com/solarssk/admitto/pull/1277))
- Add a Notifications tab to Organisation Settings with a webhook, extra email recipients and a switch per channel for each alert type ([#1283](https://github.com/solarssk/admitto/pull/1283))
- Alert on repeated failed sign-ins, emergency two-factor bypass use, login or security setting changes and sign-ins from a new country ([#1297](https://github.com/solarssk/admitto/pull/1297), [#1299](https://github.com/solarssk/admitto/pull/1299))
- Describe each alert type in plain language in Notifications settings, My Account and the alert emails ([#1315](https://github.com/solarssk/admitto/pull/1315))
- Add a Notifications section to My Account and a topbar bell with an unread count and recent alerts ([#1303](https://github.com/solarssk/admitto/pull/1303))
- Add a Light/Dark toggle to the ticket email preview ([#1305](https://github.com/solarssk/admitto/pull/1305))
- Let the Attendees Filters panel select several ticket types, attendance statuses or mail delivery statuses at once ([#1307](https://github.com/solarssk/admitto/pull/1307))
- Add a trash icon to the notification bell to clear your history, and delete notifications after 30 days (`NOTIFICATION_RETENTION_DAYS`) ([#1320](https://github.com/solarssk/admitto/pull/1320))
- Filter Attendees by any custom field defined on the Requirements page ([#1313](https://github.com/solarssk/admitto/pull/1313))

### Changed

- Organise My Account into Profile, Password, Sessions and Notifications tabs, and paginate Active sessions ([#1321](https://github.com/solarssk/admitto/pull/1321))
- Replace the Primary colour picker with a "Theme by surface" section that has a colour per surface ([#1314](https://github.com/solarssk/admitto/pull/1314))
- Signal the removal of a passkey to supported browsers (WebAuthn Signal API), and disable "Add" where passkeys are unsupported ([#1269](https://github.com/solarssk/admitto/pull/1269))
- Rename the "Same day" bucket in the Wallets time-to-install charts to "Within 24h" ([#1273](https://github.com/solarssk/admitto/pull/1273))
- Give security notification emails the shared mail layout and an organisation-name subject, and make the Discord webhook easier to read ([#1282](https://github.com/solarssk/admitto/pull/1282))
- Split "Not reached" in the Mail report into "Never sent" and "Send failed" ([#1306](https://github.com/solarssk/admitto/pull/1306))
- Replace the template body text box with a CodeMirror editor with placeholder highlighting and autocomplete ([#1317](https://github.com/solarssk/admitto/pull/1317))

### Fixed

- Cap the notification bell's unread badge at the 30 notifications the list can show ([#1320](https://github.com/solarssk/admitto/pull/1320))
- Show the confirmation dialog in front of an open dropdown ([#1320](https://github.com/solarssk/admitto/pull/1320))
- Name the affected account and the changed setting in security alerts instead of a masked identifier ([#1301](https://github.com/solarssk/admitto/pull/1301))
- Show the real recipient address of staff accounts in System logs `mail_sent` entries ([#1301](https://github.com/solarssk/admitto/pull/1301))
- Stop the optional Redis live-update fan-out delivering an event twice after a timed-out publish ([#1296](https://github.com/solarssk/admitto/pull/1296))
- Show error and warning messages across the admin app in the shared notice box, with a Retry on screens that could not load ([#1270](https://github.com/solarssk/admitto/pull/1270))
- Title the Requirements load error for a permission failure "You do not have access to this event" ([#1271](https://github.com/solarssk/admitto/pull/1271))
- Fix the spacing and label styling in the template editor ([#1317](https://github.com/solarssk/admitto/pull/1317))
- Add a 15-second timeout to Microsoft Graph and Power Automate sends ([#1274](https://github.com/solarssk/admitto/pull/1274))
- Fix the "Send test email" message in classic Outlook (PNG fallback logo) and in dark-mode mail clients ([#1281](https://github.com/solarssk/admitto/pull/1281))
- Show the full wordmark when the tablet sidebar rail is expanded ([#1311](https://github.com/solarssk/admitto/pull/1311))
- Clip the sidebar contents during the rail animation, so the wordmark no longer spills into the page ([#1311](https://github.com/solarssk/admitto/pull/1311))
- Fix text inputs with a leading icon on phones and tablets: width, missing top border and hidden icon ([#1310](https://github.com/solarssk/admitto/pull/1310))

### Security

- Verify that an SSO provider's discovery document reports the configured issuer (ASVS V10.5.3) ([#1324](https://github.com/solarssk/admitto/pull/1324))
- Reject `__proto__`, `constructor` and `prototype` as a custom attendee field identifier ([#1313](https://github.com/solarssk/admitto/pull/1313))
- Stop a finished attendee export keeping a custom text filter value in its job metadata ([#1313](https://github.com/solarssk/admitto/pull/1313))
- Notify an admin of changes to their own password, two-factor method, passkey, trusted devices or SSO connection; the alert cannot be turned off ([#1304](https://github.com/solarssk/admitto/pull/1304), [#1308](https://github.com/solarssk/admitto/pull/1308))
- Notify an admin of their own sign-in from a new country; the alert cannot be turned off ([#1309](https://github.com/solarssk/admitto/pull/1309))
- Notify the admin team when a user is granted the admin or superadmin role, including through SSO or Cloudflare Access group mapping ([#1312](https://github.com/solarssk/admitto/pull/1312))
- Notify an admin when a two-factor code is replayed after it already signed someone in ([#1316](https://github.com/solarssk/admitto/pull/1316))
- Run `apt-get upgrade` when installing the container's base packages, to pick up Debian security fixes ([#1252](https://github.com/solarssk/admitto/pull/1252))
- Bound every database query with a 30-second Postgres `statement_timeout` ([#1275](https://github.com/solarssk/admitto/pull/1275))
- Bump `js-yaml`, `svgo` and `hono` for newly disclosed advisories ([#1278](https://github.com/solarssk/admitto/pull/1278))

## [0.6.8] - 2026-09-05

### Changed

- Turn the Wallets "Devices per attendee" card into a two-ring donut that also shows the device-registration total ([#1250](https://github.com/solarssk/admitto/pull/1250))

### Fixed

- Log a `mail_test_send_failed` entry in System logs when a template test send fails ([#1248](https://github.com/solarssk/admitto/pull/1248))

## [0.6.7] - 2026-09-03

### Added

- Add a "By wallet status" recipient filter to the Communication Send screen ([#1224](https://github.com/solarssk/admitto/pull/1224))
- Add CSV and PDF export for the Mail and Custom fields tabs in Reports ([#1220](https://github.com/solarssk/admitto/pull/1220))
- Mirror the published container image to Docker Hub (`docker.io/solarssk/admitto`) on each release tag ([#1221](https://github.com/solarssk/admitto/pull/1221))

### Changed

- Count a wallet pass as "Installed" in Reports once it was ever confirmed installed, not only while it is registered ([#1218](https://github.com/solarssk/admitto/pull/1218))
- Centre the Wallet lifecycle donut on the total issued ([#1215](https://github.com/solarssk/admitto/pull/1215))

### Fixed

- Keep a pass's registration counts when PassCreator finds no matching pass during the sync ([#1217](https://github.com/solarssk/admitto/pull/1217))
- Stop saving Event Settings piling up duplicate PassCreator registration webhooks for events still on the old URL ([#1214](https://github.com/solarssk/admitto/pull/1214))
- Require a ticket link and QR code only in the ticket email template ([#1216](https://github.com/solarssk/admitto/pull/1216))
- Flip a dropdown above its trigger when its content is just taller than the room below ([#1224](https://github.com/solarssk/admitto/pull/1224))

## [0.6.6] - 2026-09-03

### Added

- Track when a wallet pass is confirmed installed (PassCreator `first_pushnotification_registered`), and measure "Time to wallet install" from it ([#1203](https://github.com/solarssk/admitto/pull/1203))
- Add a "Devices per attendee" card to the Reports Wallets tab ([#1203](https://github.com/solarssk/admitto/pull/1203))
- Add a "Wallet lifecycle" card to the Reports Wallets tab ([#1204](https://github.com/solarssk/admitto/pull/1204))
- Show an "Add to Samsung Wallet" button on ticket pages when Samsung Wallet is enabled for the event ([#1205](https://github.com/solarssk/admitto/pull/1205))
- Read real Samsung Wallet registration data in the Reports Wallets tab and the wallet exports ([#1206](https://github.com/solarssk/admitto/pull/1206))
- Add a "Mail" tab to Reports with delivery status, attendee reach, initial versus resend, per-template success and ticket-page views ([#1209](https://github.com/solarssk/admitto/pull/1209))
- Add "Admission rate by email status" and "Event journey" cards to the Mail tab ([#1211](https://github.com/solarssk/admitto/pull/1211))
- Add a "Time to install after reminder" card, and a last-reminder column to the wallet export ([#1212](https://github.com/solarssk/admitto/pull/1212))
- Reject an "Add to Apple/Google Wallet" placeholder in a template when the event has that platform turned off ([#1212](https://github.com/solarssk/admitto/pull/1212))

### Security

- Lock the wallet Template ID once passes are issued, and verify a replacement API key against the configured template ([#1207](https://github.com/solarssk/admitto/pull/1207))
- Ask for confirmation before turning off wallet passes, or one platform, for an event with issued passes ([#1210](https://github.com/solarssk/admitto/pull/1210))

### Fixed

- Remove the "Voided" ring and the "No wallet installed" slice from the wallet adoption and platform charts ([#1202](https://github.com/solarssk/admitto/pull/1202))
- Stop the Wallets tab logging a Recharts size warning while it is hidden ([#1209](https://github.com/solarssk/admitto/pull/1209))

## [0.6.5] - 2026-09-01

### Fixed

- Cap the Reports Custom fields grid at two columns ([#1198](https://github.com/solarssk/admitto/pull/1198))
- Use fixed colours in the Wallet adoption card instead of the branding colour ([#1198](https://github.com/solarssk/admitto/pull/1198))
- Report the actual install rate in "Adoption by ticket type" ([#1198](https://github.com/solarssk/admitto/pull/1198))
- Recognise accepted ticket-email deliveries in "Time to wallet tap" and the wallet export ([#1198](https://github.com/solarssk/admitto/pull/1198))
- Unmount the Custom fields charts while their tab is hidden, to stop a Recharts size warning ([#1198](https://github.com/solarssk/admitto/pull/1198))
- Group "Push updates" and "Refresh status" under one divider in the Attendees "More actions" menu ([#1199](https://github.com/solarssk/admitto/pull/1199))
- Scope the check-in live-updates rate limit per event, and back off longer on "too many requests" ([#1200](https://github.com/solarssk/admitto/pull/1200))
- Warn about and push wallet updates only for fields mapped in the wallet field mapping ([#1201](https://github.com/solarssk/admitto/pull/1201))

## [0.6.4] - 2026-09-01

### Added

- Publish the container image for `linux/amd64` and `linux/arm64` under one tag ([#1169](https://github.com/solarssk/admitto/pull/1169))
- Add a "Wallets" tab to Reports with adoption, platform mix, time to install and check-in rate, plus CSV and PDF export ([#1125](https://github.com/solarssk/admitto/pull/1125), [#1126](https://github.com/solarssk/admitto/pull/1126))
- Add a "Custom fields" tab to Reports with one chart per custom field ([#1185](https://github.com/solarssk/admitto/pull/1185))
- Add passkey sign-in toggles to Security settings, and a "Sign in with a passkey" option on the login page ([#1107](https://github.com/solarssk/admitto/pull/1107), [#1108](https://github.com/solarssk/admitto/pull/1108))
- Edit select-type custom field options in a guarded list that shows usage and can be reordered ([#1106](https://github.com/solarssk/admitto/pull/1106))
- Add a torch toggle to the check-in camera scanner ([#1104](https://github.com/solarssk/admitto/pull/1104))
- Add a "Stop" button for bulk email sends in progress ([#1105](https://github.com/solarssk/admitto/pull/1105))
- Make the Samsung Wallet switch in Event Settings a real setting ([#1137](https://github.com/solarssk/admitto/pull/1137))
- Confirm how many wallet passes a cascading save will update before saving ([#1182](https://github.com/solarssk/admitto/pull/1182))
- Add "Push updates" for the whole event to the Attendees "More actions" menu ([#1190](https://github.com/solarssk/admitto/pull/1190))
- Add "Set company" and "Set department" bulk actions to the Attendees selection bar ([#1189](https://github.com/solarssk/admitto/pull/1189))
- Add a bulk "Refresh status" wallet action to the Attendees selection bar ([#1187](https://github.com/solarssk/admitto/pull/1187))
- Add "Refresh status" for the whole event to the Attendees "More actions" menu ([#1191](https://github.com/solarssk/admitto/pull/1191))
- Redirect `/.well-known/change-password` to the right password-change page ([#1195](https://github.com/solarssk/admitto/pull/1195))
- Add an "Autofill passkey suggestions" toggle to Security settings ([#1195](https://github.com/solarssk/admitto/pull/1195))

### Changed

- Label the Attendees header button "More actions" at desktop widths ([#1187](https://github.com/solarssk/admitto/pull/1187))
- Respect the event's Wallet platform toggles in Attendees, Attendee Detail and Reports ([#1136](https://github.com/solarssk/admitto/pull/1136), [#1137](https://github.com/solarssk/admitto/pull/1137))
- Show mail settings validation errors inline on the field that is wrong ([#1110](https://github.com/solarssk/admitto/pull/1110))
- Check that the top-level domain of mail addresses in settings is a real one ([#1110](https://github.com/solarssk/admitto/pull/1110))
- Show bulk-send progress tiles and a summary card, and hide "Send another" until the batch has finished ([#1102](https://github.com/solarssk/admitto/pull/1102))
- Hide internal item and custom field slugs on Requirements unless two names collide ([#1114](https://github.com/solarssk/admitto/pull/1114))
- Show a "Cancelled" mail delivery status in the Delivery log and on Attendees ([#1105](https://github.com/solarssk/admitto/pull/1105))
- Refactor Event Settings into per-tab components, with no change in behaviour ([#1183](https://github.com/solarssk/admitto/pull/1183))
- Move check-in behaviour into its own Event Settings tab, saved together with Save and Reset ([#1184](https://github.com/solarssk/admitto/pull/1184))

### Fixed

- Crop the Samsung Wallet icon so it matches the Apple and Google icons ([#1194](https://github.com/solarssk/admitto/pull/1194))
- Show field names as icons on the mobile Attendees cards, so Pass, Attendance and Mail stay on one line ([#1194](https://github.com/solarssk/admitto/pull/1194))
- Correct the CSS token fallback values for spacing, radius, shadow and typography, and check them automatically ([#1140](https://github.com/solarssk/admitto/pull/1140))
- Use the real tooltip for the SAML tile and the font-preview hints, and give "Clear selection" a focus ring ([#1145](https://github.com/solarssk/admitto/pull/1145))
- Flag the connection state when the Archiving events list fails to load ([#1124](https://github.com/solarssk/admitto/pull/1124))
- Stop the Mail settings page re-scrolling on every Save click while a field is invalid ([#1110](https://github.com/solarssk/admitto/pull/1110))
- Validate the SMTP advanced tuning fields instead of silently dropping them on save ([#1110](https://github.com/solarssk/admitto/pull/1110))
- Render form fields on touch devices at the desktop visual size while keeping the 16px that prevents iOS zoom ([#1103](https://github.com/solarssk/admitto/pull/1103))
- Centre the Active toggle of Event items in its row ([#1114](https://github.com/solarssk/admitto/pull/1114))
- Stop editing a custom field definition from re-sending its select options ([#1100](https://github.com/solarssk/admitto/pull/1100))
- Stop the Delivery log dropping rows at 200 rows per page ([#1101](https://github.com/solarssk/admitto/pull/1101))
- Stop the same custom field being picked on more than one event item ([#1113](https://github.com/solarssk/admitto/pull/1113))
- Keep the passkey "Add" button visible but disabled when the passkey feature is off ([#1115](https://github.com/solarssk/admitto/pull/1115))
- Make wording and colour tokens consistent across the admin panel ([#1124](https://github.com/solarssk/admitto/pull/1124))
- Show which field is wrong when External services or the Wallet connection test fails validation ([#1123](https://github.com/solarssk/admitto/pull/1123))
- Show specific messages for about 90 error conditions, with a check that every new error code gets one ([#1121](https://github.com/solarssk/admitto/pull/1121))
- Say which Templates action failed ("Save failed.", "Preview failed.") instead of "Request failed." ([#1120](https://github.com/solarssk/admitto/pull/1120))
- Give the public ticket page's error pages the standard red, and announce the revoked notice as an alert ([#1119](https://github.com/solarssk/admitto/pull/1119))
- Show the actual reason when identity providers or Cloudflare Access fail to load ([#1118](https://github.com/solarssk/admitto/pull/1118))
- Use the amber warning style for "Revoke check-in?" on Attendee detail and the check-in card ([#1122](https://github.com/solarssk/admitto/pull/1122))
- Show which attribute field is wrong, and why, when adding or editing an attendee fails validation ([#1117](https://github.com/solarssk/admitto/pull/1117))
- Say "Could not load X" consistently in about 30 load errors, and match each error box title to its message ([#1130](https://github.com/solarssk/admitto/pull/1130), [#1135](https://github.com/solarssk/admitto/pull/1135))
- Use the app's own "Discard unsaved changes?" dialog in the Identity editors ([#1134](https://github.com/solarssk/admitto/pull/1134))
- Match the label style of the authenticator or backup code field in the user reset dialog ([#1133](https://github.com/solarssk/admitto/pull/1133))
- Show "Send failed." for an unrecognised send error in the Templates test send ([#1132](https://github.com/solarssk/admitto/pull/1132))
- Retry a Microsoft Graph send whose token response has no access token ([#1132](https://github.com/solarssk/admitto/pull/1132))
- Use the default style for "Discard unsaved changes?" in the template editor and Event settings ([#1131](https://github.com/solarssk/admitto/pull/1131))
- Correct 42 colour-token fallback values and check them automatically ([#1129](https://github.com/solarssk/admitto/pull/1129))
- Stop "Remember this device" depending on the IP address, so trust follows the device cookie ([#1128](https://github.com/solarssk/admitto/pull/1128))
- Mark the Create event timezone picker as required for screen readers ([#1164](https://github.com/solarssk/admitto/pull/1164))

### Security

- Record in Logs & Audit when a remembered device skips two-factor at sign-in ([#1128](https://github.com/solarssk/admitto/pull/1128))
- Replace ApexCharts with Recharts in the wallet reports, because of ApexCharts licence terms ([#1165](https://github.com/solarssk/admitto/pull/1165))
- Block phone-number-shaped strings in tracked data files in the `pii-guard` CI job ([#1158](https://github.com/solarssk/admitto/pull/1158))
- Send `Cache-Control: no-store` on the Event day, Wallets and Custom fields Reports endpoints ([#1186](https://github.com/solarssk/admitto/pull/1186))
- Log the client IP for every request when `LOG_HTTP_REQUESTS=1`, with a hashed `ref` for ticket and QR paths ([#1197](https://github.com/solarssk/admitto/pull/1197))

## [0.6.3] - 2026-08-26

### Added

- Add an "Event type" field and a "Venue access details" section to Event Settings, mappable onto wallet passes ([#1098](https://github.com/solarssk/admitto/pull/1098))

### Changed

- Remove the Wallet "Semantic tags" toggle, which PassCreator ignored ([#1098](https://github.com/solarssk/admitto/pull/1098))

### Security

- Rate-limit client error reports to 30 a minute per user, and stop a blocked CSP report from re-triggering itself ([#1089](https://github.com/solarssk/admitto/pull/1089), [#1091](https://github.com/solarssk/admitto/pull/1091))
- Rate-limit the weather connectivity test to 5 a minute per user ([#1090](https://github.com/solarssk/admitto/pull/1090))
- Apply the OIDC-discovery rate limit to creating an identity provider, with a fallback bucket per route ([#1090](https://github.com/solarssk/admitto/pull/1090))
- Require step-up re-authentication, and add a per-target rate limit, to revoke another superadmin's sessions ([#1090](https://github.com/solarssk/admitto/pull/1090))
- Accept a passkey or security key as step-up proof in the Users page dialogs ([#1090](https://github.com/solarssk/admitto/pull/1090))

## [0.6.2] - 2026-08-25

### Added

- Add "Refresh status" to the Attendee detail wallet "More actions" menu ([#1068](https://github.com/solarssk/admitto/pull/1068))
- Log unhandled promise rejections and uncaught exceptions to System logs and stdout before the process exits ([#1065](https://github.com/solarssk/admitto/pull/1065))

### Changed

- Load the timezone database as its own build chunk, to shrink the main entry script ([#1078](https://github.com/solarssk/admitto/pull/1078))
- Make the check-in camera scanner try harder on difficult QR codes ([#1084](https://github.com/solarssk/admitto/pull/1084))

### Fixed

- Save the full structured address when a venue is picked while creating an event ([#1087](https://github.com/solarssk/admitto/pull/1087))
- Update the ticket type badge preview live while the name is typed ([#1086](https://github.com/solarssk/admitto/pull/1086))
- Record the operator's timezone in the "Ticket link copied" activity entry ([#1062](https://github.com/solarssk/admitto/pull/1062))
- Stop showing a stale error for a delivery that succeeded on a retry, and clear its stored error ([#1076](https://github.com/solarssk/admitto/pull/1076), [#1077](https://github.com/solarssk/admitto/pull/1077))
- Retry once when PassCreator's duplicate check and search index briefly disagree on a first "Add to Wallet" ([#1068](https://github.com/solarssk/admitto/pull/1068))
- Share one in-flight pass creation when "Add to Wallet" is tapped from two devices at once ([#1068](https://github.com/solarssk/admitto/pull/1068))
- Raise the public ticket, QR and static map rate limit from 60 to 500 requests a minute per address ([#1069](https://github.com/solarssk/admitto/pull/1069))
- Loosen the single-attendee wallet action limit to 10 requests a minute ([#1081](https://github.com/solarssk/admitto/pull/1081))
- Loosen the bulk wallet action limit to 10 requests every 10 minutes ([#1081](https://github.com/solarssk/admitto/pull/1081))
- Cap Vitest worker concurrency and raise the test timeout, to stop intermittent failures of the admin suite ([#1079](https://github.com/solarssk/admitto/pull/1079))
- Show Recent activity and check-in timestamps in the acting admin's timezone ([#1083](https://github.com/solarssk/admitto/pull/1083))

### Security

- Send HSTS from the ticket page, the staff app and the sign-in pages, not only from the API ([#1066](https://github.com/solarssk/admitto/pull/1066))
- Allow the camera only in the staff app and deny the other device features with a Permissions-Policy ([#1066](https://github.com/solarssk/admitto/pull/1066))
- Stop the bundled nginx overriding the ticket page's own Referrer-Policy ([#1066](https://github.com/solarssk/admitto/pull/1066))
- Check a custom map tile URL for private, loopback and metadata hosts when it is saved ([#1065](https://github.com/solarssk/admitto/pull/1065))
- Stop the bundled nginx reporting its version ([#1066](https://github.com/solarssk/admitto/pull/1066))
- Stop the root-only fallback of `docker-entrypoint.sh` rebuilding a shell command from its arguments ([#1065](https://github.com/solarssk/admitto/pull/1065))
- Rate-limit the bulk attendee actions and the wallet actions that call the provider ([#1064](https://github.com/solarssk/admitto/pull/1064))
- Give whole-selection wallet actions, bulk delete and bulk pass revoke their own tighter rate limit ([#1064](https://github.com/solarssk/admitto/pull/1064))
- Pace every call to PassCreator at a steady rate, so bulk actions cannot burst past its limit ([#1064](https://github.com/solarssk/admitto/pull/1064))
- Cap bulk wallet actions, and bulk delete or pass revoke on wallet events, at 100 attendees per request ([#1064](https://github.com/solarssk/admitto/pull/1064))
- Fall back to a per-process limiter when Redis is unreachable, instead of allowing unlimited traffic ([#1080](https://github.com/solarssk/admitto/pull/1080))
- Lower the recovery-code verification limit to 10 attempts per 15 minutes ([#1081](https://github.com/solarssk/admitto/pull/1081))
- Cap concurrent bulk wallet actions per admin and event ([#1064](https://github.com/solarssk/admitto/pull/1064))
- Add hourly and per-recipient limits to template test sends and mail transport tests ([#1082](https://github.com/solarssk/admitto/pull/1082))
- Separate the connectivity probes from the test-send rate limits ([#1082](https://github.com/solarssk/admitto/pull/1082))

## [0.6.1] - 2026-08-25

### Added

- Report admin errors that happen outside React's render cycle to the server, including scripts blocked by the Content-Security-Policy ([#1053](https://github.com/solarssk/admitto/pull/1053))

### Changed

- Issue a ticket at once for a manually added attendee, and on demand when its link is copied ([#1054](https://github.com/solarssk/admitto/pull/1054))

### Fixed

- Give five toggle switches a stable element id ([#1053](https://github.com/solarssk/admitto/pull/1053))
- Say in the superadmin reset message that a passkey or security key also works as a second factor ([#1052](https://github.com/solarssk/admitto/pull/1052))
- Clamp long Scope and Template names to two lines and wrap IPv6 addresses in the Audit logs, sessions, Role assignments and delivery log tables ([#1055](https://github.com/solarssk/admitto/pull/1055), [#1056](https://github.com/solarssk/admitto/pull/1056))
- Retry an SMTP failure that is not classified as temporary or permanent ([#1060](https://github.com/solarssk/admitto/pull/1060))
- Stop saving Event Settings piling up duplicate PassCreator webhooks when listing them fails ([#1057](https://github.com/solarssk/admitto/pull/1057))
- Time out a PassCreator request that gets no response after 15 seconds ([#1059](https://github.com/solarssk/admitto/pull/1059))
- Record a wallet push that failed for every attendee as a failed job ([#1059](https://github.com/solarssk/admitto/pull/1059))

## [0.6.0] - 2026-08-24

### Added

- Add passkeys and security keys as extra two-factor methods in My account, managed in popups ([#886](https://github.com/solarssk/admitto/pull/886))
- Add a Backup codes row to My account that shows the unused codes and a Regenerate action ([#886](https://github.com/solarssk/admitto/pull/886))
- Accept a passkey or security key to confirm sensitive account actions, such as a password change or removing a method ([#1017](https://github.com/solarssk/admitto/pull/1017), [#1019](https://github.com/solarssk/admitto/pull/1019))
- Allow the two-factor sign-in step to be completed with a passkey or security key ([#1018](https://github.com/solarssk/admitto/pull/1018))
- Let first-time two-factor setup offer an authenticator app, a passkey or a security key ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Add "Forget all trusted devices" to My account, Two-factor authentication ([#1019](https://github.com/solarssk/admitto/pull/1019))

### Changed

- Manage two-factor methods independently in My account: "Manage" and "Remove" for the authenticator app, "Reset everything" in the options menu ([#886](https://github.com/solarssk/admitto/pull/886))
- Keep a "Remember this device" trust for its full window when the user signs out ([#1019](https://github.com/solarssk/admitto/pull/1019))

### Fixed

- Catch a stale `package-lock.json` after a Dependabot rebase in CI ([#1035](https://github.com/solarssk/admitto/pull/1035))
- Stop My Account showing "Too many requests" after a burst of two-factor management actions ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Stop offering the authenticator code field to accounts without an authenticator app, and try a passkey automatically ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Fix the spacing, alignment and error placement on the two-factor sign-in step ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Show the backup codes "Download" as a visible button below the codes ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Unlock "Regenerate" in the backup codes dialog once the new batch is saved ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Add "Choose a different method", method icons and a centred "Begin setup" to first-time two-factor setup ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Offer "Remember this device?" after a sign-in with a passkey as the only second factor ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Explain the wait while a browser or password manager handles the passkey prompt during setup ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Make the ticket link and QR code in the email preview inert ([#1020](https://github.com/solarssk/admitto/pull/1020))
- Scroll the header and footer together with the form in the Requirements editors, Delivery details and Sent message preview ([#1021](https://github.com/solarssk/admitto/pull/1021), [#1022](https://github.com/solarssk/admitto/pull/1022))
- Remove the permanent horizontal scrollbar from the staff user edit modal ([#1024](https://github.com/solarssk/admitto/pull/1024))
- Use the slim on-theme scrollbar in all remaining popups ([#1025](https://github.com/solarssk/admitto/pull/1025))
- Put Cancel before "Send tickets", and show the device label error as a notice ([#1026](https://github.com/solarssk/admitto/pull/1026))
- Show both Celsius and Fahrenheit again on the ticket page and in the event pickers ([#1047](https://github.com/solarssk/admitto/pull/1047))
- Make the Invite user phone field resist autofill again ([#1049](https://github.com/solarssk/admitto/pull/1049))
- Refuse to start the worker with an invalid bounce-ingest poll interval ([#1049](https://github.com/solarssk/admitto/pull/1049))
- Reject a private, loopback or link-local SMTP host when mail settings are saved ([#1049](https://github.com/solarssk/admitto/pull/1049))
- Reject a non-HTTPS or private Power Automate flow URL when it is saved ([#1050](https://github.com/solarssk/admitto/pull/1050))

### Security

- Rotate the session token on every MFA and password-change step ([#1034](https://github.com/solarssk/admitto/pull/1034))
- Let a passkey-only superadmin complete superadmin resets and SSO unlinking ([#1017](https://github.com/solarssk/admitto/pull/1017))
- Cap the body size of WebAuthn and step-up requests before parsing them ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Share one step-up attempt limit per session across all account actions ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Write a rejected step-up proof to the security audit log ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Record the browser timezone in passkey sign-in audit entries ([#1019](https://github.com/solarssk/admitto/pull/1019))
- Run WebAuthn verification outside open database transactions ([#1019](https://github.com/solarssk/admitto/pull/1019))

## [0.5.5] - 2026-08-23

### Added

- Add Worker, Wallet and External services log sources to Settings, Logs & audit, System ([#1004](https://github.com/solarssk/admitto/pull/1004), [#1005](https://github.com/solarssk/admitto/pull/1005), [#1007](https://github.com/solarssk/admitto/pull/1007))

### Changed

- Show the real ticket link and QR code in the "View sent message" preview ([#1003](https://github.com/solarssk/admitto/pull/1003))

### Fixed

- Allow same-origin `connect-src` on the server-rendered auth pages, so Cloudflare's own beacon is no longer blocked ([#1002](https://github.com/solarssk/admitto/pull/1002))
- Centre the Key contacts avatars against the full row height ([#1009](https://github.com/solarssk/admitto/pull/1009))
- Stop the staff user edit modal reserving scrollbar space ([#1011](https://github.com/solarssk/admitto/pull/1011))
- Narrow the System logs Level filter dropdown ([#1015](https://github.com/solarssk/admitto/pull/1015))

### Security

- Stop shipping the development toolchain in the production image, which is about 200 MB smaller and drops 11 CVEs ([#1014](https://github.com/solarssk/admitto/pull/1014))
- Stop `bootstrap-superadmin --force` hanging when its answers are piped in ([#1012](https://github.com/solarssk/admitto/pull/1012))

## [0.5.4] - 2026-08-21

### Added

- Show the real linked identity provider names in the staff user modal and the My account SSO menu ([#977](https://github.com/solarssk/admitto/pull/977))
- Ask for confirmation before a bulk check-in from the Attendees list ([#979](https://github.com/solarssk/admitto/pull/979))
- Add the `event_date_short` wallet placeholder, and set the Lock Screen relevance date on Apple Wallet passes ([#996](https://github.com/solarssk/admitto/pull/996))

### Changed

- Always use Admitto's own blue for the "Confirm check-in" button ([#985](https://github.com/solarssk/admitto/pull/985))
- Make the Attendee Overview layout a 50/50 split ([#980](https://github.com/solarssk/admitto/pull/980))
- Stop counting SSO staff as missing 2FA in the Two-factor coverage stat ([#972](https://github.com/solarssk/admitto/pull/972))
- Lay out the ticket page date, time and venue as a stat row ([#995](https://github.com/solarssk/admitto/pull/995))
- Make the wallet `event_hours` field read like the ticket page ([#996](https://github.com/solarssk/admitto/pull/996))
- Match the `{{event_date}}` and `{{event_hours}}` email placeholders to the ticket page format ([#999](https://github.com/solarssk/admitto/pull/999))

### Fixed

- Remove the linked Cloudflare Access identity when SSO is unlinked from My Account ([#987](https://github.com/solarssk/admitto/pull/987))
- Fix PassCreator wallet registration webhooks that were always rejected (key field and hash algorithm) ([#959](https://github.com/solarssk/admitto/pull/959))
- Reflect a pass voided directly in PassCreator on the attendee's Wallet status, through its own webhook subscription ([#959](https://github.com/solarssk/admitto/pull/959))
- Make the Archiving and Active sessions tables span the full card width ([#961](https://github.com/solarssk/admitto/pull/961))
- Keep the deleted event's name in "Deleted event" Audit log entries ([#969](https://github.com/solarssk/admitto/pull/969))
- Show the email address in the account menu when no display name is set ([#982](https://github.com/solarssk/admitto/pull/982))
- Show a staff member's email instead of "Admin" in the Activity log and Notes ([#970](https://github.com/solarssk/admitto/pull/970))
- Use the canonical role badge on attendee Notes ([#992](https://github.com/solarssk/admitto/pull/992))
- Stop Requirements modals shifting width when the scrollbar appears ([#971](https://github.com/solarssk/admitto/pull/971))
- Show check-in and note timestamps in the viewer's browser timezone, and the day for older notes ([#981](https://github.com/solarssk/admitto/pull/981))
- Give "2FA verified" Security log rows the "your local time" icon ([#978](https://github.com/solarssk/admitto/pull/978))
- Fix small layout issues on Check-in, Users & roles, My account, Identity, Mail and delivery history ([#960](https://github.com/solarssk/admitto/pull/960), [#966](https://github.com/solarssk/admitto/pull/966))
- Show the timezone abbreviation, lowercase am/pm and a spaced hyphen in the ticket page event hours ([#995](https://github.com/solarssk/admitto/pull/995))
- Give the password strength meter real space below the password field ([#998](https://github.com/solarssk/admitto/pull/998))

## [0.5.3] - 2026-08-18

### Added

- Add the `{{ticket_type}}` and `{{event_hours}}` mail template placeholders ([#953](https://github.com/solarssk/admitto/pull/953))
- Add "Copy ticket link" to the Attendee detail "More actions" menu ([#950](https://github.com/solarssk/admitto/pull/950))

### Fixed

- Show a wallet pass as "Added" only once PassCreator confirms a device registration ([#952](https://github.com/solarssk/admitto/pull/952))
- Resend tickets to attendees who already have one when "Send tickets" is used on a selection ([#951](https://github.com/solarssk/admitto/pull/951))
- Let staff who sign in only through Cloudflare Access use the Check-in tab ([#938](https://github.com/solarssk/admitto/pull/938))
- Land on the check-in surface after a local or IdP sign-in when Cloudflare Access protects the admin panel ([#938](https://github.com/solarssk/admitto/pull/938))
- Stop searchable dropdowns closing and reopening when their caption is pressed and held in a modal ([#939](https://github.com/solarssk/admitto/pull/939))
- Serve PNG wallet badges in email and keep SVG on the ticket page, so Outlook shows them ([#954](https://github.com/solarssk/admitto/pull/954))
- Add the missing gap below the Send test email result ([#949](https://github.com/solarssk/admitto/pull/949))
- Stop two simultaneous first-ticket sends emailing two copies ([#956](https://github.com/solarssk/admitto/pull/956))

## [0.5.2] - 2026-08-16

### Fixed

- Cache the Cloudflare Access identity per issued token, to stop repeated write-conflict errors on page load ([#925](https://github.com/solarssk/admitto/pull/925))
- Show the branded error page instead of a bare "Forbidden" when access is denied ([#926](https://github.com/solarssk/admitto/pull/926))

## [0.5.1] - 2026-08-15

### Security

- Isolate the account and two-factor management rate limits from the public sign-in page, and throttle password re-entry per account ([#919](https://github.com/solarssk/admitto/pull/919))
- Require the acting superadmin's own authenticator code to reset another superadmin's two-factor or password, and audit it separately ([#918](https://github.com/solarssk/admitto/pull/918))
- Apply the SSO-managed check at the moment a reset is written, closing a timing window ([#918](https://github.com/solarssk/admitto/pull/918))
- Keep a break-glass or backup recovery code valid when two-factor sign-in fails to complete ([#917](https://github.com/solarssk/admitto/pull/917))
- Alert superadmins after repeated incorrect two-factor codes against an admin account ([#917](https://github.com/solarssk/admitto/pull/917))
- Answer a correct password for a deactivated account as slowly as a wrong one, and record it distinctly ([#917](https://github.com/solarssk/admitto/pull/917))
- Regenerate a superadmin's emergency recovery code as an all-or-nothing operation ([#917](https://github.com/solarssk/admitto/pull/917))
- Bind "Remember this device" cookies to the IP address recorded when they were set ([#916](https://github.com/solarssk/admitto/pull/916))
- Record a dedicated "Superadmin created (bootstrap)" audit entry from `bootstrap-superadmin`, written atomically with the account ([#915](https://github.com/solarssk/admitto/pull/915))
- Bind Cloudflare Access sign-ins to an existing direct OIDC identity, and reconcile its group roles on every sign-in ([#912](https://github.com/solarssk/admitto/pull/912))

### Added

- Push a bulk ticket type change to already-issued wallet passes in the background ([#892](https://github.com/solarssk/admitto/pull/892))
- Push Event settings Location changes to already-issued wallet passes ([#893](https://github.com/solarssk/admitto/pull/893))
- Push attendee edits to their wallet pass, and add a Wallet push history list to Event settings ([#894](https://github.com/solarssk/admitto/pull/894))
- Add a Scope column and pagination to the Wallet push history, and show when each push ran ([#911](https://github.com/solarssk/admitto/pull/911))
- Add an Apple Wallet "Semantic tags" switch to Event settings ([#907](https://github.com/solarssk/admitto/pull/907))
- Allow re-cropping already uploaded event images ([#905](https://github.com/solarssk/admitto/pull/905))
- Add a Wallets tab to Communication for lock-screen messages to installed passes ([#903](https://github.com/solarssk/admitto/pull/903))
- Format dates and hours on the ticket page and wallet pass by the event's country ([#914](https://github.com/solarssk/admitto/pull/914))

### Changed

- Start attendee export, import and mail sending at once instead of waiting for the worker's next check ([#890](https://github.com/solarssk/admitto/pull/890))
- Save and reset the Ticket types tab explicitly, like the other settings tabs ([#902](https://github.com/solarssk/admitto/pull/902))

### Fixed

- Resolve daylight-saving offsets correctly for Apple Wallet semantic tags ([#922](https://github.com/solarssk/admitto/pull/922))
- Show the wiki page header as a table, and correct out-of-date wiki pages on wallets, ticket types and mail templates ([#910](https://github.com/solarssk/admitto/pull/910))
- Give the Security and Mail settings number and secret fields a stable `id` ([#888](https://github.com/solarssk/admitto/pull/888))
- Scope the CI secret scan to the commits a pull request introduces ([#891](https://github.com/solarssk/admitto/pull/891))
- Install fonts in the production image, so the ticket page map renders its text ([#883](https://github.com/solarssk/admitto/pull/883))
- Stop treating a successful PassCreator webhook subscription as a failure ([#882](https://github.com/solarssk/admitto/pull/882))
- Update wallet registration status from PassCreator webhook deliveries ([#884](https://github.com/solarssk/admitto/pull/884))
- Stop Delivery history rows collapsing on narrow screens ([#889](https://github.com/solarssk/admitto/pull/889))
- Clear the Unlink SSO password fields whenever the dialog closes ([#909](https://github.com/solarssk/admitto/pull/909))
- Keep the worker's liveness signal fresh during long imports, exports and wallet pushes ([#892](https://github.com/solarssk/admitto/pull/892))
- Show "Checked in" or "Not checked in" in attendee exports, and size PDF columns from the real data ([#901](https://github.com/solarssk/admitto/pull/901))
- Grey out Save buttons until there is something to save ([#899](https://github.com/solarssk/admitto/pull/899))
- Fix the Delivery log, wallet field mapping, Requirements and Attendees list layouts on mobile, and refresh the Delete event state after a ticket type change ([#899](https://github.com/solarssk/admitto/pull/899))

## [0.5.0] - 2026-08-13

### Added

- Let staff choose a 12-hour, 24-hour or browser-default time input, independently of the date format ([#740](https://github.com/solarssk/admitto/pull/740))
- Make the Add to Apple Wallet and Add to Google Wallet badges on the ticket page work ([#744](https://github.com/solarssk/admitto/pull/744))
- Add Wallet settings to Event settings: per-event PassCreator API key and Template ID, platform switches, Test connection and field mapping ([#748](https://github.com/solarssk/admitto/pull/748))
- Add an optional "Event hours" start and end field to New event and Event settings ([#740](https://github.com/solarssk/admitto/pull/740))
- Let staff void, restore, push updates to or delete a wallet pass from Attendee Detail and in bulk, with a Wallet column on the Attendees table ([#879](https://github.com/solarssk/admitto/pull/879))
- Track wallet pass registration (Registered, Unregistered, Status unknown) from PassCreator webhooks, with polling as a fallback ([#879](https://github.com/solarssk/admitto/pull/879))
- Void an attendee's wallet pass when the ticket is revoked, and restore it with the ticket ([#879](https://github.com/solarssk/admitto/pull/879))
- Push changes to an event's name, date, timezone or hours to already-issued wallet passes in the background ([#879](https://github.com/solarssk/admitto/pull/879))
- Allow superadmins to add trusted third-party origins to the Content-Security-Policy in Organisation Settings, Security ([#865](https://github.com/solarssk/admitto/pull/865))

### Fixed

- Show the Admitto favicon on the public ticket page and its error state ([#880](https://github.com/solarssk/admitto/pull/880))
- Fix the black wedge in the iOS home-screen icon by removing the default fill and flattening the touch icon ([#880](https://github.com/solarssk/admitto/pull/880))
- Create a new ticket type with the name you type, and show type names in the Activity log diff ([#877](https://github.com/solarssk/admitto/pull/877))
- Ask the admin to re-enter a mail credential that can no longer be decrypted, and log `mail_secret_decryption_failed` ([#867](https://github.com/solarssk/admitto/pull/867))
- Fix the mobile Templates header, and let Delete event ignore a default Ticket email override ([#863](https://github.com/solarssk/admitto/pull/863))
- Keep the Health check mobile "More actions" menu compact ([#863](https://github.com/solarssk/admitto/pull/863))
- Keep the Logs filters and date picker clear of the keyboard on iPhone ([#863](https://github.com/solarssk/admitto/pull/863))
- Use one IANA timezone catalogue, with legacy aliases folded into current names ([#864](https://github.com/solarssk/admitto/pull/864))
- Show "Password is managed by your identity provider" for SSO-only accounts, and fail SSO unlink with a clear message ([#869](https://github.com/solarssk/admitto/pull/869))
- Derive the Identity group mapping scope from the selected role ([#871](https://github.com/solarssk/admitto/pull/871))
- Make the Identity group mapping Organization/Event field a searchable picker ([#871](https://github.com/solarssk/admitto/pull/871))
- Add inline hints to the identity provider editor, and correct a pasted discovery URL to the bare issuer URL ([#872](https://github.com/solarssk/admitto/pull/872))
- Put the ticket's QR code on the wallet pass, so scanning it at check-in resolves to the right attendee ([#748](https://github.com/solarssk/admitto/pull/748))
- Ask providers not to compress responses, to work around an `undici` gzip/HTTP2 bug ([#878](https://github.com/solarssk/admitto/pull/878))

### Security

- Disable Reset password and Reset two-factor for SSO-managed accounts, in the menu and the API ([#868](https://github.com/solarssk/admitto/pull/868))
- End the identity provider session on log out when the provider advertises a logout endpoint ([#870](https://github.com/solarssk/admitto/pull/870))
- Re-resolve and pin the connection for every static map tile request and redirect hop ([#878](https://github.com/solarssk/admitto/pull/878))
- Publish `robots.txt` and send `X-Robots-Tag: noindex, nofollow` on public pages ([#880](https://github.com/solarssk/admitto/pull/880))

## [0.4.14] - 2026-08-11

### Added

- Add a first-boot checklist, a Portainer/NPM variant without the compose nginx, and a generated environment dictionary (`deploy/ENV.md`) to the deploy docs ([#835](https://github.com/solarssk/admitto/pull/835))
- Show attendees added and items issued, returned or revoked in the Event Overview Recent activity ([#858](https://github.com/solarssk/admitto/pull/858))
- Refresh Event Overview within about 3 seconds of a check-in, attendee add or item change ([#859](https://github.com/solarssk/admitto/pull/859))
- Refresh Event Overview within about 3 seconds of a mail send, failure or finished import, announced by the worker over Redis ([#860](https://github.com/solarssk/admitto/pull/860))

### Changed

- Mark GitHub Releases from `v0.4.13` onward as the latest release instead of pre-release ([#857](https://github.com/solarssk/admitto/pull/857))
- Update the living ops and security docs to the current stack: manual backup, worker-based retention and bounce handling ([#851](https://github.com/solarssk/admitto/pull/851))
- Configure OIDC providers only in Organisation settings, Identity, and drop the unused `OIDC_*` environment documentation ([#847](https://github.com/solarssk/admitto/pull/847))
- Show the Redirect URI pattern on the identity provider Add form before the first save ([#847](https://github.com/solarssk/admitto/pull/847))
- Drop the automatic pre-migration database backup and run no container as root; back up the database manually before every upgrade ([#836](https://github.com/solarssk/admitto/pull/836))
- Show the full attempted email for failed sign-ins in the Security audit log ([#852](https://github.com/solarssk/admitto/pull/852))

### Fixed

- Open a compact "Rows per page" menu in admin table pagination, and give card headers a consistent height ([#862](https://github.com/solarssk/admitto/pull/862))
- Use the bordered Notice style for "file too large" messages in Event Settings, Images ([#856](https://github.com/solarssk/admitto/pull/856))
- Stop Recent scans showing a duplicate "Checked in" row after a follow-up action ([#855](https://github.com/solarssk/admitto/pull/855))
- Stop Event Settings crashing on load by importing placeholder names from a browser-safe subpath ([#854](https://github.com/solarssk/admitto/pull/854))
- Fix the Image name hint spacing and the error focus ring in Event Settings, Images ([#854](https://github.com/solarssk/admitto/pull/854))
- Polish Requirements: empty custom field state, Description column, equal-width type buttons and the item modal layout ([#854](https://github.com/solarssk/admitto/pull/854))
- Show the actor's own timezone on the time line of Sessions and the Security logs ([#853](https://github.com/solarssk/admitto/pull/853))
- Clarify Event settings card hints, add Location "Remove pin", and let Organisation Admins manage the mail image library ([#845](https://github.com/solarssk/admitto/pull/845))
- Show "No ticket type" for attendees without a type, and make bulk delete and revoke confirmations actionable at once ([#846](https://github.com/solarssk/admitto/pull/846))
- Give new Badge items the "Name badge issued at check-in" description, and link Requirements to its documentation ([#846](https://github.com/solarssk/admitto/pull/846))
- Clarify Users & roles labels, show country flags in phone pickers on Windows Chrome, and stop Invite user being autofilled ([#843](https://github.com/solarssk/admitto/pull/843))
- Keep "New event" on one row with the title on mobile in the events picker ([#841](https://github.com/solarssk/admitto/pull/841))
- Tidy the New event modal: one Optional label, link ID from the title, no Find on map, clearer timezone hint ([#841](https://github.com/solarssk/admitto/pull/841))
- Show completed setup checks on Event Overview, and add a country-code picker to key contact phone numbers ([#844](https://github.com/solarssk/admitto/pull/844))
- Stop bulk ticket-send previews using the three-send limit, and explain the 10-minute limit on real sends ([#842](https://github.com/solarssk/admitto/pull/842))
- Label the check-in card dismiss action "Close", and stop Recent activity showing duplicate-scan warnings as check-ins ([#842](https://github.com/solarssk/admitto/pull/842))
- Fix the public 404 and 500 pages on narrow phones ([#840](https://github.com/solarssk/admitto/pull/840))
- Stop the backup codes download leaving the MFA enrollment button on "Please wait" ([#840](https://github.com/solarssk/admitto/pull/840))
- Replace the misleading "Open in password manager" link in desktop MFA setup with QR and setup key guidance ([#840](https://github.com/solarssk/admitto/pull/840))
- Keep the staff member's email and name on audit rows after their account is deleted ([#839](https://github.com/solarssk/admitto/pull/839))
- Use full-jitter backoff for concurrent OIDC instance-superadmin revokes ([#834](https://github.com/solarssk/admitto/pull/834))
- Allow deleting an event once its content is cleared, and list the remaining blockers in the Danger zone ([#838](https://github.com/solarssk/admitto/pull/838))
- Include the client IP in System logs request lines for authenticated staff and check-in sessions ([#850](https://github.com/solarssk/admitto/pull/850))
- Stop the Audit and Security log tabs polling while another tab is shown ([#850](https://github.com/solarssk/admitto/pull/850))
- Stop modals on iOS Safari trapping scrolling ([#848](https://github.com/solarssk/admitto/pull/848))
- Stop iOS Safari zooming on focus in text inputs, search boxes and the date picker ([#848](https://github.com/solarssk/admitto/pull/848))
- Fit the Health check version info, and move "Run live checks" into "More actions" on mobile ([#848](https://github.com/solarssk/admitto/pull/848))
- Stack the per-role authenticator switches in Security settings one per row on mobile ([#848](https://github.com/solarssk/admitto/pull/848))
- Keep the Mail settings "Use TLS" and "Require STARTTLS" switches next to their label on mobile ([#848](https://github.com/solarssk/admitto/pull/848))
- Make the Audit and Security log tables span the full card width ([#849](https://github.com/solarssk/admitto/pull/849))

### Security

- Add `SSO_PRIVATE_DESTINATION_ALLOWLIST` to allow self-hosted LAN identity providers ([#847](https://github.com/solarssk/admitto/pull/847))
- Pin weather and geocoding connections to a freshly re-resolved, validated address, closing a DNS-rebinding gap ([#837](https://github.com/solarssk/admitto/pull/837))
- Add `MAIL_PRIVATE_DESTINATION_ALLOWLIST` to allow self-hosted LAN SMTP, IMAP and Power Automate hosts in production ([#834](https://github.com/solarssk/admitto/pull/834))

## [0.4.13] - 2026-08-09

### Added

- Add `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md`, including guidance on using AI coding tools ([#823](https://github.com/solarssk/admitto/pull/823))
- Make a template's label, icon and description editable, and allow deleting non-ticket templates ([#795](https://github.com/solarssk/admitto/pull/795))
- Add a "Specific attendees" recipient option to the Send tab ([#798](https://github.com/solarssk/admitto/pull/798))
- Add the `admitto worker` background worker for ticket mail, imports, exports, bounce detection and retention, replacing the bounce-ingest and retention sidecars ([#767](https://github.com/solarssk/admitto/pull/767), [#783](https://github.com/solarssk/admitto/pull/783))
- Let users unlink or connect their own SSO provider from My account, and set their own contact phone number ([#745](https://github.com/solarssk/admitto/pull/745), [#741](https://github.com/solarssk/admitto/pull/741))
- Show the Redirect URI to register at the identity provider in the editor after the first save ([#809](https://github.com/solarssk/admitto/pull/809))
- Add configurable given name, family name and phone claims to identity provider settings ([#736](https://github.com/solarssk/admitto/pull/736))
- Add event bounce detection: a per-event IMAP mailbox marks forwarded delivery failures as bounced ([#709](https://github.com/solarssk/admitto/pull/709), [#726](https://github.com/solarssk/admitto/pull/726))
- Explain send and bounce status in plain English in Delivery details ([#701](https://github.com/solarssk/admitto/pull/701))
- Add an optional "Also verify bounce" switch to Send test email in Event settings, Mailing ([#709](https://github.com/solarssk/admitto/pull/709))
- Add a "Test connection" action to the Organisation and Event mail settings that checks SMTP without sending mail ([#715](https://github.com/solarssk/admitto/pull/715))
- Add a Health check page to Organisation Settings with live checks, Export and Copy for GitHub Issue ([#699](https://github.com/solarssk/admitto/pull/699))
- Add "View sent message" and "View delivery details" to the Delivery log and the attendee Delivery history ([#669](https://github.com/solarssk/admitto/pull/669))
- Add info tooltips that explain non-obvious rules across Instance Settings, Event Settings, Requirements, Reports and My account ([#668](https://github.com/solarssk/admitto/pull/668))
- Add a consolidated Branding settings tab with a colour palette, built-in fonts and custom font upload ([#622](https://github.com/solarssk/admitto/pull/622))
- Add severity badges, actor local time, an event filter and CSV export to the Audit log, plus a System logs live tail ([#614](https://github.com/solarssk/admitto/pull/614))
- Delay loading spinners across admin pages, so a near-instant response does not flash ([#585](https://github.com/solarssk/admitto/pull/585))
- Add a Mailing tab to Event Settings, so a superadmin can send an event through its own SMTP, Microsoft Graph or Power Automate transport ([#512](https://github.com/solarssk/admitto/pull/512))
- Add rows per page, one Export menu, row selection with bulk "Send tickets" and a mobile card layout to the Attendees list ([#516](https://github.com/solarssk/admitto/pull/516))
- Redesign Attendee Detail: read-only profile, Edit modal, status strip, richer Activity log and a custom fields card ([#517](https://github.com/solarssk/admitto/pull/517))
- Show event-day weather on event cards and the ticket page, from MET Norway or Open-Meteo ([#718](https://github.com/solarssk/admitto/pull/718))
- Add a Location tab to Event settings with venue search and a map pin ([#671](https://github.com/solarssk/admitto/pull/671))
- Let admins override a wrong Google or Apple Maps link, add location tokens to mail templates and a "Getting there" section to the ticket page ([#677](https://github.com/solarssk/admitto/pull/677), [#689](https://github.com/solarssk/admitto/pull/689))
- Add an optional internal staff phone number to Edit user and Invite user ([#721](https://github.com/solarssk/admitto/pull/721))
- Let a superadmin delete a staff account or change its email from Edit user ([#720](https://github.com/solarssk/admitto/pull/720))
- Add KPI tiles to Users & roles ([#719](https://github.com/solarssk/admitto/pull/719))
- Clean up orphaned branding uploads automatically, and add `admitto storage gc` ([#703](https://github.com/solarssk/admitto/pull/703))
- Show the country resolved from an IP address in the Audit log, Security log and Active sessions, without a third-party lookup ([#665](https://github.com/solarssk/admitto/pull/665))
- Add a durable Security audit log, kept for 30 days by default (`SECURITY_AUDIT_LOG_RETENTION_DAYS`) ([#611](https://github.com/solarssk/admitto/pull/611))
- Cover more actions in the audit log: identity providers, setup completion, branding uploads, forced password changes and bulk operations ([#611](https://github.com/solarssk/admitto/pull/611))
- Redesign the Reports page: compact KPI tiles, a taller hourly chart, and Attendance confirmation, Check-in method and By device cards ([#587](https://github.com/solarssk/admitto/pull/587))
- Redesign Event Overview: setup checklist card, Check-in progress ring and a Recent activity feed ([#553](https://github.com/solarssk/admitto/pull/553))
- Give a beep and a short vibration on every check-in scan, with distinct tones for valid, already checked in and invalid ([#460](https://github.com/solarssk/admitto/pull/460))
- Add a Download backup codes button next to the codes shown during 2FA enrollment ([#436](https://github.com/solarssk/admitto/pull/436))
- Let a superadmin edit a session's device label in Security, Sessions ([#632](https://github.com/solarssk/admitto/pull/632))
- Add a Support contact section to Organisation settings, General, used for outbound geocoding and weather requests ([#631](https://github.com/solarssk/admitto/pull/631))
- Show the running build's commit in the sidebar footer version label ([#654](https://github.com/solarssk/admitto/pull/654))
- Add a Notes tab to Attendee Detail, shared with check-in operators' notes, and a Revoke items action ([#617](https://github.com/solarssk/admitto/pull/617))
- Show the event-day items issued to each admitted attendee in the admission log, CSV and PDF exports
- Add many bulk actions to the Attendees selection bar: revoke check-in, items or pass, change ticket type or status, check in without scanning, export the selection ([#526](https://github.com/solarssk/admitto/pull/526), [#539](https://github.com/solarssk/admitto/pull/539), [#543](https://github.com/solarssk/admitto/pull/543), [#550](https://github.com/solarssk/admitto/pull/550))
- Redesign the attendee import page: dropzone, Dry run/Commit toggle, Import history and a summary screen ([#541](https://github.com/solarssk/admitto/pull/541), [#542](https://github.com/solarssk/admitto/pull/542))
- Add a Delete attendee action (GDPR erasure) with typed confirmation to Attendee Detail ([#519](https://github.com/solarssk/admitto/pull/519))
- Add a Ticket types tab to Event Settings, and read all ticket type pickers from that catalogue ([#496](https://github.com/solarssk/admitto/pull/496), [#497](https://github.com/solarssk/admitto/pull/497))
- Add a Custom attendee fields registry to Requirements, reused in check-in, the attendee form, import and export ([#493](https://github.com/solarssk/admitto/pull/493), [#495](https://github.com/solarssk/admitto/pull/495))
- Add "Revoke all check-ins", "Revoke all items" and "Delete event" to the Danger zone of Event Settings ([#467](https://github.com/solarssk/admitto/pull/467), [#480](https://github.com/solarssk/admitto/pull/480))
- Add an image asset library for custom email tokens, and an event-scoped logo override, to Event Settings, Branding ([#480](https://github.com/solarssk/admitto/pull/480))
- Show the event or organisation logo on the public ticket page ([#503](https://github.com/solarssk/admitto/pull/503))
- Let admins revoke a single attendee's check-in or item from the Check-in card or Attendee Detail ([#457](https://github.com/solarssk/admitto/pull/457))
- Show who created and last archived each event, and when, in the Archiving tab ([#658](https://github.com/solarssk/admitto/pull/658))
- Add a crop step to logo and event image uploads ([#693](https://github.com/solarssk/admitto/pull/693))

### Changed

- Consolidate the security and compliance docs under `docs/security/` ([#823](https://github.com/solarssk/admitto/pull/823))
- License Admitto under Apache-2.0, with `LICENSE`, `NOTICE` and `THIRD-PARTY-NOTICES.md` copied into the image ([#814](https://github.com/solarssk/admitto/pull/814))
- Replace the single "name" column with required `first_name` and `last_name` in attendee add, edit and CSV/XLSX import ([#792](https://github.com/solarssk/admitto/pull/792), [#790](https://github.com/solarssk/admitto/pull/790), [#788](https://github.com/solarssk/admitto/pull/788))
- Open Overview after creating an event ([#803](https://github.com/solarssk/admitto/pull/803))
- Show a caption above role and scope pickers, and skip the search box for short lists ([#722](https://github.com/solarssk/admitto/pull/722))
- Show a status icon next to each attendance status option ([#774](https://github.com/solarssk/admitto/pull/774))
- Retry soft-failed mail deliveries with exponential backoff, up to 8 attempts ([#768](https://github.com/solarssk/admitto/pull/768))
- Handle more character sets and MTA formats (Postfix, mailhop, Synology) in bounce parsing ([#712](https://github.com/solarssk/admitto/pull/712), [#714](https://github.com/solarssk/admitto/pull/714))
- Explain "Also verify bounce" in plain language, and translate SMTP codes into plain English ([#709](https://github.com/solarssk/admitto/pull/709))
- Use a simple branded HTML template for Send test email and bounce-probe messages ([#725](https://github.com/solarssk/admitto/pull/725))
- Improve Health check accuracy for the mail queue, Redis labelling, encryption status in development and the SMTP, Graph and Power Automate probes ([#699](https://github.com/solarssk/admitto/pull/699))
- Show a compact "From environment" badge on settings managed by environment variables ([#690](https://github.com/solarssk/admitto/pull/690))
- Use the responsive table and card layout, badges and pager of Attendees and Reports in the Delivery log ([#669](https://github.com/solarssk/admitto/pull/669))
- Use one styled notice component for inline warnings, fixing wrong colours caused by undefined CSS variables ([#785](https://github.com/solarssk/admitto/pull/785), [#656](https://github.com/solarssk/admitto/pull/656))
- Give each Event Settings card that needs saving its own Save and Reset, instead of one page-level button ([#616](https://github.com/solarssk/admitto/pull/616))
- Replace the scattered topbar status icons with a System status dropdown and an Account menu ([#564](https://github.com/solarssk/admitto/pull/564))
- Stop the Check-in header repeating the event title, date and location, and move the connection indicator to the topbar ([#450](https://github.com/solarssk/admitto/pull/450))
- Stop sending placeholder `@example.com` contacts as the User-Agent of weather and maps requests, which providers rejected ([#631](https://github.com/solarssk/admitto/pull/631))
- Show weather chips in °C or °F by the operator's timezone, and both units on the ticket page ([#724](https://github.com/solarssk/admitto/pull/724))
- Match the New event dialog to the Add attendee pattern, and explain that the Link name is permanent
- Show a static map preview or a placeholder on the event list and picker cards ([#692](https://github.com/solarssk/admitto/pull/692))
- Match the Location tab Address card to the mockup, with a timezone-mismatch notice and maps links that include the venue name ([#677](https://github.com/solarssk/admitto/pull/677))
- Redesign the public ticket page: Admitto branding, official wallet badges, a two-line address and accessibility icons
- Simplify and unify the sidebar across every shell: a fixed expanded desktop sidebar, an icon rail on tablet, and `/account` in the same chrome ([#339](https://github.com/solarssk/admitto/pull/339))
- Redesign Edit user: one Role selector, self-service SSO unlink, a Recent logins list and a More actions menu ([#721](https://github.com/solarssk/admitto/pull/721))
- Move Sessions and bulk revoke of operator sessions to an Active sessions tab under Users & roles ([#657](https://github.com/solarssk/admitto/pull/657))
- Redesign My account: a two-column Profile, a Sign-in row, and side-by-side Password and Two-factor cards ([#741](https://github.com/solarssk/admitto/pull/741))
- Attribute each check-in in the admission log, the By operator breakdown and the exports to the authenticated operator ([#632](https://github.com/solarssk/admitto/pull/632))
- Probe the local uploads directory in the Health check File storage row ([#705](https://github.com/solarssk/admitto/pull/705))
- Upgrade Prisma from 5.22 to 7.9.1, with mandatory driver adapters and explicit pool timeouts ([#655](https://github.com/solarssk/admitto/pull/655))
- Redesign the Archiving tab with one Active/Archived toggle and pagination ([#658](https://github.com/solarssk/admitto/pull/658))
- Code-split the admin SPA by route, cutting the initial JavaScript by about 60% ([#528](https://github.com/solarssk/admitto/pull/528))
- Label and describe the check-in "Items to hand out" list, and word the hand-over button as an attestation ([#454](https://github.com/solarssk/admitto/pull/454), [#618](https://github.com/solarssk/admitto/pull/618))
- Start new events with only an always-present Badge item, kept in sync with "Issue badge at entry" ([#447](https://github.com/solarssk/admitto/pull/447), [#451](https://github.com/solarssk/admitto/pull/451))
- Redesign the Requirements event items list and edit modal ([#451](https://github.com/solarssk/admitto/pull/451))
- Shrink the desktop check-in camera viewfinder to a QR-sized square that hides once a scan result shows ([#450](https://github.com/solarssk/admitto/pull/450))
- Realign the desktop check-in sidebar and the mobile camera overlay to the mockup ([#454](https://github.com/solarssk/admitto/pull/454))
- Describe the check-in scan bar in plain language, and try a scan first when Enter is pressed ([#456](https://github.com/solarssk/admitto/pull/456))
- Reorganise the Attendee Detail actions: one red Revoke button, Revoke items and Delete attendee in More actions, and a confirmation for Restore pass ([#615](https://github.com/solarssk/admitto/pull/615))
- Rename "Registration" to "Pass" in the Attendee Detail status strip
- Unify the Overview KPI tiles with the Reports stat tiles ([#664](https://github.com/solarssk/admitto/pull/664))
- Rename the Requirements "Event behaviour" card to "Check-in behaviour" ([#668](https://github.com/solarssk/admitto/pull/668))
- Reorganise Event Settings into tabs: General, Location, Ticket types, Images, Mailing, Wallet, Integrations and Danger zone ([#459](https://github.com/solarssk/admitto/pull/459))
- Return a structured JSON error for unhandled API errors instead of plain-text "Internal Server Error" ([#694](https://github.com/solarssk/admitto/pull/694))
- Rename "Settings" to "Organisation settings" ([#631](https://github.com/solarssk/admitto/pull/631))
- Let staff admin content fill the full width beside the sidebar on wide monitors ([#332](https://github.com/solarssk/admitto/pull/332))
- Add an Organisation branding card to Settings, General, to update the organisation name and logo after setup ([#466](https://github.com/solarssk/admitto/pull/466))
- Make the filter and picker dropdowns searchable comboboxes across the admin SPA ([#773](https://github.com/solarssk/admitto/pull/773))

### Fixed

- Float the Connect / Unlink SSO menu over the card header on the My account Profile ([#821](https://github.com/solarssk/admitto/pull/821))
- Show one branded Admitto card for public 404 and 500 pages, with no branding lookup for unmatched paths ([#818](https://github.com/solarssk/admitto/pull/818))
- Show the branded ticket card with a clear notice for revoked or cancelled ticket links ([#817](https://github.com/solarssk/admitto/pull/817))
- Put the preview badge, attendee count and delete back on the right of the Ticket types row ([#816](https://github.com/solarssk/admitto/pull/816))
- Keep Address lookup (Nominatim) available in Health check when Maps is off ([#816](https://github.com/solarssk/admitto/pull/816))
- Stop External services Save greying out and flashing every input ([#816](https://github.com/solarssk/admitto/pull/816))
- Fix the Chrome accessibility warning about an orphaned label in MFA code entry ([#815](https://github.com/solarssk/admitto/pull/815))
- Keep Location settings editable when map tiles are off or fail, and say "Preview unavailable" on event cards ([#811](https://github.com/solarssk/admitto/pull/811))
- Re-sync an SSO account's display name and phone from the identity provider on every login ([#736](https://github.com/solarssk/admitto/pull/736))
- Retry the event item and ops-config API on wrapped Postgres serialization conflicts ([#733](https://github.com/solarssk/admitto/pull/733))
- Abort the bounce-ingest System Logs POST after 2 seconds ([#728](https://github.com/solarssk/admitto/pull/728))
- Show friendly labels for bounce detection and other unmapped actions in the Audit log ([#806](https://github.com/solarssk/admitto/pull/806))
- Fix Edit user role chips, closing the modal after a role-type change, and dropdown placement near the viewport edge ([#722](https://github.com/solarssk/admitto/pull/722), [#742](https://github.com/solarssk/admitto/pull/742))
- Make "Also verify bounce" reliable: ignore older bounces, report an unopenable mailbox, use its own IMAP session, retry a brief disconnect and keep one login open ([#709](https://github.com/solarssk/admitto/pull/709), [#715](https://github.com/solarssk/admitto/pull/715))
- Match bounce recipients case-insensitively, keep trailing disclaimers out of the stored reason, and decode HTML entities ([#712](https://github.com/solarssk/admitto/pull/712))
- Fix the event Mail tab Save skipping bounce settings, and refresh the bounce panel after saving the Mail card ([#616](https://github.com/solarssk/admitto/pull/616), [#709](https://github.com/solarssk/admitto/pull/709))
- Reject an invalid `BOUNCE_INGEST_INTERVAL_SECONDS` at startup ([#729](https://github.com/solarssk/admitto/pull/729))
- Stamp each Send test email with a unique subject and body, so relays that drop duplicates deliver a repeat test
- Show Delivery history times in the actor's timezone, with a compact status row and a recipient line ([#701](https://github.com/solarssk/admitto/pull/701))
- Return a clear operator message instead of "Internal Server Error" when the mail destination cannot be resolved or is private ([#694](https://github.com/solarssk/admitto/pull/694))
- Honour `ALLOW_PRIVATE_MAIL_DESTINATIONS=true` in mail-config validation, so a literal RFC1918 lab SMTP host can be saved ([#694](https://github.com/solarssk/admitto/pull/694))
- Fix Delivery log search, export, timeline labels and load errors ([#669](https://github.com/solarssk/admitto/pull/669))
- Snapshot the mail template label on each delivery, so deleted templates stay distinguishable ([#672](https://github.com/solarssk/admitto/pull/672))
- Stop two page scrollbars appearing when the mail transport provider is switched in Event Settings, Mailing
- Open the Identity provider and Cloudflare Access editors as modals over the list ([#586](https://github.com/solarssk/admitto/pull/586))
- Use one shared Tooltip component in the admin SPA, kept on screen on narrow viewports ([#554](https://github.com/solarssk/admitto/pull/554))
- Drop the redundant breadcrumb from the Attendee Detail header, add a subtitle, and make "Resend ticket" a button ([#515](https://github.com/solarssk/admitto/pull/515))
- Show a clear message instead of "Internal Server Error" when no mail transport is configured ([#694](https://github.com/solarssk/admitto/pull/694))
- Redesign the Mail transport panel: two-column sections, "SMTP (recommended)", collapsible Advanced tuning and masked secrets ([#509](https://github.com/solarssk/admitto/pull/509))
- Grey out every mutating admin control on archived events across Attendees, Requirements, Communication and Import ([#469](https://github.com/solarssk/admitto/pull/469))
- Show compact icon badges for the topbar connection and mailer status in every state ([#506](https://github.com/solarssk/admitto/pull/506))
- Validate the email format when inviting or editing staff, and render the Active badge green ([#720](https://github.com/solarssk/admitto/pull/720))
- Show URL guidance instead of raw codes like `invalid_base_url` in Weather and Maps test toasts ([#718](https://github.com/solarssk/admitto/pull/718))
- Stop venue search, date picker and timezone panels clipping or growing scroll height inside the New event modal ([#742](https://github.com/solarssk/admitto/pull/742))
- Relocate the Location pin only on double-click, and keep the map centre on zoom-only changes ([#671](https://github.com/solarssk/admitto/pull/671))
- Harden the Location tab: keep the pin when the venue name is edited, apply a suggestion's pin at once, persist the zoom, and show where the pin came from ([#671](https://github.com/solarssk/admitto/pull/671), [#676](https://github.com/solarssk/admitto/pull/676))
- Serve a cached "Map unavailable" placeholder from `GET /m/{eventId}.png` when tiles are down, and omit the static map when maps are disabled ([#678](https://github.com/solarssk/admitto/pull/678), [#677](https://github.com/solarssk/admitto/pull/677))
- Burn the map attribution into the PNG only, strip HTML from it, add the zoom to the cache buster, and redact credentials in tile URL errors ([#677](https://github.com/solarssk/admitto/pull/677), [#678](https://github.com/solarssk/admitto/pull/678))
- Abort static map tile downloads above 512 KiB, so a bad tile server cannot force unbounded memory use ([#678](https://github.com/solarssk/admitto/pull/678))
- Fix the ticket venue and date alignment, and stop `{{event_address}}` repeating a name-only venue ([#677](https://github.com/solarssk/admitto/pull/677))
- Use real UI components in the Overview Pinned note, Key contacts and Important links cards, and replace the duplicate "Event date" tile with "Failed delivery" ([#553](https://github.com/solarssk/admitto/pull/553))
- Show an icon, a label and the event timezone for `check_in_revoked` entries in the activity log ([#704](https://github.com/solarssk/admitto/pull/704))
- Stop dropdown popovers jumping a scrolled page, and flip panels above their trigger near the bottom ([#742](https://github.com/solarssk/admitto/pull/742))
- Use searchable comboboxes for the Users & roles filters and pickers ([#773](https://github.com/solarssk/admitto/pull/773))
- Declutter the Users & roles mobile layout ([#719](https://github.com/solarssk/admitto/pull/719))
- Fix the Edit user layout, clearing a phone number, and the placement of Unlink SSO ([#721](https://github.com/solarssk/admitto/pull/721))
- Add an event filter to Role assignments, and show Granted in UTC and local time ([#704](https://github.com/solarssk/admitto/pull/704))
- Land a staff account with no usable role on My Account with a "no role assigned" notice
- Show full role names on staff badges, refresh the Staff users list after a role is revoked, and offer only 25 or 50 rows per page ([#719](https://github.com/solarssk/admitto/pull/719))
- Remove the unwired "Send invite email" switch, and show an "At least 12 characters" hint on Invite user and Reset password ([#719](https://github.com/solarssk/admitto/pull/719))
- Retry OIDC group sync transaction conflicts more patiently, so two simultaneous superadmin revokes no longer fail logins
- Show the correct local zone on staff timestamps that were bare UTC ([#704](https://github.com/solarssk/admitto/pull/704))
- Make the shared Tooltip trigger reachable by keyboard and announced to screen readers ([#659](https://github.com/solarssk/admitto/pull/659))
- Wire the Archiving creator and archiver backfill into the production migration entrypoint ([#674](https://github.com/solarssk/admitto/pull/674))
- Stop the Users, Attendees and Audit log search debounce resetting to page 1 on every mount ([#673](https://github.com/solarssk/admitto/pull/673), [#675](https://github.com/solarssk/admitto/pull/675))
- Stop the 6-digit MFA code entry overflowing narrow phones ([#815](https://github.com/solarssk/admitto/pull/815))
- Fix Branding: convert the old single-file font format on first read, block CSS-breaking characters in a local font path, and hide faux italics for fonts without an italic file ([#622](https://github.com/solarssk/admitto/pull/622), [#633](https://github.com/solarssk/admitto/pull/633))
- Define the missing border CSS variables, so borders render ([#656](https://github.com/solarssk/admitto/pull/656))
- Keep expanded Audit log details from pushing rows down, add a UTC/Local toggle, and stop Previous and Next jumping to the top ([#586](https://github.com/solarssk/admitto/pull/586))
- Fold the Security audit log into the System/Audit/Security toggle, with its own CSV export and a Live/Pause control ([#614](https://github.com/solarssk/admitto/pull/614))
- Compare the OIDC auth-state expiry against UTC, whatever the database timezone ([#621](https://github.com/solarssk/admitto/pull/621))
- Read the running staff SPA build for the Health check version and commit ([#708](https://github.com/solarssk/admitto/pull/708))
- Truncate long emails with an ellipsis in the attendee PDF export ([#706](https://github.com/solarssk/admitto/pull/706))
- Show "Manual lookup is disabled for this event" as a toast ([#494](https://github.com/solarssk/admitto/pull/494))
- Show at most one offline indicator in check-in, and clear a stale "Request failed" banner when the connection recovers ([#494](https://github.com/solarssk/admitto/pull/494))
- Show an inline error with Retry when the ticket-type catalogue fails to load, and show real labels and colours instead of internal keys ([#498](https://github.com/solarssk/admitto/pull/498))
- Harden the ticket type catalogue: block deleting a type assigned mid-request, reject duplicate labels, and back it with a database constraint ([#500](https://github.com/solarssk/admitto/pull/500))
- Add inline fallbacks to the public ticket page styles, since the design-token stylesheet was never loaded there ([#504](https://github.com/solarssk/admitto/pull/504))
- Show a skeleton on the first Attendees load, enlarge the check-in scan submit target, and respect `prefers-reduced-motion` ([#508](https://github.com/solarssk/admitto/pull/508))
- Stop desktop check-in with auto-advance clearing the card instantly when hand-out items are configured ([#455](https://github.com/solarssk/admitto/pull/455))
- Show a distinct "Undone" or "Revoked" row in Recent scans, hide "Revoke check-in" for a revoked pass, and clear the admission when a pass is revoked ([#450](https://github.com/solarssk/admitto/pull/450))
- Match check-in attendee search on name and email only, not on company or department
- Lock down check-in for archived events: leave them out of the operator list, answer 403 on every check-in route, and enforce it in the emergency CLI ([#468](https://github.com/solarssk/admitto/pull/468))
- Stop Event Overview crashing when the ticket-type breakdown is missing from an older backend response ([#563](https://github.com/solarssk/admitto/pull/563))
- Load the template Preview images on a local dev instance ([#796](https://github.com/solarssk/admitto/pull/796))
- Ship the product brand SVGs in the production image again, fixing 404s on deployed containers
- Keep the full pre-crop upload and last crop framing for organisation and event logos, so "Edit image" works after a refresh ([#693](https://github.com/solarssk/admitto/pull/693))
- Recheck file references right before each storage garbage-collection delete ([#703](https://github.com/solarssk/admitto/pull/703))
- Show an unambiguous numeric UTC offset on event timestamps instead of `CEST` or `IST` ([#618](https://github.com/solarssk/admitto/pull/618))
- Redirect an admin or superadmin who lands on `/operator` to `/admin` ([#340](https://github.com/solarssk/admitto/pull/340))
- Derive the check-in manual lookup result from the loaded card, so an admitted guest shows "Already checked in" and a revoked pass shows "Revoked" ([#448](https://github.com/solarssk/admitto/pull/448))
- Count only active attendees in the check-in admitted and expected stats ([#448](https://github.com/solarssk/admitto/pull/448))
- Show the date with the time in compact check-in timestamps that fall outside the event's calendar day ([#448](https://github.com/solarssk/admitto/pull/448))
- Render the missing checkbox visual, so checkboxes are no longer invisible ([#436](https://github.com/solarssk/admitto/pull/436))
- Show an accepted SMTP or Graph send as green "Sent" in the Delivery log ([#436](https://github.com/solarssk/admitto/pull/436))
- Define the missing surface token in the shared dialog shell, so Send tickets, Add attendee and Create template are no longer transparent ([#436](https://github.com/solarssk/admitto/pull/436))

### Security

- Refuse HTTP redirects in weather and Nominatim fetches, and refuse to attach an Open-Meteo API key to a non-HTTPS base URL ([#819](https://github.com/solarssk/admitto/pull/819))
- Serve only branding assets from public `/uploads/*`, and scrub the raw search query from finished export job results ([#782](https://github.com/solarssk/admitto/pull/782))
- Constrain `nanoid` to `^3.3.17`, fixing a high-severity infinite loop (GHSA-2v37-7h3g-55p8) ([#786](https://github.com/solarssk/admitto/pull/786))
- Close SSRF and credential-leak paths in the event-level dedicated mail transport: superadmin only, and no silent reuse of organisation credentials ([#523](https://github.com/solarssk/admitto/pull/523))
- Record which admin triggered a bulk ticket send or resend on the delivery row ([#623](https://github.com/solarssk/admitto/pull/623))
- Stop Attendee detail exposing a decrypted ticket token preview ([#626](https://github.com/solarssk/admitto/pull/626))
- Check weather, geocoding and map tile URLs against the private-address blocklist, reject redirects, validate PNG magic bytes and redact credentials in logs ([#819](https://github.com/solarssk/admitto/pull/819), [#678](https://github.com/solarssk/admitto/pull/678))
- Close role-management gaps: a superadmin cannot strip their own role, switch their own role type or unlink their own SSO, and role switches re-check identity provider protection ([#721](https://github.com/solarssk/admitto/pull/721))
- Trust `X-Forwarded-*` headers only from direct peers listed in `TRUSTED_PROXY_CIDRS` (loopback by default) when `TRUST_PROXY=true` ([#623](https://github.com/solarssk/admitto/pull/623))
- Re-validate the Delete event zero-activity guard server-side, and require typing the event's exact title ([#467](https://github.com/solarssk/admitto/pull/467))
- Record self-service account actions (password change, MFA enroll or reset, session revoke) in the admin audit trail ([#474](https://github.com/solarssk/admitto/pull/474))
- Fix a self-lockout where enrolling MFA from Account settings could break the current session ([#474](https://github.com/solarssk/admitto/pull/474))
- Require a current authenticator or backup code to reset your own 2FA or change your password when your role requires MFA ([#475](https://github.com/solarssk/admitto/pull/475), [#479](https://github.com/solarssk/admitto/pull/479))
- Check for a duplicate email before hashing the password when a staff account is created ([#545](https://github.com/solarssk/admitto/pull/545))
- Stop the production image running as root: a one-shot `migrate` service handles migrations and the `app` container runs unprivileged ([#572](https://github.com/solarssk/admitto/pull/572))
- Audit trusted-device enrollment, and raise an alert after 5 consecutive failed logins on an admin account ([#667](https://github.com/solarssk/admitto/pull/667))
- Enforce an idle timeout on sessions (admin 30 minutes, operator 2 hours, absolute 12 hours), configurable in Settings, Security ([#666](https://github.com/solarssk/admitto/pull/666))
- Reject the roughly 250 most common passwords and trivial patterns server-side, and score the strength meter by length and variety ([#666](https://github.com/solarssk/admitto/pull/666))
- Bind `npm run dev` for the web app to localhost by default ([#470](https://github.com/solarssk/admitto/pull/470))
- Send `Cache-Control: no-store` on attendee list, detail and export responses ([#626](https://github.com/solarssk/admitto/pull/626))
- Rate-limit attendee search to 120 requests a minute per user and event ([#545](https://github.com/solarssk/admitto/pull/545))
- Reject credential-bearing field names in the ops System Logs ingest ([#728](https://github.com/solarssk/admitto/pull/728))
- Migrate the admin SPA from `react-router-dom` to `react-router` v8, resolving GHSA-qwww-vcr4-c8h2 ([#589](https://github.com/solarssk/admitto/pull/589))
- Bump `svgo` and `brace-expansion` to fix high-severity `npm audit` advisories ([#548](https://github.com/solarssk/admitto/pull/548))
- Remove a polynomial ReDoS risk from staff email format validation ([#581](https://github.com/solarssk/admitto/pull/581))
- Re-encode branding image uploads on the server, stripping EXIF, IPTC and XMP metadata
- Stop forwarding raw server error detail in admin API and Identity JSON API errors ([#330](https://github.com/solarssk/admitto/pull/330))
- Send baseline security headers (nosniff, X-Frame-Options, Referrer-Policy, HSTS) on every `/api/*` response ([#330](https://github.com/solarssk/admitto/pull/330))

## [0.4.12] - 2026-07-06

### Added

- Add Vitest coverage (`npm run coverage`) with LCOV upload to Codecov in CI ([#295](https://github.com/solarssk/admitto/pull/295))
- Shorten the CI pull request pipeline: lint runs inside `build-test`, and Semgrep and the Docker smoke build run on `main` only ([#295](https://github.com/solarssk/admitto/pull/295))
- Add the identity providers and Cloudflare Access JSON API (`/api/admin/identity/*`) for the SPA Identity settings ([#294](https://github.com/solarssk/admitto/pull/294))
- Add the Identity & SSO overview to Settings, with a providers list and a Cloudflare Access summary ([#296](https://github.com/solarssk/admitto/pull/296))
- Add the identity provider editor: Basics, Endpoints, Claims and the login button label ([#297](https://github.com/solarssk/admitto/pull/297))
- Add the group-to-role mapping repeater, Discover and Test to the identity provider editor ([#298](https://github.com/solarssk/admitto/pull/298))
- Allow Test and Discover on a draft identity provider before it is saved ([#313](https://github.com/solarssk/admitto/pull/313))
- Add the Cloudflare Access editor to Settings, Identity ([#310](https://github.com/solarssk/admitto/pull/310))
- Add a JSON HTTP access log on `app` stdout (`LOG_HTTP_REQUESTS`, on by default in the deploy compose), without IPs, query strings or tokens ([#260](https://github.com/solarssk/admitto/pull/260))
- Add a password strength meter to `/setup`, `/change-password` and the Account password change ([#250](https://github.com/solarssk/admitto/pull/250))
- Add a per-event Pinned note, Key contacts and Important links & files to Event Overview, with changes recorded in the audit log ([#291](https://github.com/solarssk/admitto/pull/291))

### Changed

- Unify the Settings shell, so the primary tabs stay visible on all Identity screens ([#314](https://github.com/solarssk/admitto/pull/314))
- Sync the CI and security docs, deploy examples (Node 24), the README documentation map and the contributor coverage commands ([#299](https://github.com/solarssk/admitto/pull/299))
- Redesign Event Overview as a command center: Needs attention, Event readiness, Email delivery and a live Recent check-ins feed ([#290](https://github.com/solarssk/admitto/pull/290))
- Align the Account page sidebar with the AdminShell standard ([#289](https://github.com/solarssk/admitto/pull/289))
- Fix Reports tile and panel spacing, progress bar colours and chart accessibility ([#288](https://github.com/solarssk/admitto/pull/288))
- Use the shared Badge for the topbar mailer status ([#287](https://github.com/solarssk/admitto/pull/287))
- Show the check-in AttendeeCard status by severity: valid, warning or blocking error ([#284](https://github.com/solarssk/admitto/pull/284))
- Unify toast notifications into one design-system stack, and use toasts for save and load feedback in admin pages and settings panels ([#236](https://github.com/solarssk/admitto/pull/236))
- Use toasts for Account profile, password and MFA feedback ([#248](https://github.com/solarssk/admitto/pull/248))
- Keep the toast stack below the check-in camera overlay on mobile ([#236](https://github.com/solarssk/admitto/pull/236))
- Align the setup wizard mail step with the design mockup ([#229](https://github.com/solarssk/admitto/pull/229))
- Redirect unauthenticated staff entry to `/setup` until the first user exists ([#215](https://github.com/solarssk/admitto/pull/215))
- Allow `http://127.0.0.1` and `localhost` as BASE_URL in the setup wizard system check in production ([#215](https://github.com/solarssk/admitto/pull/215))
- Ignore deploy env placeholders for mail field locks and test send until the setup wizard completes ([#215](https://github.com/solarssk/admitto/pull/215))
- Polish the `/setup` form for password managers (`autocomplete` and `passwordrules`) ([#227](https://github.com/solarssk/admitto/pull/227))
- Add the setup wizard header, numbered stepper, custom date picker, timezone combobox and ready step chips ([#242](https://github.com/solarssk/admitto/pull/242))
- Test the password strength script end-to-end in jsdom, and move shared sample passwords to a test-only export ([#259](https://github.com/solarssk/admitto/pull/259))
- Persist the active Settings tab in the URL (`?tab=general|mail|security|archiving`) ([#311](https://github.com/solarssk/admitto/pull/311))

### Removed

- Remove the legacy server-rendered identity admin (`/admin/auth/providers*`, `/admin/auth/cf-access*`) ([#311](https://github.com/solarssk/admitto/pull/311))

### Security

- Gate the login and MFA page scripts with a per-response CSP nonce instead of `unsafe-inline` ([#258](https://github.com/solarssk/admitto/pull/258))

### Fixed

- Define the missing surface token, so modals and panels are no longer transparent ([#286](https://github.com/solarssk/admitto/pull/286))
- Queue check-in scans while a previous scan is processing, instead of dropping keystrokes for the next attendee ([#277](https://github.com/solarssk/admitto/pull/277))
- Stop `deploy/.env.example` placeholder values falsely locking Mail settings as managed by environment ([#278](https://github.com/solarssk/admitto/pull/278))
- Stop manual lookup misfiring as a QR scan for queries over 20 characters ([#279](https://github.com/solarssk/admitto/pull/279))
- Render the event shell instantly when entering an event from the picker ([#282](https://github.com/solarssk/admitto/pull/282))
- Bucket the Reports hourly admissions chart and peak hour in the event timezone ([#272](https://github.com/solarssk/admitto/pull/272))
- Show unreleased lifecycle sections in the sidebar as plain disabled items ([#273](https://github.com/solarssk/admitto/pull/273))
- Seed default event items (gift bag, badge, headset) when an event is created ([#255](https://github.com/solarssk/admitto/pull/255))
- Bring the setup wizard to mockup parity: system check retry and hints, steps 2 to 5, and restoring the last step after a refresh ([#242](https://github.com/solarssk/admitto/pull/242))
- Require passing system checks for `POST /api/admin/setup/complete` (409 `setup_not_ready`) ([#242](https://github.com/solarssk/admitto/pull/242))
- Show actionable errors for TLS hostname mismatch, authentication and port mode in the mail transport test ([#242](https://github.com/solarssk/admitto/pull/242))
- Show the check-in server status as a compact header pill, with a full-width banner only for connection problems ([#235](https://github.com/solarssk/admitto/pull/235))
- Announce connection recovery to screen readers in check-in ([#235](https://github.com/solarssk/admitto/pull/235))
- Suppress password-manager autofill hints on the check-in search fields ([#233](https://github.com/solarssk/admitto/pull/233))
- Show a warning toast when check-in manual lookup finds nobody ([#233](https://github.com/solarssk/admitto/pull/233))

## [0.4.11] - 2026-07-02

### Fixed

- Stabilise the Redis rate-limit block test across window boundaries ([#213](https://github.com/solarssk/admitto/pull/213))

## [0.4.10] - 2026-07-02

### Changed

- Remove the instance superadmin ceiling: allow several active `superadmin@instance` assignments, and stop capping OIDC group-to-superadmin grants at one ([#210](https://github.com/solarssk/admitto/pull/210))
- Consolidate the rate-limit factories into a declarative policy registry, with no change in behaviour ([#200](https://github.com/solarssk/admitto/pull/200), [#202](https://github.com/solarssk/admitto/pull/202), [#203](https://github.com/solarssk/admitto/pull/203))
- Remove an unused SSE message variant and a stale nginx metrics location, and fix dangling ADR links in the deploy docs ([#204](https://github.com/solarssk/admitto/pull/204))
- Add a superadmin runbook for multiple instance admins and OIDC offboarding ([#211](https://github.com/solarssk/admitto/pull/211))

### Security

- Fix the event-settings GET authorization-order oracle (404 to 403), add `assertEventManageAccess` to the PATCH handler, and reduce the QR image cache TTL from 24 hours to 5 minutes ([#205](https://github.com/solarssk/admitto/pull/205))
- Harden the emergency CLI attendee export paths: mode 0600, a writable `emergency-exports` mount, and rejection of `--out` under the public `UPLOAD_DIR`, outside `EMERGENCY_EXPORT_DIR` or through symlinks ([#209](https://github.com/solarssk/admitto/pull/209), [#208](https://github.com/solarssk/admitto/pull/208))

### Fixed

- Map Serializable conflicts in `POST /setup` to `409 already_initialized` when two first-run submissions race ([#210](https://github.com/solarssk/admitto/pull/210))
- Keep the `bootstrap-superadmin --force` recovery path working after the single-superadmin index was removed ([#210](https://github.com/solarssk/admitto/pull/210))
- Stop OIDC group sync revoking the last active instance superadmin, and record `auth.oidc.superadmin_revoke_blocked` ([#210](https://github.com/solarssk/admitto/pull/210))

### Added

- Add the `admitto` emergency ops CLI (`apps/cli`): check-in admit and lookup, attendee export, mail retry, bootstrap-superadmin, reset-mfa, session revoke and purge, and retention run ([#207](https://github.com/solarssk/admitto/pull/207))
- Add an automated retention cron and a nightly `pg_dump` backup sidecar to the deploy compose ([#206](https://github.com/solarssk/admitto/pull/206))

## [0.4.9] - 2026-07-02

### Added

- Add an Instance URL setting (Settings, General) for absolute email logo URLs when `BASE_URL` is unset ([#195](https://github.com/solarssk/admitto/pull/195))
- Add live check-in updates: an SSE stream at `GET /api/checkin/events/:eventId/stream`, a live feed on Check-in and an optimistic admitted count on Overview ([#190](https://github.com/solarssk/admitto/pull/190), [#191](https://github.com/solarssk/admitto/pull/191))
- Add several email templates per event with CRUD under `/api/admin/events/:eventId/templates`, a per-template test send and a multi-template editor on Communication ([#190](https://github.com/solarssk/admitto/pull/190), [#191](https://github.com/solarssk/admitto/pull/191))
- Add a bulk send API (`POST /api/admin/events/:eventId/send`) with template, recipient filters, a dry-run count and batch status, plus a bulk send dialog on Communication ([#190](https://github.com/solarssk/admitto/pull/190), [#191](https://github.com/solarssk/admitto/pull/191))

### Changed

- Align the contributor roadmap in `AGENTS.md`, `README.md` and `VERSIONING.md`, and point `AGENTS.md` at `CHANGELOG.md` and the open milestone ([#198](https://github.com/solarssk/admitto/pull/198))

### Fixed

- Clear the upload value and show an error when an uploaded logo file is corrupt ([#195](https://github.com/solarssk/admitto/pull/195))
- Use the stored instance URL for ticket links in resend and bulk resend when `BASE_URL` is unset ([#195](https://github.com/solarssk/admitto/pull/195))
- Reject bare `?` and `#` in the instance URL ([#196](https://github.com/solarssk/admitto/pull/196))
- Fix the Overview SSE dedup memory and stale ticket template caching on Communication ([#193](https://github.com/solarssk/admitto/pull/193))
- Revoke and restore a pass from the attendees list ([#194](https://github.com/solarssk/admitto/pull/194))
- Allow deleting reminder and custom email templates after deliveries were sent ([#194](https://github.com/solarssk/admitto/pull/194))

## [0.4.8] - 2026-07-01

### Fixed

- Enforce event capacity on pass restore, reactivation and manual create, share an advisory lock between create and import, exclude cancelled passes, and allow overwrite-only imports when over capacity ([#186](https://github.com/solarssk/admitto/pull/186))
- Exclude revoked and cancelled attendees from the Overview `attendee_count` and `admitted_count` ([#186](https://github.com/solarssk/admitto/pull/186))
- Record `forced: true` in the audit metadata when a CSV import overrides capacity with `?force=1` ([#186](https://github.com/solarssk/admitto/pull/186))
- Show `email_bounced` separately from failed deliveries on the Overview email card ([#186](https://github.com/solarssk/admitto/pull/186))
- Validate magic bytes and use async filesystem I/O for branding uploads ([#186](https://github.com/solarssk/admitto/pull/186))

### Added

- Add a logo upload zone to the setup wizard (server upload or external HTTPS URL) ([#188](https://github.com/solarssk/admitto/pull/188))
- Add a bounce alert with a link to the delivery log on the Communication page ([#188](https://github.com/solarssk/admitto/pull/188))
- Add the branding upload API (`POST /api/admin/uploads`, PNG, JPG or WebP up to 2 MB, superadmin only) with `GET /uploads/*` and a Compose volume ([#186](https://github.com/solarssk/admitto/pull/186), [#188](https://github.com/solarssk/admitto/pull/188))
- Let admins revoke and restore a pass from attendee detail, with a `revoked` attendee status that blocks admission ([#187](https://github.com/solarssk/admitto/pull/187), [#186](https://github.com/solarssk/admitto/pull/186))
- Return `409 event_full` on manual create and CSV import over capacity, show an `event_full` banner, and let a superadmin override with `?force=1` ([#186](https://github.com/solarssk/admitto/pull/186), [#187](https://github.com/solarssk/admitto/pull/187))
- Show the TOTP enrollment QR code on the Account page ([#187](https://github.com/solarssk/admitto/pull/187))
- Pre-fill the device label from the browser user agent ([#187](https://github.com/solarssk/admitto/pull/187))
- Add sidebar pin and unpin on desktop, lifecycle nav labels and an Administration section ([#187](https://github.com/solarssk/admitto/pull/187))

## [0.4.7] - 2026-06-30

### Security

- Rate-limit the admin export endpoints: PII export 5 an hour, attendees and reports export 10 an hour per user and route ([#181](https://github.com/solarssk/admitto/pull/181))

### Added

- Add bulk "Send tickets" to the attendees list (`POST .../attendees/bulk-resend`, `unsent` or `all`, up to 500 per request, 3 requests per 10 minutes) ([#180](https://github.com/solarssk/admitto/pull/180))
- Show a "Data preview" of the first 20 valid rows before a CSV import commit ([#179](https://github.com/solarssk/admitto/pull/179))
- Add icons, contents metadata and the `allow_manual_lookup` and `auto_advance_on_valid` flags to Requirements event items ([#171](https://github.com/solarssk/admitto/pull/171))
- Enforce the check-in ops flags at the door and show item icons on the attendee card (`GET /api/checkin/ops-config`) ([#172](https://github.com/solarssk/admitto/pull/172))
- Enforce contents metadata (type, select, boolean, required, options) on attendee create and patch, and on check-in item detail ([#176](https://github.com/solarssk/admitto/pull/176))
- Accept dynamic event-item attribute columns (`source_field` slugs) in CSV import, with matching template and re-import support ([#177](https://github.com/solarssk/admitto/pull/177))
- Add a per-user preferred locale with a date-format picker on the Account page ([#161](https://github.com/solarssk/admitto/pull/161))
- Add a per-event IANA timezone to event creation, settings and the wizard, used by reports, exports and mail previews ([#160](https://github.com/solarssk/admitto/pull/160))
- Add an event overview dashboard at `/admin/events/:id/overview` with admission rate, email delivery stats and a countdown ([#159](https://github.com/solarssk/admitto/pull/159))

### Fixed

- Return an `{ error }` body for the `audit_failed` 500 on event settings PATCH ([#181](https://github.com/solarssk/admitto/pull/181))
- Restore the cursor after inserting placeholders in the template editor ([#181](https://github.com/solarssk/admitto/pull/181))
- Refresh the Overview stats every 30 seconds during an event ([#181](https://github.com/solarssk/admitto/pull/181))
- Ignore import `source_field` slugs that collide with standard columns, and reject such slugs in event items ([#177](https://github.com/solarssk/admitto/pull/177))
- Validate merged `custom_data` at import commit, and return 400 for conflicting select options ([#177](https://github.com/solarssk/admitto/pull/177))
- Preserve Settings tab drafts and filters when switching tabs ([#178](https://github.com/solarssk/admitto/pull/178))

### Changed

- Group Settings into four in-app tabs: General, Security, Archiving and Identity ([#178](https://github.com/solarssk/admitto/pull/178))
- Show event times in the event timezone with an abbreviation, and admin and system times in UTC with a label ([#161](https://github.com/solarssk/admitto/pull/161))
- Import `resolveTrustProxy` from a lightweight module in the client-ip and healthz rate-limit helpers, avoiding a flaky CI load ([#171](https://github.com/solarssk/admitto/pull/171))
- Add a shared locale whitelist (`SUPPORTED_LOCALE_TAGS`) for API validation and the Account picker ([#161](https://github.com/solarssk/admitto/pull/161))
- Use UTC calendar-day bounds for the Audit log date filters ([#161](https://github.com/solarssk/admitto/pull/161))
- Migrate existing events to UTC; set their timezone in Event Settings after deploying ([#160](https://github.com/solarssk/admitto/pull/160))
- Known limitation: TOTP enrollment on the Account page shows an `otpauth://` URI instead of a QR code

## [0.4.6] - 2026-06-27

### Changed

- Render the check-in camera inline on desktop with the stats sidebar visible, and keep the fullscreen overlay on mobile ([#145](https://github.com/solarssk/admitto/pull/145))
- Add a one-line reminder not to record sensitive personal data to the attendee note modal, linked to the textarea for screen readers ([#158](https://github.com/solarssk/admitto/pull/158))
- Allow HTTPS branding logo URLs in the staff SPA Content-Security-Policy for the setup wizard and settings preview ([#158](https://github.com/solarssk/admitto/pull/158))
- Update the privacy, security and deploy docs: retention tables, OIDC group membership, the Trivy HIGH remediation SLA and the startup purge steps ([#158](https://github.com/solarssk/admitto/pull/158))

### Added

- Add Account self-service at `/account`: profile, password change, TOTP enrollment and reset, and session management (`/api/account/*`) ([#141](https://github.com/solarssk/admitto/pull/141))
- Make `User.password_hash` nullable for OIDC-only accounts ([#141](https://github.com/solarssk/admitto/pull/141))
- Add the Users & roles page at `/admin/users` with invite, edit, role management, resets and a role-assignments tab, backed by `/api/admin/users` ([#142](https://github.com/solarssk/admitto/pull/142))
- Add `must_change_password` with a server-rendered `/change-password` flow after login or an admin password reset ([#142](https://github.com/solarssk/admitto/pull/142))
- Add first-run setup: a server-rendered `/setup` for the first superadmin and a 5-step onboarding wizard gated by `setup_complete` ([#140](https://github.com/solarssk/admitto/pull/140))
- Add a superadmin-only Audit log viewer in Settings (`GET /api/admin/audit-log`) ([#138](https://github.com/solarssk/admitto/pull/138))
- Add the event Reports page at `/admin/events/:id/reports` with stats, an hourly chart, ticket type breakdown, admission log, and CSV and printable export ([#139](https://github.com/solarssk/admitto/pull/139))
- Add `DELETE /api/admin/events/:eventId/attendees/:id` for GDPR erasure, removing dependent rows in one transaction and keeping an audit entry ([#153](https://github.com/solarssk/admitto/pull/153))

### Fixed

- Show the real admission time on repeat scans in the check-in camera result panel ([#145](https://github.com/solarssk/admitto/pull/145))
- Import audit logging in the ops health and readiness rate limiters from `@admitto/auth/audit`, to avoid a flaky CI load
- Polish the Account page: Save disabled when unchanged, live password-confirm feedback and spinner states ([#144](https://github.com/solarssk/admitto/pull/144))
- Stop `runInTransaction` value-importing `PrismaClient`, which made `healthz-rate-limit` unit tests flaky ([#144](https://github.com/solarssk/admitto/pull/144))
- Re-check the empty user table in a Serializable transaction on first-run `POST /setup`, so only one superadmin can be created ([#140](https://github.com/solarssk/admitto/pull/140))
- Run the IAM anti-lockout guards atomically in Serializable transactions, and make an idempotent role DELETE return 204 ([#143](https://github.com/solarssk/admitto/pull/143))
- Stop the setup wizard being bypassed on `/operator` ([#140](https://github.com/solarssk/admitto/pull/140))
- Truncate the event slug before trimming dashes, and cap wizard step 4 at 80 characters ([#140](https://github.com/solarssk/admitto/pull/140))
- Add a partial unique index allowing at most one instance-scoped superadmin `RoleAssignment` ([#140](https://github.com/solarssk/admitto/pull/140))
- Persist `AdminAuditLog` rows in the same transaction as the change they describe ([#148](https://github.com/solarssk/admitto/pull/148))
- Serialise concurrent attendee import commits per event with an advisory lock, and raise the commit timeout to 120 seconds ([#148](https://github.com/solarssk/admitto/pull/148))
- Batch the agency `public_ref` backfill instead of loading all attendees at once ([#148](https://github.com/solarssk/admitto/pull/148))
- Revoke sessions after the user-update transaction commits when a user is deactivated ([#148](https://github.com/solarssk/admitto/pull/148))
- Add a database CHECK constraint for `Attendee.rsvp_status` ([#149](https://github.com/solarssk/admitto/pull/149))
- Use partial unique indexes for `OidcRoleGrant` scoped and instance grants ([#150](https://github.com/solarssk/admitto/pull/150))
- Add CHECK constraints to the attendee, check-in and event item state status columns, and flag `DELETE FROM` in new migrations ([#151](https://github.com/solarssk/admitto/pull/151))
- Redact emails in staff account creation audit metadata and import CLI skipped-row output, and document the attendee-note risk and erasure FK order ([#152](https://github.com/solarssk/admitto/pull/152))
- Wrap the startup `public_ref` backfill in a 120-second timeout, and limit PR-Agent comments to collaborators, members and owners ([#154](https://github.com/solarssk/admitto/pull/154))
- Purge expired and revoked `Session` and `TrustedDevice` rows at container startup, with `purge-auth-retention --dry-run` to preview ([#155](https://github.com/solarssk/admitto/pull/155))
- Nullify stale `EmailDelivery` rendered snapshots older than 60 days at startup (`EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS`) ([#157](https://github.com/solarssk/admitto/pull/157))

### Security

- Enforce a forced password change as a `change_password_required` session stage ([#146](https://github.com/solarssk/admitto/pull/146))
- Persist backup-code acknowledgment (`backup_codes_acknowledged_at`) before a full session is granted ([#146](https://github.com/solarssk/admitto/pull/146))
- Require 12 characters in the forced password-change form, up from 8 ([#146](https://github.com/solarssk/admitto/pull/146))
- Return 409 `single_superadmin_limit` instead of 500 when a second `superadmin@instance` is granted ([#146](https://github.com/solarssk/admitto/pull/146))
- Known limitation: OIDC group-to-role mappings are reconciled at OIDC login only; set the admin session TTL to 8 hours or less and follow the offboarding runbook ([#156](https://github.com/solarssk/admitto/pull/156))
- Use the shared CSV formula-injection sanitizer in attendee, event-settings PII and reports exports ([#147](https://github.com/solarssk/admitto/pull/147))
- Send a restrictive Content-Security-Policy on the printable event report export ([#147](https://github.com/solarssk/admitto/pull/147))
- Redact URLs from `EmailDelivery.error` before it is stored ([#148](https://github.com/solarssk/admitto/pull/148))
- Write REVOKED check-in audit rows inside a transaction ([#148](https://github.com/solarssk/admitto/pull/148))
- Known limitation: the post-event attendee personal data purge is not automated; use Attendees export and the per-attendee `DELETE` API ([#158](https://github.com/solarssk/admitto/pull/158))
- Known limitation: TOTP enrollment on the Account page shows an `otpauth://` URI instead of a QR code ([#158](https://github.com/solarssk/admitto/pull/158))
- Known limitation: the ticket token may appear in server access logs when operators open ticket URLs (accepted risk); limit reverse-proxy log retention ([#158](https://github.com/solarssk/admitto/pull/158))

## [0.4.5] - 2026-06-24

### Added

- Split MFA enrollment into three steps: TOTP confirm, a dedicated backup-codes page, then a full session (`backup_codes_required` stage) ([#128](https://github.com/solarssk/admitto/pull/128))
- Add a centred 6-digit OTP field with auto-focus, paste support and a backup-recovery-code toggle ([#128](https://github.com/solarssk/admitto/pull/128))
- Redirect `GET /` by session: authenticated users to `/admin` or `/operator`, everyone else to `/login` ([#128](https://github.com/solarssk/admitto/pull/128))
- Add the Admitto favicon set (SVG, PNG, Apple touch icon, ICO) served from `/favicon.*` ([#128](https://github.com/solarssk/admitto/pull/128))
- Add a per-provider SSO button label (`login_button_label`), defaulting to "Continue with SSO" ([#128](https://github.com/solarssk/admitto/pull/128))
- Use the checkmark brand mark in the admin sidebar, and pin "All events" and "Settings" to the footer ([#128](https://github.com/solarssk/admitto/pull/128))
- Add the Settings sub-navigation (General, Identity providers, Cloudflare Access), and render the identity admin pages in the full sidebar shell ([#128](https://github.com/solarssk/admitto/pull/128), [#129](https://github.com/solarssk/admitto/pull/129))
- Add date, location and attendee count to event cards, with a hover lift ([#128](https://github.com/solarssk/admitto/pull/128))
- Add the event overview landing page at `/admin/events/:id/overview` with quick stats and links ([#129](https://github.com/solarssk/admitto/pull/129))
- Add the shared admin shell (`StaffShell`): an independently scrolling sidebar, a slim topbar, an optional settings subnav and a mobile drawer ([#129](https://github.com/solarssk/admitto/pull/129))
- Add a mailer status indicator, a role badge and an icon-only sign out to the staff topbar ([#132](https://github.com/solarssk/admitto/pull/132))
- Add a Users & roles link to the sidebar footer for org admins and superadmins ([#132](https://github.com/solarssk/admitto/pull/132))
- Add a dev-only demo bar to trigger sample toasts ([#132](https://github.com/solarssk/admitto/pull/132))
- Add check-in v2: a split layout with scan bar, connection banner, stats sidebar, recent scans and a fullscreen camera overlay ([#133](https://github.com/solarssk/admitto/pull/133))
- Add the Create event UI: `POST /api/admin/events` and a New event modal ([#134](https://github.com/solarssk/admitto/pull/134))
- Polish the events picker: active badge, responsive grid and an empty state with a Create event button ([#134](https://github.com/solarssk/admitto/pull/134))
- Add Attendees v2: a wider table, manual `POST /attendees`, a full attendee detail page with activity log, an Add attendee modal and an `rsvp_status` migration ([#135](https://github.com/solarssk/admitto/pull/135))
- Add the event settings page at `/admin/events/:id/settings`: title, date, location, capacity, superadmin PII CSV export and archive ([#136](https://github.com/solarssk/admitto/pull/136))

### Changed

- Include `mailer_status` (provider presence only, no credentials) in `GET /api/admin/me` ([#132](https://github.com/solarssk/admitto/pull/132))
- Move the toast stack to the top right, below the staff topbar ([#132](https://github.com/solarssk/admitto/pull/132))
- Make the check-in keyboard wedge input `inputMode="none"`, auto-submit long tokens and clear the result state with Esc ([#133](https://github.com/solarssk/admitto/pull/133))
- Document local dev onboarding in the README and a new `apps/admin/README.md` ([#131](https://github.com/solarssk/admitto/pull/131))
- Forward `/mfa` through the admin Vite dev proxy, so MFA enrollment works on `:5173` ([#131](https://github.com/solarssk/admitto/pull/131))
- Set the login page title to "Admitto" and add meta tags for password-manager naming ([#128](https://github.com/solarssk/admitto/pull/128))
- Use a paragraph instead of `<h1>` for the MFA page heading, keeping Admitto as the `<h1>` ([#128](https://github.com/solarssk/admitto/pull/128))
- Forward `$http_host` from Nginx in `Host` and `X-Forwarded-Host`, so `127.0.0.1:8080` logins no longer return 403 ([#128](https://github.com/solarssk/admitto/pull/128))
- Add superadmin instance settings at `/admin/settings` with a branding panel, live theme preview and anti-lockout guards ([#96](https://github.com/solarssk/admitto/pull/96))
- Add the Settings Mail transport panel: provider, masked secrets, env-locked fields and test send ([#99](https://github.com/solarssk/admitto/pull/99))
- Add the Settings Sessions and Security panels: list and revoke staff sessions, bulk operator revoke, session TTL and MFA policy (`/api/admin/system-settings`) ([#112](https://github.com/solarssk/admitto/pull/112))
- Add event archiving (`Event.archived_at`): superadmin archive and unarchive, read-only archived events, Active and Archived tabs, and check-in stays available ([#116](https://github.com/solarssk/admitto/pull/116))
- Use a single main scroll region in the admin shell, and add Overview to the live event sidebar ([#129](https://github.com/solarssk/admitto/pull/129))
- Show a "Step X of 3" indicator and auto-submit after six digits in MFA enrollment and verify ([#129](https://github.com/solarssk/admitto/pull/129))
- Trim redundant context labels and the duplicate Instance settings action from the sidebar ([#129](https://github.com/solarssk/admitto/pull/129))
- Add `Spinner`, `EmptyState`, `Skeleton` and `ToastProvider` / `useToast` to `@admitto/ui` ([#120](https://github.com/solarssk/admitto/pull/120))
- Wrap the admin app in `ToastProvider` and add a recoverable `ErrorBoundary` ([#97](https://github.com/solarssk/admitto/pull/97), [#120](https://github.com/solarssk/admitto/pull/120))
- Add admin UX micro-fixes: import column reference and CSV template, delivery log purpose filter, compose dirty-state guard, attendee drawer discard confirmation and check-in admitted/total stats ([#121](https://github.com/solarssk/admitto/pull/121))
- Add `POST /mfa/enroll/download-codes` to download backup codes as `.txt` during enrollment ([#117](https://github.com/solarssk/admitto/pull/117))
- Replace `window.prompt` for attendee notes with `NoteModal` in check-in ([#114](https://github.com/solarssk/admitto/pull/114))
- Upgrade the runtime to Node 24 LTS and React 18 to 19 across admin and web ([#111](https://github.com/solarssk/admitto/pull/111), [#110](https://github.com/solarssk/admitto/pull/110))
- Align the login, MFA and superadmin identity-provider HTML pages with the Admitto design tokens ([#117](https://github.com/solarssk/admitto/pull/117))
- Use a select for the OIDC group mapping role, and add inline enable and disable to the provider list ([#117](https://github.com/solarssk/admitto/pull/117))
- Show a status badge, a fall-through explanation and an enable warning on the Cloudflare Access admin form ([#117](https://github.com/solarssk/admitto/pull/117))
- Use `ConfirmDialog` instead of `window.confirm` in Requirements and Communication ([#97](https://github.com/solarssk/admitto/pull/97))

### Fixed

- Print the guest ticket page correctly: white background, no wallet buttons, no shadows ([#127](https://github.com/solarssk/admitto/pull/127))
- Sanitize dynamic attribute column headers in exports against formula injection ([#97](https://github.com/solarssk/admitto/pull/97))
- Fix the local dev login and MFA CSRF check when `Origin` and `Referer` are absent (Safari), and the admin SPA dist path ([#115](https://github.com/solarssk/admitto/pull/115))
- Use the event name prefix in the admin page title without regressing the visible `h1` ([#118](https://github.com/solarssk/admitto/pull/118))
- Show a fallback banner when SSO fails on `/login`, and drop the "SSO coming soon" placeholder ([#117](https://github.com/solarssk/admitto/pull/117))
- Colour the check-in card's left border by scan status ([#114](https://github.com/solarssk/admitto/pull/114))
- Title the login page "Sign in to Admitto" ([#114](https://github.com/solarssk/admitto/pull/114))
- Mark the sidebar Overview section "Soon" until it is built ([#114](https://github.com/solarssk/admitto/pull/114))
- Fix the Settings subnav active tab, the "Soon" badge styling and unwanted link hover underlines in the sidebar ([#129](https://github.com/solarssk/admitto/pull/129))
- Polish the OIDC admin form: `type="url"` fields, add and remove mapping rows, a scope select, a live SSO button preview and kept drafts after a failed save ([#130](https://github.com/solarssk/admitto/pull/130))
- Clarify the Cloudflare Access settings copy, and label the action "Test connection" ([#130](https://github.com/solarssk/admitto/pull/130))
- Add search to the events picker, and cap its content width and columns ([#130](https://github.com/solarssk/admitto/pull/130))
- Remove the check-in camera fullscreen toggle, debounce repeated ZXing decodes, and extract ticket tokens from QR URLs with a trailing slash or query ([#133](https://github.com/solarssk/admitto/pull/133))
- Show a dedicated feedback card for invalid and revoked check-in scans ([#114](https://github.com/solarssk/admitto/pull/114))
- Restore the missing Switch thumb, show Requirements items with a name and generated key, and clean up the drawer layout ([#129](https://github.com/solarssk/admitto/pull/129))
- Remove hover lift and underline noise from event picker cards ([#129](https://github.com/solarssk/admitto/pull/129))
- Disable Vercel Git deploys with a root `vercel.json` (self-hosted Docker only)

### Security

- Allow-list the branding `font_family_name` on save and ticket page render, to block CSS and HTML injection via custom fonts ([#96](https://github.com/solarssk/admitto/pull/96))
- Add the `deploy/validate-env.sh` pre-flight; production boot fails fast when `REDIS_URL` is missing or unauthenticated, or `ENCRYPTION_KEY` is invalid ([#125](https://github.com/solarssk/admitto/pull/125))
- Add structured audit events for rate limits, MFA, OIDC login, logout, admin 403 and settings changes ([#123](https://github.com/solarssk/admitto/pull/123))
- Require `https://` for the production `BASE_URL`, except `localhost` and `127.0.0.1` smoke tests ([#123](https://github.com/solarssk/admitto/pull/123))
- Restrict OIDC ID token verification to RS, ES and PS JWT algorithms (no `none`) ([#123](https://github.com/solarssk/admitto/pull/123))
- Require `REDIS_PASSWORD` in the deploy Redis, and wire an authenticated `REDIS_URL` in compose ([#123](https://github.com/solarssk/admitto/pull/123))
- Add baseline security headers (HSTS, nosniff, frame deny) to the Nginx proxy, and use the Docker bridge gateway for RealIP behind NPM ([#123](https://github.com/solarssk/admitto/pull/123))
- Add baseline security headers to `/healthz` and `/readyz` ([#123](https://github.com/solarssk/admitto/pull/123))
- Mark GitHub Releases for `v0.x.y` as pre-release until `v1.0.0` ([#123](https://github.com/solarssk/admitto/pull/123))
- Rate-limit MFA enroll, `/healthz`, admin import and template preview, and OIDC discover and test; resolve DNS before OIDC outbound fetches; fall back to the socket IP for a malformed `X-Forwarded-For` ([#126](https://github.com/solarssk/admitto/pull/126))
- Document the rate-limit matrix, the `TRUST_PROXY` trust model, SSRF and DNS-rebinding guards and the pen-test retest checklist in `docs/security/SECURITY-CONTROLS.md` ([#126](https://github.com/solarssk/admitto/pull/126))

## [0.4.4] - 2026-06-19

### Security

- Bump the transitive `undici` 6.26.0 to 6.27.0 (CVE-2026-12151 high, CVE-2026-9679 moderate, CVE-2026-11525 and CVE-2026-6733 low) ([#94](https://github.com/solarssk/admitto/pull/94))

### Fixed

- Run the container publish workflow scan-only (Trivy SARIF, CRITICAL gate) on `workflow_dispatch` for branch refs ([#93](https://github.com/solarssk/admitto/pull/93))
- Restrict the GHCR push, provenance attestation and release SBOM to `refs/tags/v*.*.*` semver refs ([#93](https://github.com/solarssk/admitto/pull/93))

## [0.4.3] - 2026-06-19

### Added

- Export the attendee list to CSV, XLSX and PDF with a check-off column and formula-injection sanitization ([#88](https://github.com/solarssk/admitto/pull/88))
- Drive the custom attributes in the admin drawer from `EventItem.config.contents` instead of a hardcoded `shirt_size` ([#91](https://github.com/solarssk/admitto/pull/91))
- Follow `EventItem.config.contents` in the export columns ([#91](https://github.com/solarssk/admitto/pull/91))
- Add the corporate readiness docs: `SECURITY-CONTROLS.md`, `CORPORATE-DEPLOYMENT.md`, `ARCHITECTURE-FOR-AUDITORS.md`, `GDPR-ONE-PAGER.md`, `SUBPROCESSORS.md`, `DSAR-PROCEDURE.md` and `INCIDENT-RESPONSE.md` ([#90](https://github.com/solarssk/admitto/pull/90))
- Validate `custom_data_fields` keys with Zod, and keep a stable export column order ([#91](https://github.com/solarssk/admitto/pull/91))
- Disambiguate duplicate Excel headers as `Label (source_field)`, and scale PDF column widths down when many attributes exceed the page ([#91](https://github.com/solarssk/admitto/pull/91), [#88](https://github.com/solarssk/admitto/pull/88))
- Use isolated events in the export integration tests ([#92](https://github.com/solarssk/admitto/pull/92))

### Changed

- Add a legal basis note (LIA for legitimate interest) to `DATA-PROTECTION.md` ([#90](https://github.com/solarssk/admitto/pull/90))

### Fixed

- Degrade the drawer gracefully when the event-items API fails ([#92](https://github.com/solarssk/admitto/pull/92))

### Security

- Make Semgrep SAST findings block pull requests, by removing `|| true` from the CI step ([#90](https://github.com/solarssk/admitto/pull/90))

## [0.4.2] - 2026-06-19

### Added

- Add the admin attendee table with pagination, search, and status and ticket-type filters ([#70](https://github.com/solarssk/admitto/pull/70))
- Add an edit drawer to change guest fields in place, view the communication history and resend the ticket email ([#70](https://github.com/solarssk/admitto/pull/70))
- Import attendees from CSV and XLSX in the admin: canonical headers, row preview and validation errors, an overwrite toggle and agency UUID or QR payload support ([#71](https://github.com/solarssk/admitto/pull/71))
- Add event-day configuration: event items (gift bag, badge, headset), `ops_config` toggles and content fields linked to attendee data ([#72](https://github.com/solarssk/admitto/pull/72))
- Add admin mail UI: edit MJML or HTML templates, preview with sample data and send a test message ([#75](https://github.com/solarssk/admitto/pull/75))
- Add a browsable per-event delivery log (status and retries, no rendered HTML in list views) ([#75](https://github.com/solarssk/admitto/pull/75))
- Add the token-protected `GET /readyz` readiness check for database, Redis and migration status ([#73](https://github.com/solarssk/admitto/pull/73))
- Take a pre-migration database backup on container start when migrations are pending ([#81](https://github.com/solarssk/admitto/pull/81))
- Add a CI guard against destructive migration SQL, a rollback runbook and a backup smoke test ([#81](https://github.com/solarssk/admitto/pull/81))
- Add a Trivy image scan and a CycloneDX SBOM to CI ([#79](https://github.com/solarssk/admitto/pull/79))
- Match selected `custom_data` fields in exports ([#82](https://github.com/solarssk/admitto/pull/82))

### Changed

- Scope backend routes by event (the wrong event returns 403), with CSRF on mutating calls ([#70](https://github.com/solarssk/admitto/pull/70))
- Apply migrations automatically on container start, with no manual `migrate deploy` ([#81](https://github.com/solarssk/admitto/pull/81))
- Require Node 22.13 or later for the exceljs and uuid interop ([#83](https://github.com/solarssk/admitto/pull/83))

### Fixed

- Return a stale-write response on a second save of the same guest instead of overwriting it ([#80](https://github.com/solarssk/admitto/pull/80))
- Add request body limits and safe error messages to the mail endpoints, and an export-only dev sink for local mail testing ([#76](https://github.com/solarssk/admitto/pull/76), [#77](https://github.com/solarssk/admitto/pull/77))
- Force the transitive `uuid` to 14.0.0, and bump the vitest, eslint and argon2 patch versions ([#83](https://github.com/solarssk/admitto/pull/83), [#84](https://github.com/solarssk/admitto/pull/84))

### Database migrations

- `20260618120000_event_item_contents`: metadata for configurable event-item content
- `20260618140000_attendee_updated_at`: `updated_at` on attendees for optimistic locking

## [0.4.1] - 2026-06-17

### Added

- Add the attendee card after a scan or manual lookup: name, company, ticket type, check-in status, warnings, item rows, recent notes and audit context ([#67](https://github.com/solarssk/admitto/pull/67))
- Add item fulfilment at the door: gift bag, badge (auto-issued on check-in when configured) and headset (issue and return) ([#67](https://github.com/solarssk/admitto/pull/67))
- Log every item and check-in change in `AttendeeActionLog` (who, session, device, IP) ([#67](https://github.com/solarssk/admitto/pull/67))
- Add manual lookup by name or email with the request in the body, not the URL, also matching `company` and `department` in `custom_data` ([#67](https://github.com/solarssk/admitto/pull/67))
- Add a scan history sidebar with the admitted count, and operator notes of up to 2,000 characters with author and time ([#67](https://github.com/solarssk/admitto/pull/67))
- Add a per-tablet undo of the last check-in, which rolls back the admission and the auto-issued badge ([#67](https://github.com/solarssk/admitto/pull/67))
- Add opt-in camera QR decoding with a dynamically loaded `@zxing/browser`, keeping the USB keyboard wedge as the primary scan path ([#67](https://github.com/solarssk/admitto/pull/67))

### Changed

- Use the same admit path for manual lookup as for a scan, so a repeat tap cannot admit twice ([#67](https://github.com/solarssk/admitto/pull/67))
- Hide undo when the session has no device label, matching the server's 409 ([#68](https://github.com/solarssk/admitto/pull/68))

### Database migrations

- `20260617120000_event_day_ops`: `custom_data`, `ops_config`, event items, item states, notes and action log
- `20260617130000_attendee_note_body_check`: DB CHECK on note body length

## [0.4.0] - 2026-06-17

### Added

- Add the `@admitto/ui` design system: tokens, status badges, 13 React primitives and theme variables with an anti-lockout branding fallback ([#56](https://github.com/solarssk/admitto/pull/56), [#60](https://github.com/solarssk/admitto/pull/60))
- Serve the admin and operator shells from the API origin, with a role-based redirect after login ([#56](https://github.com/solarssk/admitto/pull/56))
- Add an auth-aware heartbeat (`ConnectionStateProvider`), so tablets know when the server session is alive ([#56](https://github.com/solarssk/admitto/pull/56))
- Add the staff SPA at `/admin` and `/operator`, and reskin the public ticket page `/t` to match ([#56](https://github.com/solarssk/admitto/pull/56))
- Add a scanner-first check-in entry: autofocus buffer, Enter to submit, refocus after each scan and a ~300 ms duplicate debounce ([#59](https://github.com/solarssk/admitto/pull/59))
- Add a scan result card with a status badge, and a shared check-in route for admin and operator URLs ([#59](https://github.com/solarssk/admitto/pull/59))
- Self-host Tabler Icons and the Inter font, with no runtime dependency on jsDelivr or Google Fonts ([#62](https://github.com/solarssk/admitto/pull/62))
- Add defense-in-depth headers to the staff SPA shell (CSP, `nosniff`, `no-referrer`, `frame-ancestors 'none'`) ([#61](https://github.com/solarssk/admitto/pull/61))

### Changed

- Replace hardcoded hex colours in `components.css` and `ticket.css` with semantic theme tokens ([#60](https://github.com/solarssk/admitto/pull/60))
- Make `Tabs` reconcile `active` when its `tabs` prop changes after mount ([#60](https://github.com/solarssk/admitto/pull/60))

### Fixed

- Redirect in a controlled way when post-login path resolution fails, instead of an HTTP 500 ([#57](https://github.com/solarssk/admitto/pull/57))

## [0.3.7] - 2026-06-16

### Added

- Add `scripts/release-tag.sh` for signed annotated tags, and `VERSIONING.md` with the signing setup and release steps; re-sign the tags `v0.3.3` to `v0.3.6` ([#54](https://github.com/solarssk/admitto/pull/54))

## [0.3.6] - 2026-06-16

### Added

- Add a multi-stage production Docker image for `apps/web`, running migrations on container start ([#52](https://github.com/solarssk/admitto/pull/52))
- Add `deploy/docker-compose.yml` with the app, Postgres, Redis and nginx ([#52](https://github.com/solarssk/admitto/pull/52))
- Add `GET /healthz` with a database ping for Docker health checks ([#52](https://github.com/solarssk/admitto/pull/52))
- Add a CI `docker-build` job, and `publish-container` pushing `ghcr.io/solarssk/admitto:0.x.y` and a rolling `:0.x` on each semver tag ([#52](https://github.com/solarssk/admitto/pull/52), [#53](https://github.com/solarssk/admitto/pull/53))
- Add an optional `deploy-smoke` `workflow_dispatch` ([#52](https://github.com/solarssk/admitto/pull/52))

## [0.3.5] - 2026-06-15

### Added

- Validate the Cloudflare Access JWT on `/admin*` and `/api/admin*`; a missing JWT redirects to `/login` ([#50](https://github.com/solarssk/admitto/pull/50))
- Resolve the Cloudflare identity per request through the `ExternalIdentity` seam, with no long-lived Admitto session for CF logins ([#50](https://github.com/solarssk/admitto/pull/50))
- Add a superadmin UI for the team domain, audience and JWKS test; environment locks override the database as a kill switch ([#50](https://github.com/solarssk/admitto/pull/50))
- Sync the group-to-role mapping on each valid CF JWT, and fail boot fast when CF Access is enabled without a team domain or AUD ([#50](https://github.com/solarssk/admitto/pull/50))
- Add the `CF_ACCESS_ENABLED=false` environment override as an emergency kill switch ([#50](https://github.com/solarssk/admitto/pull/50))

### Database migrations

- `20260615200000_cf_access_settings`: system settings defaults for CF Access keys

## [0.3.4] - 2026-06-15

### Added

- Add OIDC login (Authentik-first): Authorization Code with PKCE and full ID token validation (JWKS, issuer, audience, nonce) ([#47](https://github.com/solarssk/admitto/pull/47))
- Provision new OIDC users with no roles unless a configured group-to-role rule matches (fail closed) ([#47](https://github.com/solarssk/admitto/pull/47))
- Require an explicit `?link=1` step-up (password, and TOTP when required) to link an account, with `link_step_up_at` on the OAuth state (5 minute TTL) ([#47](https://github.com/solarssk/admitto/pull/47))
- Track OIDC-provisioned roles in `OidcRoleGrant`; a demotion revokes grants without touching manual `RoleAssignment` rows ([#47](https://github.com/solarssk/admitto/pull/47))
- Add a superadmin UI for OIDC provider config, with client secrets encrypted at rest and SSRF guards on discovery URLs ([#47](https://github.com/solarssk/admitto/pull/47))
- Add the shared `resolveOrCreateUserFromExternalIdentity` seam for Cloudflare Access ([#47](https://github.com/solarssk/admitto/pull/47))

### Changed

- Require TLS 1.2 or later in the SMTP adapter ([#48](https://github.com/solarssk/admitto/pull/48))
- Clamp the check-in history `limit` to 1 to 100 at the HTTP and domain layers ([#48](https://github.com/solarssk/admitto/pull/48))

### Fixed

- Remove duplicate `RoleAssignment` rows, and add partial unique indexes on scoped and instance roles ([#48](https://github.com/solarssk/admitto/pull/48))
- Resolve HTTP endpoints before the database transaction when an OIDC provider is saved ([#48](https://github.com/solarssk/admitto/pull/48))
- Make grant creation idempotent under concurrent OIDC logins (`P2002` becomes a safe no-op) ([#48](https://github.com/solarssk/admitto/pull/48))
- Run `prisma migrate deploy` on `admitto_auth_test` before the auth integration tests in CI

### Database migrations

- `20260615120000_oidc_linking`: `IdentityProvider`, `ExternalIdentity` and OAuth state tables
- `20260615140000_oidc_hardening`: schema and index hardening
- `20260615160000_oidc_scope_normalization`: scope normalization for group-to-role mappings
- `20260615170000_oidc_link_step_up`: `link_step_up_at` on OAuth state
- `20260615180000_oidc_role_grants`: `OidcRoleGrant` and group mapping tables
- `20260615190000_role_assignment_unique`: dedup, partial unique indexes, grant repoint and FK cascade

## [0.3.3] - 2026-06-14

### Added

- Add TOTP 2FA for admin and superadmin roles; operators are unchanged ([#39](https://github.com/solarssk/admitto/pull/39))
- Add the partial session stages `mfa_pending` and `enrollment_required`, which gate privileged routes until TOTP completes ([#39](https://github.com/solarssk/admitto/pull/39))
- Add one-time backup recovery codes, hashed with argon2id ([#39](https://github.com/solarssk/admitto/pull/39))
- Add an optional trusted-device cookie (hash-only in the database) that skips TOTP on known browsers, and is revoked on logout, MFA reset and session revoke ([#39](https://github.com/solarssk/admitto/pull/39))
- Add the break-glass CLI commands `reset-mfa` and `generate-emergency-recovery` (superadmin@instance only, audited) ([#39](https://github.com/solarssk/admitto/pull/39))
- Add `SystemSettings` for session TTL, operator session TTL, trusted device days and `mfa_required_roles` (environment lock, then database, then default) ([#39](https://github.com/solarssk/admitto/pull/39))

### Security

- Honour `X-Forwarded-Proto` and `X-Forwarded-Host` in the CSRF origin check only when `TRUST_PROXY=true` ([#46](https://github.com/solarssk/admitto/pull/46))
- Add TOTP replay protection (`last_totp_time_step` and otplib `afterTimeStep`), with a conditional update that guards against parallel replay ([#46](https://github.com/solarssk/admitto/pull/46))

### Changed

- Update dependencies: `hono` 4.12.25, `@hono/node-server` 2.0.4, `redis` 6.0.0, `zod` 4.4.3, `@typescript-eslint/parser` 8.61.0 and the CodeQL action SHA ([#46](https://github.com/solarssk/admitto/pull/46))
- Adapt `RedisRateLimitStore` to redis v6 (`withAbortSignal()`, two-argument `eval()`) ([#46](https://github.com/solarssk/admitto/pull/46))

### Database migrations

- `20260614130000_2fa_totp`: `Session.stage`, `UserMfaMethod`, `TrustedDevice`, a `SystemSettings` seed, and re-staged active elevated sessions
- `20260614210000_totp_replay_protection`: `UserMfaMethod.last_totp_time_step`

## [0.3.2] - 2026-06-14

### Added

- Add server-rendered operator login and logout with a `httpOnly`, `SameSite=Lax` session cookie, CSRF, a device label, and IP and per-email login rate limits ([#35](https://github.com/solarssk/admitto/pull/35))
- Add `Attendee.public_ref` for agency ticket URLs: `/t/:slug/a/:ref` and `/q/:slug/a/:ref.png` resolve by it instead of the internal id, with a backfill on deploy ([#35](https://github.com/solarssk/admitto/pull/35))
- Add `scripts/test-web-like-ci.sh` for local CI parity, and a test contract in `apps/web/test/README.md` ([#37](https://github.com/solarssk/admitto/pull/37))

### Changed

- Default `ALLOW_CHECKIN_BEARER=false`: scan and history need a session and event scope, and the Bearer token is break-glass only ([#35](https://github.com/solarssk/admitto/pull/35))
- Apply per-operator scan and history rate limits after authentication, separate from the unauthenticated IP quota ([#35](https://github.com/solarssk/admitto/pull/35))
- Stabilise the integration tests: Vitest unit tests without Postgres, and integration tests with one `globalSetup` running `migrate deploy` ([#37](https://github.com/solarssk/admitto/pull/37))

### Fixed

- Fix CI failures from the shared `admitto_web_test` database (`P3005`, Prisma segfault) by cleaning up fixtures instead of resetting the database per file ([#36](https://github.com/solarssk/admitto/pull/36))

## [0.3.1] - 2026-06-14

### Added

- Add local `User` accounts with argon2id password hashing and an `is_active` state ([#33](https://github.com/solarssk/admitto/pull/33))
- Add the break-glass superadmin bootstrap CLI `npm run auth:bootstrap` (password from stdin, not argv) ([#33](https://github.com/solarssk/admitto/pull/33))
- Add the `@admitto/auth` package: login, logout, session validation, password verification, auth audit logging and capability-aware authorization ([#33](https://github.com/solarssk/admitto/pull/33))
- Add `POST /api/auth/login`, `POST /api/auth/logout` and `GET /api/auth/me` ([#33](https://github.com/solarssk/admitto/pull/33))
- Add event-scoped check-in RBAC: `superadmin@instance`, `admin@organization` and `operator@event` ([#33](https://github.com/solarssk/admitto/pull/33))
- Add DB-backed `Session` records with opaque tokens (only `token_hash` stored), expiry, single-session revoke and event-scoped bulk revoke ([#33](https://github.com/solarssk/admitto/pull/33))
- Use role-sensitive session lifetimes: shorter for operators, longer for admin and superadmin ([#33](https://github.com/solarssk/admitto/pull/33))

### Changed

- Accept a valid session or the transitional legacy Bearer token on `/api/checkin/*` ([#33](https://github.com/solarssk/admitto/pull/33))

### Security

- Return uniform unauthorized responses for a bad email and a bad password, to reduce user enumeration ([#33](https://github.com/solarssk/admitto/pull/33))
- Add a dummy verification path for missing users, and structured login audit logs without password or session token leakage ([#33](https://github.com/solarssk/admitto/pull/33))
- Rate-limit logins, and use a `httpOnly`, `SameSite=Lax` session cookie that is `Secure` outside development ([#33](https://github.com/solarssk/admitto/pull/33))

## [0.3.0] - 2026-06-13

### Added

- Add a provider-level test send (one message per event), read-only mail config inspection with masked secrets, and a delivery log without full rendered HTML bodies ([#31](https://github.com/solarssk/admitto/pull/31))
- Add Redis-backed shared rate limiting on the public `/t/*` and `/q/*` routes, with an in-memory fallback without Redis ([#32](https://github.com/solarssk/admitto/pull/32))

### Changed

- Let rate limiting fail open when Redis is configured but unavailable, so ticket access takes priority during an outage ([#32](https://github.com/solarssk/admitto/pull/32))

## [0.2.4] - 2026-06-11

### Fixed

- Add defensive CHECK constraints on `RoleAssignment`, harden the crypto key-version behaviour, and make the seed fail predictably when encryption is misconfigured ([#24](https://github.com/solarssk/admitto/pull/24))

## [0.2.3] - 2026-06-11

### Added

- Add `Organization` as the tenant boundary, with `organization_id` through the event and delivery model ([#23](https://github.com/solarssk/admitto/pull/23))
- Add role and scope groundwork: `superadmin`, `admin` and `operator` ([#23](https://github.com/solarssk/admitto/pull/23))
- Encrypt attendee ticket tokens at rest via `@admitto/crypto` (AES-256-GCM) ([#23](https://github.com/solarssk/admitto/pull/23))

## [0.2.2] - 2026-06-11

### Added

- Add Docker Compose with PostgreSQL for local development, and CI service wiring for the real database path ([#22](https://github.com/solarssk/admitto/pull/22))
- Add relational constraints that prevent cross-event check-in mistakes at the database layer ([#22](https://github.com/solarssk/admitto/pull/22))

### Changed

- Standardise on PostgreSQL as the single database engine for development, CI and production ([#22](https://github.com/solarssk/admitto/pull/22))

## [0.2.1] - 2026-06-11

### Added

- Add atomic single-use check-in, so one QR code or token cannot admit twice (CAS) ([#21](https://github.com/solarssk/admitto/pull/21))
- Add a recent check-in history endpoint ([#21](https://github.com/solarssk/admitto/pull/21))
- Add a temporary operator Bearer gate on `/api/checkin/*` ([#21](https://github.com/solarssk/admitto/pull/21))

## [0.2.0] - 2026-06-08

### Added

- Add CSV and XLSX attendee import with agency UUID preservation ([#19](https://github.com/solarssk/admitto/pull/19))
- Add internal QR and token issuance, with agency UUID and external payload support ([#20](https://github.com/solarssk/admitto/pull/20))
- Add the public ticket page (`/t/:slug`) and hosted QR image routes (`/q/:slug`) ([#20](https://github.com/solarssk/admitto/pull/20))
- Separate internally generated token-based tickets from agency-provided identifiers ([#20](https://github.com/solarssk/admitto/pull/20))

## [0.1.0] - 2026-06-08

### Added

- Set up the monorepo with the initial DB schema and package boundaries ([#4](https://github.com/solarssk/admitto/pull/4))
- Add the CI pipeline and a basic security baseline (CodeQL, Semgrep, gitleaks, npm audit, Dependabot) ([#1](https://github.com/solarssk/admitto/pull/1), [#14](https://github.com/solarssk/admitto/pull/14), [#15](https://github.com/solarssk/admitto/pull/15))
- Add mail adapter groundwork ([#5](https://github.com/solarssk/admitto/pull/5))
- Record the Gate 0 outcome: Power Automate as the MVP mail path, with Graph and SMTP as future re-validation candidates

[Unreleased]: https://github.com/solarssk/admitto/compare/v0.7.7...HEAD
[0.7.7]: https://github.com/solarssk/admitto/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/solarssk/admitto/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/solarssk/admitto/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/solarssk/admitto/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/solarssk/admitto/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/solarssk/admitto/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/solarssk/admitto/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/solarssk/admitto/compare/v0.6.8...v0.7.0
[0.6.8]: https://github.com/solarssk/admitto/compare/v0.6.7...v0.6.8
[0.6.7]: https://github.com/solarssk/admitto/compare/v0.6.6...v0.6.7
[0.6.6]: https://github.com/solarssk/admitto/compare/v0.6.5...v0.6.6
[0.6.5]: https://github.com/solarssk/admitto/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/solarssk/admitto/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/solarssk/admitto/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/solarssk/admitto/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/solarssk/admitto/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/solarssk/admitto/compare/v0.5.5...v0.6.0
[0.5.5]: https://github.com/solarssk/admitto/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/solarssk/admitto/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/solarssk/admitto/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/solarssk/admitto/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/solarssk/admitto/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/solarssk/admitto/compare/v0.4.14...v0.5.0
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
