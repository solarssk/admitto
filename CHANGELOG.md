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

- Settings → Logs & audit → System now has three additional log sources: Worker (background job activity - mail delivery, import/export, wallet push/message drains, bounce ingest, wallet sync, retention), Wallet (Apple/Google Wallet provider operations - issue, void, push, search), and External services (outbound weather and maps/geocoding calls). None of this activity reached the live tail before.

### Changed

- Communication → Delivery log's "View sent message" preview now shows the recipient's real ticket link and QR code instead of a redacted placeholder. Event managers already have equivalent access to the same real ticket link one click away (attendee detail → More actions → Copy ticket link), so hiding it in the preview no longer served a purpose.

### Fixed

- The login, MFA, change-password, and other server-rendered auth pages no longer block same-origin fetch/XHR requests such as Cloudflare's own edge-injected bot-detection beacon (`/cdn-cgi/challenge-platform/...`). Their Content-Security-Policy previously omitted `connect-src` entirely on an instance with no trusted origins configured, so it fell back to `default-src 'none'` and blocked even requests to Admitto's own origin.
- Event Overview's Key contacts avatars are now centered against the full row height instead of anchored to the top, so they no longer sit noticeably above center once a contact has a role or note wrapping the row to two lines.
- The staff user edit modal (Users & roles) no longer permanently reserves scrollbar-gutter space on its right edge, matching every other modal that shares its layout - a short profile (no recent logins, no role chips) sat with dead space on the right where a scrollbar was never going to appear.
- Settings → Logs & audit → System's Level filter dropdown no longer opens far wider than its four short options need, leaving a mostly-empty panel hugging the toolbar's right edge.

### Security

- The production Docker image no longer ships the full development toolchain (TypeScript, ESLint, Vitest, Vite). A Dockerfile step meant to restore Prisma CLI's runtime dependencies after pruning devDependencies was instead restoring every pruned package, shrinking the image by about 200 MB and removing 11 CVEs (10 high, 1 medium) that lived in TypeScript's native compiler binary.
- `bootstrap-superadmin --force` (both `npm run cli -w @admitto/auth --` and the `admitto` CLI) no longer hangs forever when the confirmation and password answers are piped in together, as any scripted/non-interactive caller does - only a human typing at a real terminal, one line at a time, avoided the underlying readline bug.

## [0.5.4] - 2026-08-21

### Added

- Users & roles: the staff user modal and My account's SSO menu now show the actual linked identity provider name(s) (e.g. "Authentik", or "Authentik + Cloudflare Access" when also linked through Cloudflare Access) instead of the generic "Identity provider" label.
- Bulk check-in from the Attendees list now asks for confirmation before admitting everyone selected, matching the other bulk actions (revoke, delete, send tickets) on the same toolbar.
- Event Settings → Wallet → Field mapping has a new `event_date_short` placeholder alongside the existing `event_date` - a shorter form with an abbreviated month (e.g. "24 Sep 2026" instead of "24 September 2026") for pass template fields too narrow for the long date. An event's wallet pass now also sets PassCreator's Lock Screen relevance date whenever Apple Wallet is enabled and the event has a start time, independent of the separate Apple Wallet semantic tags opt-in.

### Changed

- The "Confirm check-in" button on the Check-in screen always uses Admitto's own blue, regardless of the organisation's branding accent color - a branded accent in red or orange read as an error state on this specific button.
- Attendee Overview's two-column layout is now a literal 50/50 split.
- The Two-factor coverage stat on Users & roles no longer counts staff who sign in through an identity provider as "missing 2FA" - two-factor for those accounts is the identity provider's responsibility, not something Admitto enforces.
- The public ticket page's date, time, and venue now read as a proper stat layout - "Date" and "Time" as labeled columns side by side with a divider between them, and the venue address on its own line below with a pin icon - instead of three stacked icon-and-text rows. The previous layout also had a real bug: the pin icon could drift away from a venue address that wrapped onto a second line, growing worse the longer the venue name was. Date and time no longer need an icon at all, and the venue's pin icon now stays at a fixed, consistent gap from the address regardless of its length.
- Wallet pass's `event_hours` field mapping now reads exactly like the public ticket page: a spaced hyphen between start and end ("9:00 am - 6:00 pm" instead of "9:00am-6:00pm"), the event's timezone abbreviation appended, and an open-ended "from"/"until" instead of being omitted entirely when only one of start/end is set on the event.
- Ticket confirmation emails' `{{event_date}}` and `{{event_hours}}` placeholders now match the public ticket page's format - the event's own regional date/time convention with its timezone abbreviation (e.g. "21 August 2026", "10:00 am - 6:05 pm IST") - instead of a fixed ISO date and 24-hour time with no timezone shown, regardless of where the event actually takes place.

### Fixed

- Unlinking SSO from My Account now also removes a linked Cloudflare Access identity, instead of leaving it behind without its underlying sign-in method. Previously this silently broke every later Cloudflare-authenticated request for that account.
- Wallet registration webhooks from PassCreator (device add/remove events) are no longer silently rejected. Two separate bugs each broke every delivery in a different way: Admitto was reading PassCreator's public-key response with the wrong field name (so the key could never be fetched at all), and signature verification was using the wrong hash algorithm (so a fetched key still couldn't validate a genuine delivery). No wallet registration status ever updated from a live device, and PassCreator kept retrying every delivery for over a day. Also fixed: some Android Wallet variants (`Android`, `AndroidWalletPasses`, `AndroidWalletUnion`, not just `AndroidGooglePay`) were silently ignored instead of updating Google registration counts. Wallet status now updates correctly when an attendee adds or removes their pass from Apple or Google Wallet.
- Voiding a pass directly in PassCreator's own dashboard (bypassing Admitto) is now reflected on the attendee's Wallet status. This never worked before: PassCreator's void-notification webhook doesn't say which event fired or carry any voided flag in its payload, so it was structurally indistinguishable from every other wallet event and was always ignored. It now gets its own separate webhook subscription so Admitto can tell the two apart. PassCreator has no equivalent restore/un-void webhook event, so a pass restored directly in PassCreator's dashboard still isn't reflected automatically - Admitto's own restore action is unaffected.
- Organisation Settings → Archiving and My account → Active sessions: their tables now span the full width of their card, matching every other table in the app. A leftover negative-margin/padding pair silently canceled itself out, so the table never actually reached the card's edge.
- The Audit log now keeps the deleted event's real name in "Deleted event …" entries instead of falling back to the generic label once the event itself no longer exists to look the name up from.
- A staff account's display name, when unset, now shows their email address in the top-right account menu instead of just the part of the email before the @ sign.
- Activity log and attendee Notes now show a staff member's email when they have no display name set, instead of a generic label ("Admin", which wrongly implied a specific role) or skipping straight past the email to that same generic fallback.
- Note author badges (Attendee detail → Notes) now use the same role name and color as everywhere else in the app ("Superadmin"/"Administrator"/"Operator"), instead of an unrelated two-letter code ("SA"/"AD"/"OP").
- Requirements' Add/Edit item and Add/Edit custom field modals no longer shift their form width when the scrollbar appears or disappears - their content almost always needs to scroll, so the space for it is now reserved up front instead of toggling in and out.
- Check-in and note timestamps now show in the viewer's own browser timezone rather than the event's, and a note added on an earlier day now shows which day, not just a time.
- Security logs' "2FA verified" rows now get the same "your local time" icon as "Login succeeded" rows when the browser reported a timezone, instead of always falling back to the generic device icon.
- Several small layout fixes on Check-in, Users & roles, My account, Organisation settings → Identity/Mail, and Attendee delivery history: text no longer wraps awkwardly in status chips or company/department names, modal scrollbars behave consistently and no longer shift content when they appear, a Redirect URI field's copy control now sits inside the field, and a couple of redundant or misaligned hint lines were removed or straightened out.
- Ticket page event hours now show the event's own timezone abbreviation next to the time (e.g. "10:00 am - 6:05 pm IST"), always use lowercase am/pm instead of varying between "AM" and "am" depending on the event's country, and join the start and end time with a spaced hyphen instead of a tight dash.
- Initial setup and change-password screens: the password strength meter no longer sits almost on top of the "Confirm password" field once it appears. It now takes up real space below the password field, the same standard gap used between every other field on the form, instead of floating on an overlay a couple of pixels above the next label.

## [0.5.3] - 2026-08-18

### Added

- Mail templates now support two more placeholders: `{{ticket_type}}` (the attendee's ticket type label) and `{{event_hours}}` (the event's start-end time, if set in Event settings). Both were already available on wallet passes but missing from the Communication tab's template editor.
- Attendee detail's "More actions" menu now has a "Copy ticket link" action for admins and superadmins, which copies the attendee's existing ticket URL to the clipboard. Previously the only way to get that link was to resend the ticket email to yourself. The raw ticket token is still never exposed as attendee data - it's decrypted server-side only for this action, the same way the existing wallet-pass link actions already work, and each copy is recorded in the attendee's action log.

### Fixed

- An attendee's Wallet status now shows "Added" only once PassCreator confirms the pass was actually registered on an Apple or Google Wallet device. Previously it showed "Added" as soon as the attendee opened the "Add to Wallet" link, even if they backed out of the install prompt and never actually added it - it now shows "Sent" until a real device registration is confirmed.
- Selecting attendees on the Attendees list and clicking "Send tickets" (single or bulk) no longer silently skips anyone who already received a ticket, reporting "No tickets were queued" with nothing actually sent. It now resends to whoever already has a ticket while still sending a first ticket to anyone who doesn't, correctly recorded in the delivery log either way.
- The admin panel's Check-in tab now works for staff who sign in only through Cloudflare Access, not just staff with a local Admitto password. Previously it showed a "sign in to Admitto" notice and blocked live scanning entirely for Cloudflare-only sign-ins.
- Signing in with a local password (or directly through your identity provider, not Cloudflare Access) no longer gets stuck after the two-factor code when the admin panel is one of the paths Cloudflare Access protects - it now lands on the check-in surface instead, which every admin and superadmin can already use once at least one event exists. It falls back once more, to My account, on a brand new instance with no events yet.
- Pressing and holding a searchable dropdown's own caption (e.g. Attendance, Ticket type, Event timezone) while it was open inside a modal no longer closes it the instant you press down, then reopens it the instant you release. Clicking near the caption briefly moved keyboard focus to the surrounding modal window itself, which every one of these dropdowns mistook for "focus moved to something else" and closed for.
- The Apple Wallet and Google Wallet buttons inserted into email templates now show up correctly in Outlook. Classic Outlook desktop doesn't render SVG images at all in mail bodies, so the badge graphic was silently missing for anyone reading their ticket confirmation there; it's now a PNG in email while the public ticket page keeps the sharper SVG version.
- The Send test email result in Event/Organisation Settings → Mail no longer shows the bounce-detection message pressed directly against the details above it, with no visible gap.
- Sending an attendee's first ticket from two staff actions at the same time no longer sends two copies of the email. The delivery log already kept one ticket, but the second send could reach the mail provider before the duplicate was rejected.

## [0.5.2] - 2026-08-16

### Fixed

- Signing in to the admin panel through Cloudflare Access no longer causes repeated "write conflict or a deadlock" errors in server logs on every page load. A page load fires many API requests at once, and each one was independently re-resolving and re-writing the signed-in identity to the database; a short-lived cache now resolves it once per Cloudflare-issued token instead, with no change to how quickly a revoked token or account stops working.
- Being denied access to the admin panel or check-in panel (an unlinked Cloudflare Access sign-in, no admin role, no check-in access) now shows the same branded error page already used for a broken link or a server error, with a plain-language message explaining what happened, instead of the bare word "Forbidden."

## [0.5.1] - 2026-08-15

### Security

- Account and two-factor management endpoints (change password, reset two-factor, remove single sign-on, etc.) no longer share their request throttle with the public sign-in page. Previously, a burst of a few dozen requests against those endpoints - even without a valid session - could exhaust the shared limit and lock every user behind the same office or VPN connection out of signing in. Re-entering your current password to confirm a sensitive change (password change, two-factor reset, removing single sign-on) is now also throttled per account rather than only by network address, so repeatedly guessing a password from different addresses is caught instead of slipping through.
- Users & roles: resetting another superadmin's two-factor authentication or password now requires the acting superadmin to confirm with their own authenticator code first, and is recorded distinctly in the audit log. Previously any superadmin could reset another superadmin's 2FA or password with no extra confirmation and no way to tell it apart from an ordinary staff reset in the audit trail, so a compromised superadmin session could be used to quietly take over every other superadmin account. Resetting your own account is unaffected. An acting superadmin who has never set up their own authenticator app (for example a superadmin role granted purely through single sign-on) is now denied this specific action outright instead of the check being silently skipped. The confirmation step is also now required unconditionally for this specific action, regardless of the instance's configurable "which roles require two-factor" setting - previously, an instance that had scoped that setting away from superadmin could still let the check be silently skipped even for an actor with two-factor already set up.
- Users & roles: the check that blocks resetting two-factor authentication or a password for an SSO-managed account is now applied at the exact moment the reset is written, closing a narrow timing window where linking single sign-on at the same moment as an admin's reset could still leave a local password or two-factor method silently in place.
- A break-glass emergency or backup recovery code is no longer consumed when two-factor sign-in fails to complete right after the code was entered correctly (for example, the partial sign-in session expired or was signed out from elsewhere in that instant) - the code stays valid for a retry instead of a locked-out user silently losing their one working recovery code for nothing. This kind of failure is also now recorded in the security audit log so it can be investigated after the fact.
- Superadmins reviewing the security audit log now get an aggregated alert after repeated incorrect two-factor codes against an admin or superadmin account, the same way repeated wrong-password attempts already trigger one. Previously, someone who already had a valid password for a privileged account could try two-factor codes indefinitely without ever tripping that alert.
- Signing in with the correct password to a deactivated staff account now takes the same amount of time, and is recorded distinctly in the security audit log, from a plain wrong-password attempt. Previously the deactivated-account case responded faster, which could let someone testing a leaked password/email pair infer from response speed alone that the password was still correct.
- Regenerating a superadmin's emergency recovery code is now an all-or-nothing operation, matching how backup recovery codes are already regenerated - an interruption partway through can no longer leave the account with no active emergency code.
- "Remember this device" (MFA-skip) cookies are now bound to the IP address recorded when you checked the box. A cookie used later from a different network is no longer accepted silently - it falls back to asking for your two-factor code again, so a copied or stolen cookie can't skip MFA from an attacker's own network. Browser User-Agent alone is no longer enough on its own to vouch for a device (it's a value the browser sends and any HTTP client can copy or guess), so it's recorded for context but no longer decides whether a cookie is trusted.
- The break-glass `bootstrap-superadmin` CLI command now records a dedicated "Superadmin created (bootstrap)" entry in the security audit log, shown as its own event in Organisation Settings → Logs → Recent Activity rather than folded into the generic "2FA break-glass override" label the other break-glass commands use, since creating a new superadmin is a materially different, more significant action. That record is now written atomically with the account itself - a failure to persist the audit row rolls back the account and role creation too, rather than the write being silently swallowed and the account created anyway - so a superadmin can no longer end up with no audit trail. It also now rejects `--password` on the command line (previously only the space-separated form was blocked, not `--password=<value>`), checked before any other prompt or database lookup, so an operator's password can no longer end up in shell history or the process list when running any of these break-glass commands.

### Added

- Bulk-changing ticket type from the Attendees list now also pushes the new type to every affected attendee's already-issued wallet pass in the background, with a toast reporting how many were updated once it finishes. Previously this only updated Admitto's own records; a wallet pass kept showing the old ticket type until someone manually clicked Push updates.
- Event settings → Location changes (venue name, address, coordinates, directions/accessibility notes) are now also pushed in the background to every already-issued active wallet pass for that event. Previously only name/date/timezone/event-hours changes triggered this, so a venue or address change silently drifted out of sync with already-issued passes.
- Editing an attendee's name, email, company, department, or ticket type now also pushes the change to their already-issued wallet pass, the same way a bulk ticket type change already does. Event settings → Wallet has a new Wallet push history list showing recent bulk ticket type pushes for the event.
- Event settings → Wallet's "Wallet push history" list now shows a Scope column (how many attendees, or the whole event plus which location/settings save triggered it) and supports pagination instead of always showing only the most recent rows. Its Date column now shows when the push actually ran, in UTC with the triggering admin's own local time underneath, instead of the event venue's timezone (which had no relation to when the background job executed).
- Event settings → Wallet has a new "Semantic tags" switch under Apple Wallet, off by default. When enabled, issued Apple Wallet passes include event name, date/time, venue location, and entrance directions as Apple's own semantic tags, which power Siri Suggestions, Maps, and Calendar smart surfacing. No NFC or PassCreator account approval needed, and it has no effect on Google Wallet passes. Toggling it also refreshes already-issued Apple Wallet passes.
- Event settings → Images: uploaded images can now be re-cropped after the fact. A new Edit button on each image in "Your images" reopens the crop tool on the original, uncropped file with the previous framing restored, matching the logo upload's existing re-crop capability.
- Communication now has a **Wallets** tab: compose a short message and push it to attendees' already-installed Apple Wallet or Google Wallet passes as a lock-screen notification, with the same recipient-filtering and count-before-you-send pattern as the existing mail Send tab. Recipient options are limited to attendees who currently have an active wallet pass (all such attendees, by ticket type, or specific attendees).
- The public ticket page and wallet pass now show the event's date and hours in the format attendees from that country actually expect - for example a US event shows "September 24, 2026" and "9:00 AM-6:00 PM" instead of always using the day/month/year, 24-hour style. This is based on the event's own address (Location tab); events with no address set, or an address in a country the app doesn't recognize, are unaffected and keep today's format.

### Changed

- Attendee export/import and mail sending now start almost immediately after you trigger them, instead of waiting up to a minute for the background worker's next scheduled check.
- Event settings → Ticket types now uses the same explicit Save/Reset pattern as every other settings tab, instead of saving each name/color edit or new type immediately with no Save button. Deleting a type is unchanged - it still removes immediately once you confirm.

### Fixed

- Apple Wallet passes with Semantic tags enabled could show the wrong event start/end time and duration for an event whose hours fall on the same calendar day a daylight saving time change happens in its own timezone, for zones that aren't UTC or GMT-based. A US event, for example, could show a 2-hour event as 1 hour or vice versa if it ran during the transition.
- Wiki documentation: every page's header (Audience / Required role / Feature status / Last verified) is now a small table instead of four blockquote lines, easier to scan at a glance.
- Wiki documentation: corrected several pages that had fallen out of date after recent feature changes - Wallet is now listed as a Superadmin-only tab (Roles and Permissions, Organisation Administration), the Ticket Types page no longer describes a "permanent link name" field removed from event creation, wallet badge/link descriptions in the email template docs no longer say they are unbuilt (they work once Wallet is configured), the weather chip description now reflects that it always shows Celsius, and Pass Statuses/Glossary/Help and Troubleshooting now cover the wallet-pass void/restore cascade. Also documents `MAIL_PRIVATE_DESTINATION_ALLOWLIST` for self-hosted mail servers, which previously had no Wiki coverage.
- Organisation settings → Security and Mail: the session-lifetime/timeout number fields and the SMTP/Graph/Power Automate/wallet secret fields now have a stable `id`, so browser password managers and accessibility tools can associate each field with its label instead of treating it as anonymous.
- CI's secret-scan job no longer fails a pull request over commits from unrelated branches. It scanned the full history of every branch in the repository (gitleaks' default behavior once history is fetched), so any PR would fail if any other open branch happened to contain something gitleaks flagged, regardless of that PR's own changes. The scan is now scoped to just the commits a given PR or push actually introduces.
- The small map on the public ticket page and its "© OpenStreetMap contributors" credit could render as blank boxes instead of readable text in the packaged app image, because the container had no fonts installed at all for the server-side map renderer to draw with.
- Event settings → Wallet: registering the PassCreator webhook subscriptions on save no longer logs a false failure and falls back to re-subscribing unconditionally on every save. PassCreator's hook endpoints return success without matching the response shape used elsewhere in its API, so a working subscription was being misread as an error.
- Wallet pass registration status (Registered/Unregistered on the Attendees list and Attendee Detail) now updates correctly from PassCreator's webhook deliveries. The delivered payload's device-registration fields don't match the shape assumed during development, so live updates were silently ignored in favor of the slower periodic background refresh.
- Attendee Detail → Delivery history: on narrow screens, a long subject or recipient address could squeeze the row down until the message text disappeared entirely, or overlap the timestamp, instead of cleanly wrapping the timestamp onto its own line underneath.
- My account: closing the Unlink SSO dialog after it fails because a role is managed by your identity provider, or because there's no password or two-factor code to verify you with, no longer leaves the password fields holding what you typed if you reopen it. The Password and Two-factor authentication cards also show a clearer placeholder with an icon for sign-in-only accounts, matching the empty-state style used elsewhere, instead of a single line of text.
- Settings → Health could show the background worker as unresponsive during a large attendee import, export, or wallet pass push, even though it was still actively working - the worker's liveness signal was only refreshed before and after one of those runs, not while it was still in progress.
- Attendee exports (PDF, CSV, and XLSX) now show a readable check-in status ("Checked in" / "Not checked in") instead of the raw "admitted"/"not_admitted" database value. The PDF export additionally no longer cuts off long email addresses with "...", or squeezes every column down once several custom fields are added: column widths are now measured from the real data on every export instead of guessed, long values wrap onto extra lines instead of being truncated, and the page automatically switches to a larger paper size only on the rare export with enough custom fields that even wrapped text wouldn't otherwise fit.
- Save buttons across Event settings, Organisation settings, and attendee/requirements/communication edit forms stayed clickable with nothing to save, instead of greying out until an actual change was made.
- Event settings → Danger zone: the Delete event button could keep showing a stale "can't delete yet" state after clearing the event's last blocking ticket type or editing a ticket type's color/label - it was only ever refreshed on page load, not after that change.
- Event settings → Wallet: field mapping rows overlapped and truncated on narrow screens; the field name and its mapped value now stack onto two readable lines instead of squeezing four columns into one.
- Communication → Delivery log looked cramped on narrow screens; its header actions now wrap onto a second line instead of forcing everything into one.
- Requirements page's Documentation button now matches the same compact mobile sizing as every other page's, instead of staying full-size with its icon.
- Attendees list: on narrow screens, each attendee's Pass/Attendance/Mail status badges are now labeled, so it's clear what each one refers to - previously that context only existed in the desktop table's column headers.

## [0.5.0] - 2026-08-13

### Added

- My account: staff can choose 12-hour (AM/PM), 24-hour, or browser-default time input independently from their regional date format.
- **My account: passkeys and security keys.** Staff can now register passkeys (Face ID, Windows Hello, and similar) and security keys (for example a YubiKey) as extra two-factor methods alongside an authenticator app. Each one is given a name so multiple keys can be told apart, and there is no limit on how many can be registered. Setting up, resetting, or adding a two-factor method now opens in a popup instead of expanding inline on the page. Registering a passkey or security key stays available to inspect or remove even if an administrator later turns passkeys/security keys off for the instance — only adding a new one is affected. If it's the account's first-ever confirmed two-factor method, its 10 backup codes are shown once in the same popup and must be saved before it can be closed, the same as first-time authenticator app setup.
- **My account: backup codes.** A new Backup codes row in Two-factor authentication shows how many of your codes are still unused (for example "7 of 10 remaining"). Regenerate invalidates the current batch and issues a fresh set of 10 codes, shown once as plain text — the same one-time reveal used during initial setup.
- **Add to Apple Wallet / Google Wallet.** The wallet badges on the public ticket page are now live — tapping one creates (or reuses) the attendee's wallet pass and opens it directly, without ever landing on a PassCreator-hosted page. If creation fails, the ticket page shows a retry notice instead of a broken redirect.
- **Wallet settings in the admin UI.** Event settings → Wallet (superadmin-only) now has a real PassCreator API key and Template ID field, both specific to that event, so a leaked or rotated key only ever affects one event, not the whole instance (instead of the roadmap placeholder). A header switch turns the whole feature on or off for the event; independent Apple Wallet / Google Wallet switches disable one platform without clearing the other's configuration. Test connection checks the API key and template against PassCreator before saving. Field mapping controls which PassCreator field key receives which attendee/event value — nothing beyond the QR code is sent until it's mapped, since PassCreator templates don't share a common set of field names. Admins can map attendee name (full or first/last), email, company, department, event name/date/hours/location, ticket type, the ticket/QR value (for templates whose barcode isn't bound to it directly), directions and accessibility notes, individual address components, and Google/Apple Maps links. No env var restart needed to change any of it.
- **Event hours (start/end).** New Event and Event settings → Basic information now have an optional "Event hours" start/end time field, shown as a range on tickets and (later) wallet passes. Leave blank to omit.
- **Wallet pass management for staff.** Attendee Detail's Wallet card can void, restore, push updates, or permanently delete an attendee's wallet pass at the provider; the same void/push-updates/delete actions are also available in bulk from the Attendees list's selection menu. The Attendees table now shows a compact Wallet column — a highlighted icon per platform (Apple/Google) the attendee has actually added their pass to, muted otherwise — instead of the previous per-row view/revoke action icons, which duplicated the row's own menu.
- **Wallet pass registration status.** Whether an attendee has actually added a pass to their device (not just had one issued) is now tracked from PassCreator — shown as Registered, Unregistered, or Status unknown on the Attendee Detail Wallet card and the Attendees table's Wallet column. Kept current by a webhook PassCreator calls on registration/unregistration/void, backed by periodic polling as a fallback.
- Revoking an attendee's ticket now also voids their wallet pass, if they have one, so a revoked ticket doesn't stay usable at the gate through an old wallet install. Restoring the ticket restores the pass the same way.
- Event Settings changes to an event's name, date, timezone, or event hours are now pushed in the background to every already-issued wallet pass for that event, so passes stay in sync without staff needing to push updates manually.
- Organisation Settings → Security: superadmins can now allow specific third-party `https://` origins to run script, send data, and (on sign-in pages) render an embedded widget, for example an analytics/monitoring beacon like Cloudflare Web Analytics or a login challenge widget like Cloudflare Turnstile, without weakening the Content-Security-Policy for anything else.

### Changed

- **My account: two-factor authentication methods can now be managed independently.** The authenticator app's action is now **Manage** instead of **Reset**: **Remove** takes out only the authenticator app and leaves passkeys, security keys, and backup codes untouched; **Reset everything** remains available from the card's own options menu for clearing all of them at once.

### Fixed
- Public ticket page: the browser tab, bookmarks, and home-screen shortcuts now show the Admitto icon on the ticket page and its not-found/error state, instead of a blank or default icon. The shared favicon markup was never wired into this page's HTML template.
- The Admitto mark's checkmark had a hidden default black fill baked in on top of its white stroke (a missing `fill="none"` on the SVG path), invisible at normal browser-tab size but visible as a black wedge on the larger iOS "Add to Home Screen" icon. The `apple-touch-icon.png` is also now flattened onto an opaque background instead of keeping transparent corners, since iOS applies its own rounded mask and can render transparency as solid black.
- Event Settings → Ticket types: adding a new type now creates it with the name you actually type, so its internal key derives from that name instead of always starting from the throwaway "New type" placeholder shown before the first click. The attendee Activity log's ticket type field also now shows the type's current name in its before/after diff instead of that frozen internal key.
- Instance Settings → Mail and an event's Mailing settings: when a stored SMTP password, Graph client secret, or Power Automate key can no longer be decrypted (for example after `ENCRYPTION_KEY` changes), the Test and Verify connection actions now show a clear message asking the admin to re-enter and save the credential, instead of a generic "Something went wrong" error. System logs now record `mail_secret_decryption_failed` instead of a bare unhandled exception. Sending or resending tickets, retrying a failed delivery, Organisation Settings → Health check, and an event's "Verify bounce" check now surface the same clear message instead of a generic failure or an opaque retry with no recorded reason.
- Communication → Templates: on phones, the selected template name is no longer covered by its status badge; the last-edited date is available from the Edit template control. **Delete event** now permits an otherwise-empty event whose only saved mail template is its non-deletable default Ticket email override; additional custom templates still block deletion.
- Organisation Settings → Health check: the mobile **More actions** menu now stays compact instead of expanding to fit its longest description.
- Organisation Settings → Logs: on iPhone browsers, opening Filters or typing a date no longer leaves the page or the calendar clipped behind the software keyboard. Filter and option panels now stay within the visible screen and scroll when necessary.
- Timezone selection now uses one global IANA timezone catalogue with legacy aliases folded into their preferred current names. Map suggestions, event saves, and the picker consistently use one entry, for example, `Asia/Calcutta` is accepted but shown and saved as `Asia/Kolkata`.
- My account: an account signed in only through an identity provider now correctly shows "Password is managed by your identity provider" and no longer asks for a current password it can never have. Unlinking SSO on such an account now fails with a clear message asking you to contact an administrator, instead of endlessly rejecting a password that doesn't exist. Existing accounts in this state are corrected automatically on upgrade.
- Organisation Settings → Identity → group mapping: Scope is no longer a separate choice — it now always matches the selected role (Superadmin → instance, Admin → organization, Operator → event), the same pairing already used everywhere else roles are granted. Existing mappings saved with a mismatched pair are corrected automatically the next time the provider is opened. The mapping row also no longer wraps unevenly onto two lines when the Organization/Event ID field appears.
- Organisation Settings → Identity → group mapping: the Organization/Event field is now a searchable picker showing real names instead of a raw ID with nothing to guide it, so a mistyped value can no longer save a mapping that could never match a real user's grant. The editor is wider so the mapping row has room to breathe, and on narrow screens it now packs two fields per line instead of stacking every field onto its own row.
- Organisation Settings → Identity → provider editor: every field now has a short inline hint, including an explicit warning that Issuer URL must be the bare URL, not the `/.well-known/openid-configuration` discovery document some providers show you. Pasting the full discovery URL there (directly, or via **Discover**) is now corrected automatically instead of silently breaking sign-in later or 404ing.
- Add to Apple Wallet / Google Wallet: the pass now carries the same QR code as the attendee's ticket page, so scanning it at check-in resolves to the right attendee. Previously the pass fell back to PassCreator's own internal identifier, which check-in could not match.
- Wallet pass creation/update, Microsoft Graph mail sending, and MET Norway weather lookups now ask the provider not to compress responses, working around a process-wide bug where an unrelated `undici` import elsewhere in the same process can silently corrupt automatic gzip decompression on HTTP/2 connections so the response reports success but its body and headers arrive unusable.

### Security
- Cloudflare Access staff sign-ins now bind only to an existing direct OIDC identity through a forwarded immutable subject, reconcile that provider's managed group roles on every edge sign-in, and fail closed when a required role claim is unavailable. Enabling it requires selecting an enabled direct identity provider.
- Users & roles: **Reset password** and **Reset two-factor** are now disabled for staff accounts signed in through an identity provider, in both the menu and the API, since resetting a password on an SSO-managed account previously created a working local sign-in path alongside the identity provider link with no warning shown.
- **Log out now also ends the session at the identity provider**, when it advertises a logout endpoint via discovery, instead of only clearing the local Admitto session. Previously the identity provider's session (and any other application sharing it) stayed signed in, so a fresh SSO login could silently succeed without re-authenticating. Existing OIDC providers pick this up the next time **Discover** is run.
- Static map tile fetching (the map image on tickets and mail) now re-resolves and pins the connection to a freshly validated address for every request and every redirect hop, closing the same DNS-rebinding gap already fixed for weather and address lookup.
- The instance now publishes a `robots.txt`, and every public page (ticket, QR code, event map, branding assets, staff sign-in) sends `X-Robots-Tag: noindex, nofollow`, so search engines and AI crawlers that respect these signals no longer index attendee ticket links or scan QR codes into image search. `robots.txt` allows crawling on purpose — a blanket disallow would stop crawlers from ever fetching a page and seeing its `noindex` header, so a URL indexed before this change could never be removed.

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
