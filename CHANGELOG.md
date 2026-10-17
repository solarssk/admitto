# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each entry is one line that starts with a verb and links to the pull request with the details.

## [Unreleased]

### Changed

- Show a wallet pass as "Pending" on the attendee's page while it is being made ([#1690](https://github.com/solarssk/admitto/pull/1690))
- Document `migrate` and P3009 recovery, `app` memory sizing, container hardening, the sign-in limit, SSO two-factor and what Redis holds ([#1695](https://github.com/solarssk/admitto/pull/1695))

### Fixed

- Show one "archived" bar above every page of an archived event, with "Restore event" for a Superadmin ([#1687](https://github.com/solarssk/admitto/pull/1687))
- Remove the repeated "archived" line from the other Event settings tabs and the image library ([#1686](https://github.com/solarssk/admitto/pull/1686))
- Remove the "archived" note from the Check-in settings tab and centre its switches on their labels ([#1685](https://github.com/solarssk/admitto/pull/1685))
- Return 400 instead of a server error for unreadable pinned-note, key-contact and link requests, and stop an empty pinned-note request from clearing the note ([#1700](https://github.com/solarssk/admitto/pull/1700))
- Fit the staff top bar on a phone so the account menu stays open ([#1698](https://github.com/solarssk/admitto/pull/1698))

### Security

- Delete export and import files that no job names (counted as `orphaned_job_files`), so a killed process cannot leave an attendee list in storage ([#1688](https://github.com/solarssk/admitto/pull/1688))
- Delete a wallet pass that Admitto never recorded when its attendee is erased or removed from an event ([#1690](https://github.com/solarssk/admitto/pull/1690), [#1691](https://github.com/solarssk/admitto/pull/1691))
- Refuse an XLSX file with too many rows or cells before it is read into memory ([#1693](https://github.com/solarssk/admitto/pull/1693), [#1697](https://github.com/solarssk/admitto/pull/1697))
- Stop converting an XLSX file as soon as its text passes the 10 MiB limit ([#1697](https://github.com/solarssk/admitto/pull/1697))
- Answer malformed requests with 400 or 404 instead of a server error, and log failed sign-ins with unusual e-mail characters ([#1699](https://github.com/solarssk/admitto/pull/1699))
- End the identity provider's session when a user signs out of an SSO session, in every browser ([#1694](https://github.com/solarssk/admitto/pull/1694))
- Make SSO sign-in stricter: bound provider replies, require ID token claims and log the reason a sign-in failed ([#1696](https://github.com/solarssk/admitto/pull/1696))
- Read an XLSX import in a separate process with fixed memory and time limits; a stopped file is logged as `xlsx_decode_stopped` ([#1716](https://github.com/solarssk/admitto/pull/1716))

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

[Unreleased]: https://github.com/solarssk/admitto/compare/v0.7.5...HEAD
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
