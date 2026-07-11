# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Check-in — desktop attendee card: item list is now labeled and shows each item's description:** The **Badge / gift bag / headset** rows under Confirm check-in previously had no heading and no description — just an icon, a label, and an action link, easy to read as inert status text rather than something the operator needs to act on (Jadzia/PO review). The list now has an **"Items to hand out"** section label (same small-caps style as the Notes section) and, when configured on the Requirements page, each item's admin-written description directly beneath its row — matching what the mobile check-in overlay's item-issuing screen already shows. PO review, round 2: the item icon is now centered against the label-and-description pair as a whole (previously only against the label line) and a touch larger (16→20px) so it reads as its own element rather than disappearing next to two lines of text. The action link ("Issue badge") is now a real green button reading **"Mark badge issued"** / **"Mark gift bag given"** — the operator is confirming a hand-over that already happened, not instructing the system to perform one, so the button should read as an attestation rather than a description of an automated action (Jadzia review); this label is shared with the mobile item-issuing screen, so the wording changed there too. PO review, round 3: the button's visible text is now just **"Mark issued"** / **"Mark given"** — the item name it used to repeat is already the row label right next to it (desktop) or the heading above it (mobile), and repeating it made the button too wide; the full "Mark badge issued" / "Mark gift bag given" phrasing lives on as the button's `aria-label` so screen readers navigating by button list still get the item name. The button is now also centered against the label-and-description pair as a unit, same treatment as the icon. The Confirm-check-in screen's second, block-width **Clear** button directly under Confirm check-in — visually competing with it — is gone; Clear now lives only as the small ghost button next to Add note, the same place it already appears on every other card state. PO review, round 4: the card's status badge (Ready to check in / Already checked in / Revoked / Invalid ticket) is now **one consistent treatment for every status** — right-aligned in the head, centered against the name+ticket-type pair, no leading dot — instead of a dotted badge shown inline only for the positive (ready/valid) states plus a separate full-width colored bar duplicating the same text for every other state. The bar is gone; a revoked/invalid ticket's reason (e.g. "Ticket is not admittable") now reads as a plain line under the head instead of a tinted banner repeating the status title first. PO review, round 5: that reason line is gone too — the badge already reads "Revoked" / "Invalid ticket", so repeating "Ticket is not admittable (cancelled or revoked)." underneath it was redundant.
- **Settings → General: new "Organisation branding" card:** Superadmins can now update the organisation name and logo after completing the setup wizard, without redoing it — a new card in Settings → General reuses the wizard's existing logo upload and org-branding API. The existing instance-theme `BrandingPanel`'s hint now points to the new card instead of the setup wizard (#396).
- **Requirements — Event items: select-type options textarea accepts Enter for new lines:** The options textarea for select-type attendee data fields now correctly preserves newlines when typing — pressing Enter adds a new option line. Options are stored one-per-line and displayed one-per-line in the editor; existing comma-separated options in the database are still loaded correctly.
- **Requirements — Event items are empty by default, except "Badge":** New events no longer auto-seed giftbag / headset — operators add them manually via **+ Add item** in Requirements (#367, #368). The **"Badge"** item is still auto-created for every new event, and lazily backfilled for legacy events missing it (as soon as their Requirements list is opened, or on their first check-in): the "Issue badge at entry" behaviour toggle is hard-wired to an item with key `badge`, so without it the toggle would be a no-op with no way to enable it from the UI. Legacy events keep their other existing rows unchanged; the delete guard now applies only to the "Badge" item (other items are deletable when no issued/returned states exist).
- **Requirements — "Badge" item can't be deleted, only disabled:** Deleting it used to silently "succeed" and then reappear with blank fields on the next Requirements load (the backfill immediately recreated it) — confusing, with no error shown. The **Delete item** button is now disabled for "Badge" with a tooltip explaining it's a default item; the API also rejects the delete (`409 default_item`) as a server-side backstop. To remove Badge from check-in, turn its **Active** toggle off instead — doing so automatically turns off **"Issue badge at entry"** in Event behaviour too, so the two settings can't drift out of sync (#367 follow-up).
- **Requirements — "Issue badge at entry" toggle now stays in sync when Badge is disabled:** Previously the toggle could stay ON (with only a passive warning banner) after the "Badge" item itself was turned off, which was confusing — nothing was actually happening. The toggle is now disabled with an explanatory tooltip whenever "Badge" is inactive, so it can't be switched on until "Badge" is re-enabled; the API enforces the same rule server-side (`409 badge_item_inactive`). Also fixed a clipping bug where hover tooltips inside the item edit modal (e.g. on the disabled Delete button) could spill past the modal's rounded right edge and get cut off — tooltips now grow leftward from their anchor instead of centering (#367 follow-up).
- **Requirements — Badge sync + tooltip readability, round 2:** The "Issue badge at entry" toggle is now also disabled (with tooltip) when the Badge item has **"Issue on check-in"** turned off, not just when it's fully disabled — previously that combination left a dead toggle with no visual cue. The disabled toggle itself is now visibly greyed out (track and label dim to the disabled color) instead of staying fully colored while non-interactive — the passive orange warning banner underneath is removed, since the toggle's own disabled state now explains itself. Fixed a readability bug where disabled-button tooltips (e.g. Delete on the Badge item) rendered with a washed-out, low-contrast background — disabled elements dim their entire subtree via `opacity`, which was also fading the tooltip's dark background; tooltips on disabled controls are now hosted on a non-disabled wrapper so they keep full contrast (#367 follow-up).
- **Requirements — Event items list confirms Active toggle with a toast:** Turning an item's **Active** switch on/off in the Event items table previously changed silently with no confirmation that it saved — now shows a "Item enabled — saved" / "Item disabled — saved" toast, matching the existing confirmation pattern used for Event behaviour toggles (#367 follow-up).
- **Requirements — Event items list shows item icons:** The item name column in the Event items table now displays the item's tabler icon alongside its label and key (#370).
- **Requirements — Event behaviour copy and spacing:** Each behaviour toggle row has more vertical padding (space-4) and clearer subtitle copy: "Issue badge at entry", "Require confirmation on scan", "Allow manual lookup", "Auto-advance after valid check-in" (#369).
- **Requirements — Edit item: centered modal instead of side drawer:** The edit/delete panel for an event item now opens as a centered overlay modal (with backdrop and focus trap) instead of a right-side drawer, matching the AddAttendee modal pattern. Attempting to delete an item that is in use now triggers a toast warning instead of an inline banner. Delete confirmation dialog now correctly renders above the modal overlay (z-index fix: modal 200 < ConfirmDialog 300). All API-level errors (save and delete) fire toast notifications; inline error is reserved for client-side validation only (#371).
- **Requirements — Attendee data field row polish:** "Required" checkbox now sits on the same line as the "Display label" caption (previously a separate row, misaligned with the label text); the row's remove-row icon button is compact-sized to match; the label caption and its input are grouped with tight spacing so the row no longer has an oversized gap before the input. Field type picker icons (Text/Select/Boolean) show a tooltip on hover — a hover-only `overflow: hidden` on the button group was silently clipping the tooltip. Event item description column in the Requirements list is wider (46%) and wraps up to 2 lines with ellipsis instead of truncating to a single line (#371).
- **Requirements — "Issue badge at entry" also stays in sync when only "Issue on check-in" is turned off:** The ops-config toggle previously only auto-flipped off when the Badge item itself was disabled; turning off just its "Issue on check-in" setting (Badge staying Active) left `badge_at_entry` stuck `true` in the database even though the UI already showed the toggle as unusable — reproducing the exact drift this feature exists to prevent. Also closed a race where enabling "Issue badge at entry" and disabling Badge at nearly the same time could leave the two inconsistent — the check and the write now happen inside one Serializable transaction. `ensureBadgeEventItem` now checks for an existing row before writing, instead of attempting a write on every Requirements load and check-in.
- **Requirements — Event items table: headers restored, Active toggle guards against double-submission:** The Item / Description / Active column headers, dropped during the modal rework, are back. Rapid double-clicking an item's Active switch no longer fires two overlapping save requests.
- **Requirements — Add item modal: focus trap, Escape-to-close, and inline validation:** The "Add item" modal now traps focus and closes on Escape like every other modal in the app. The item-name and contents-row validation errors (client-side only) show inline again instead of as a toast, matching the toast-vs-inline convention (AGENTS.md); server-side errors (name conflicts, save/delete failures) remain toasts. Disabled controls that explain themselves via tooltip (Issue badge at entry, Delete item) now also expose that text to screen readers via `aria-describedby`.
- **Requirements — badge_at_entry sync gap for events that drifted before the sync existed, plus review-round polish:** Disabling the badge item on an event where `badge_at_entry` was already stuck `true` from before this sync landed (e.g. because only "Issue on check-in" had drifted it, not the Active toggle) now correctly re-syncs it — the previous fix only re-synced on a fresh usable→unusable transition, missing already-drifted events. The "is the badge item usable" rule now lives in one shared `isBadgeItemUsable()` (`@admitto/tickets`), used by both the admin API and the Requirements page instead of three independent copies. The Add item name and contents-row inline errors now clear as soon as the user edits the field (previously stuck until the next submit) and are announced to screen readers (`role="alert"`, `aria-describedby`/`aria-invalid`), matching the pattern already used elsewhere (My account). The per-item Active-toggle double-submit guard is now a shared `useInFlightIds()` hook, also adopted by the Identity providers list. `PATCH /ops-config` retries on a Postgres serialization conflict (concurrent badge-item/ops-config writes) instead of surfacing it as a 500.
- Admin check-in header no longer repeats the event title/date/location already shown in the sidebar — the subtitle now describes the screen's purpose ("Scan QR codes and admit guests on event day"). PO review: the server-connection indicator moved out of the page header entirely into the global topbar (`ServerConnectionBadge`, next to `Mailer: SMTP`) — the underlying connection heartbeat is app-wide, not check-in-specific, so it now reads the same everywhere; both it and `MailerStatusBadge` dropped their leading dot (#378).
- Check-in camera: the inline viewfinder (admin desktop and operator desktop) shrank from a full-width 4:3 hero to a QR-sized square (max 460px, matching the design-system mockup) instead of a mostly-empty video panel; the header/toolbar button now reads **Disable camera** while active instead of only offering an X on the video, and toggling it off from the header clears any displayed scan result so reopening the camera doesn't show a stale card. PO review: the camera box now hides entirely once a scan or manual-lookup result is showing (previously it sat there as an inert, empty viewfinder next to the result, competing for space with the typeahead dropdown) — it reappears once the card is dismissed. The attendee card's footer also gained a **Clear** button for states with no other way to dismiss the card (Already checked in, Revoked) — PREVIEW already has its own block-width Clear button, so the footer one is hidden there to avoid a duplicate (#381).
- Check-in sidebar aligned with the design-system mockup (`ci-*` reference): Recent scans rows use the mockup's three-column layout — status dot, name + ticket type on the left (ellipsized), status label + monospace time right-aligned — so the full date+time format for off-event-day scans (#359) no longer wraps into the name line; the list scrolls inside the card (`max-height: min(440px, 48vh)`) instead of growing the page; the header gets a separator; manual lookup is visually separated from the list with a top border; stats follow the mockup row (same-size number columns with labels beneath, percent flush right).
- Operator mobile camera overlay: **Recent scans is no longer hidden** on phones (≤768px) — it was unconditionally `display: none`, so an operator scanning on a phone had no way to see who'd just checked in. The camera frame now top-anchors instead of stretching to fill (and vertically centering in) the remaining screen height, matching the design-system kiosk mockup's stack order: camera → manual entry → recent scans (#432). PO review: header now uses the real Admitto brand mark (was an unstyled placeholder square) and drops the event name (was cramped onto one line with the check-in count and close button); manual entry starts as a small **Manual search** button instead of an underlined text link. Also fixed the camera hint text ("Point the camera at the attendee's QR") wrapping off-center on narrow frames — `left:50%` with no width constraint let the browser compute wrap width against only half the available space.
- Operator mobile camera overlay: the scan-result card is now a **full-color status card** (green/yellow/red background, 76px icon, matching the design-system kiosk mockup) instead of a dark translucent panel with only a tinted icon — mobile only, scoped so the desktop inline camera (which reuses the same result-panel component) is unaffected. "Confirm check-in" also switched from the standard blue button to white, which the blue clashed against on the new colored backgrounds (#430).
- Operator mobile camera overlay: **Manual search is now a full-screen, live-search view** (mockup `ManualSearch.jsx` parity) instead of a small expanding token-entry field. Typing 2+ characters searches by name/email/company/ticket type after a short pause (debounced, matching the desktop typeahead's timing) and lists matches with an avatar, name, company/ticket type, and a "checked in" marker for already-admitted attendees — matching the desktop typeahead exactly (name + meta, no separate action button). Tapping a row opens that attendee's card through the same pipeline as a QR scan — never a one-tap admit straight from the list; whether check-in then needs an explicit "Confirm check-in" tap on the card or admits straight away still follows the event's "Require confirmation on scan" setting. Pasting a long token (or pressing Enter on an exact query) still routes through the existing scan-bar pipeline. Respects the event's "Allow manual lookup" setting (#433).
- Operator mobile camera overlay: a successful check-in (fresh admit or an attendee found already checked in) now steps through any **badge / gift bag / headset items still to hand out**, one at a time — icon, item name, and an "Issue X"/"Return X" button, with Back and Skip to move without acting — instead of leaving a phone operator with no way to issue these items at all (they previously had to switch to a desktop). Skipping doesn't change the item's state — it's still there to action on the next scan or from desktop. A short summary screen follows the last item — "All items issued" only when everything genuinely was (a green checkmark there when items were actually skipped would be a false confirmation); otherwise "N item(s) skipped" with a neutral/warn tone and the same ✓ issued / – skipped list — with **Next scan** and, when this was a fresh admit on this device, **Undo last check-in**. The "Confirm check-in" card itself is unchanged; this step only appears afterward, on a bordered card (not a solid color fill, for readability with a list of items) rather than folded into the result card. "Auto-advance after valid check-in" no longer sweeps this step away before it renders — on the mobile overlay, that setting now defers to whether there's still an item to hand out; desktop's auto-advance behaviour is unchanged. Mobile only — the desktop inline camera keeps its existing item list on the separate attendee card. PO review, round 2: the step now renders inside the camera viewfinder's own frame instead of replacing the whole screen — Manual search and Recent scans stay visible below it exactly like during a normal scan. Every configured item gets a step, including one already auto-issued before this screen opened (e.g. Badge via "Issue badge at entry") — shown as an "Already issued — remember to hand it over" reminder with a **Next** button, so the operator still gets a physical prompt for it instead of it being silently excluded. Navigating Back to an item already resolved during this flow shows the same reminder instead of bouncing straight past it. The icon sits in a round tinted badge (reusing the same light-on-dark treatment as the attendee card's status icon) instead of bare on the dark background; the frame's corners are gently rounded, matching the camera viewfinder and the full-color result card so all three share one consistent shape; the action button is white to read cleanly against the border, and Back/Skip/Next are small chip buttons instead of plain text. PO review, round 3: fixed the summary screen showing a green checkmark and reading as a success confirmation even when every item had just been skipped — it now only shows "All items issued" with the green tone when everything was actually handed out; otherwise it reads "N item(s) skipped" with a neutral/warn tone instead. The step's background is a light card surface (the app's standard page tone — pure white glared against the dark overlay, and the earlier translucent tint read as an empty outlined box) with dark text/icons. Every screen of the flow (a step, or the summary) is one centered column — the same layout pattern the result card already uses for "Confirm check-in" — so the primary action button lands at the same position across items instead of drifting with the content above it; everything that varies between items (description, detail, the already-issued note) reserves a fixed height so it can't shift that position either. Each step now also shows the item's admin-configured **description** from the Requirements page (capped at 500 chars server-side, clamped to two lines in this view so a long text can't break the layout; the card API — including the item's `description` field — needed an actual rebuild of `@admitto/tickets`, not just a type-check, to reach the running server; that's now done), alongside the existing per-attendee detail line (e.g. "T-shirt size: L"). The "already issued, remember to hand it over" note is a plain subtitle line (matching the result card's own status subtitle, not a pill — the pill sat awkwardly against the button). The step's primary button is a softer green (`--status-ok-hover`) rather than the same vivid green as the check-in result background, and rather than white (glared against the now-light card background). Re-scanning an **already-checked-in** attendee no longer takes over the screen with the item flow — the standard "Already checked in" result card shows as before, with a small **Issue items** chip (only when something is still pending) that opens the flow on demand. That chip and **Cancel** (now a real button, not an underlined link, on mobile) always sit together in the same row on every result card, so Cancel's position doesn't move depending on whether Issue items is present. Also fixed the item action label for gift bag items showing the raw internal key ("Mark gift_bag issued") instead of "Give gift bag" — the label lookup checked for the key `giftbag`, but real event items are slugified with an underscore (`gift_bag`); this label is shared with desktop's attendee card, so it's corrected there too. PO review, round 4: the item-issuing card is now a top/bottom-anchored layout instead of a vertically centered stack — the icon sits at a fixed offset from the top (matching the icon's position and 76px size on the main "Confirm check-in"/"Already checked in" cards exactly) and the primary button at a fixed offset from the bottom, on every screen (a step, or the summary), regardless of how much content sits between them; previously both drifted because a centered stack's position depends on total content height, which varies per screen (extra progress/nav rows, a long description, a short vs. long summary list). The step-progress dots moved out of their own row (which either collided with the icon above it or shifted the button below it) into the existing Back/Skip row, laid out with `grid-template-columns: 1fr auto 1fr` so they stay exactly centered regardless of whether Back/Skip are present — flex `space-between` visibly shifted them depending on the two side buttons' widths. The item description now displays in full (previously clamped to 2 lines with the rest silently dropped) — the card scrolls internally if it doesn't fit, rather than truncating admin-configured text. The already-issued state is now the same compact `Badge` + `itemBadgeVariant` component `AttendeeCard.tsx` uses on desktop, not a full sentence ("remember to hand it over") that wrapped awkwardly at card width. Fixed a flicker where the summary screen briefly showed the orange "N item(s) skipped" tone before flipping to green "All items issued" — `onItemAction`'s API call resolves and updates the `items` prop a tick after the synchronous step advance, so the summary's first render saw stale data; a local optimistic mark (self-corrected if the call actually fails, detected via the `pending` prop settling with the item still showing as pending) removes the gap. The incomplete/skipped summary's background and primary button now also switch to the light-warn tone (previously only the border and icon did, leaving a green background under an orange border). The mobile "Confirm check-in"/"Already checked in" card's ticket-type text is now the same `TicketTypeBadge` component desktop's `AttendeeCard.tsx` uses (e.g. VIP → purple) instead of a plain, uncolored `<span>` — ticket-type coloring is sourced from one place, not redefined per surface; fixed that badge (and the person-card layout generally) rendering stretched to the card's full width from `.ck-overlay__result-card`'s default flex `align-items: stretch`, instead of hugging its own content. Fixed a recurring Chrome console error ("AbortError: the play() request was interrupted because the media was removed from the document") — the camera `<video>` element used to unmount whenever scanning paused (every scan result, every entry into the item-issuing screen), which could race ZXing's in-flight `video.play()`; the video now stays mounted and is hidden via the `hidden` attribute instead. Recent scans: the count badge now matches the actually-rendered rows instead of the raw fetch total (the mobile overlay renders 6 of the up-to-8 fetched entries, so the badge previously read "8" while only 6 rows were visible); timestamps show "Today HH:MM" / "Yesterday HH:MM" for admissions in the last two calendar days instead of a full date, more useful for a live feed than `formatAdmissionDisplay`'s "same as the event's calendar day" rule; each row also shows the operator's device label (`checked_in_at`'s `device_id`, e.g. "Entrance A" — set at login, optional) next to the ticket type, so scans from multiple simultaneous operators can be told apart. Code review pass before merge: item-action failures (e.g. a network blip while issuing a gift bag) previously showed no error at all on the mobile overlay — the only error surface rendered in a part of the page hidden behind the overlay's own full-screen layer; failures now show inline inside the overlay itself. "Auto-advance after valid check-in" could still sweep the item-issuing step away before the operator saw it when every configured item was already auto-issued (e.g. a single Badge item with "Issue badge at entry") — the auto-advance check now matches the item screen's own "has any items" rule instead of only checking for ones with a pending action. Manual search's Enter-submit (raw token / exact match) now closes the search screen once the check-in actually succeeds, and stays open with the inline error otherwise — it previously never closed on its own. Switching into Manual search no longer tears the camera's `<video>` out of the document (it's hidden instead, same fix as the earlier AbortError fix above, which only covered the other trigger paths). A fast double-tap on "Issue" or "Undo" no longer fires the request twice — neither button's disabled state was actually driven by whether that request was in flight. Navigating Back to an item marked done only by the optimistic local mark (server hasn't responded yet) now shows the action just taken ("Already issued") instead of the stale pre-action state ("Already pending"). Scrolling the mobile overlay to see recent scans below the fold could carry the header — and its only "Exit camera mode" button — off-screen; the header now stays pinned to the top of the scroll area. "Yesterday HH:MM" on recent-scans timestamps could resolve one day too far back in the ~1 hour window right after a spring-forward clock change, from computing "yesterday" as a fixed 24-hour subtraction instead of a genuine calendar-day-minus-one (#434).
- Unified instance-level admin sidebar (#323): `/account` uses the same sidebar chrome as `/admin` and instance settings instead of a stripped-down `AccountShell`; shared `InstanceSidebarFoot` adds All events (or Check-in for operators), Administration, My account, Documentation link, and app version; `BrandMark` extracted to a shared component. Event sidebar in `AdminShell` shows read-only title, date, and location (linked to Google Maps search).
- My account page (#324): Profile section redesigned — 2-column grid on desktop (editable fields left: display name + regional format; read-only right: email, sign-in method, roles); `<select>` replaced with `Select` from `@admitto/ui`; "Date format" label renamed to "Regional format" with updated hint; new read-only "Sign-in" row shows `Local password`, `Identity provider (SSO)`, or `Local password + Identity provider` based on `has_local_password` and `roles[].is_oidc`; 2FA status badge and action button are now on a single compact row; Password and Two-factor authentication are two independent Cards side by side in a CSS grid — both cards always stretch to the same height, and the 2FA card never grows taller than the Password card during enrollment; the "Set up authenticator" enrollment view shows the QR code in the left column and backup codes + TOTP input in the right column (6 individual digit boxes, auto-advance/backspace/paste, matching the MFA wizard style); backup codes grid is 2-column so all 10 codes fit without overflowing the card height; `DELETE /api/account/mfa/totp/enroll` endpoint added — the Cancel button calls it before hiding the enrollment UI so a fresh "Set up authenticator" always generates new backup codes. Active sessions table scrolls within the card at `max-height: 380px` with sticky header.
- `SECURITY.md`: document Semgrep-on-PRs decision (Option B chosen — CodeQL remains the sole PR SAST gate, Semgrep stays on `main`-push + weekly); update required merge checks list to include `analyze` (CodeQL) and `migration-safety`.
- `docs/ARCHITECTURE-FOR-AUDITORS.md`: sync Semgrep trigger note with the recorded decision.
- Staff admin content now fills the full width beside the sidebar on wide monitors: removed `max-width: 1100px; margin: 0 auto` from `.screen` and the per-page `max-width: 720px` from `.event-settings-page` (Event Overview, Communication, and Event Settings pages are all affected); dropped the now-redundant `.events-picker-screen` rule. Intentionally narrow surfaces (operator check-in `720px`, auth forms, danger-zone description text) are unchanged.
- Attendee Detail page (#449 review): the separate "Revoke pass" and "Revoke check-in" header buttons are now one red **Revoke** button with a small menu (pass always offered while not already revoked; check-in only when currently admitted) — same two confirmation dialogs as before, just one entry point since it's the same underlying action on the attendee. "Restore pass" stays its own button once the pass is revoked.
- `Button` (`@admitto/ui`) gained a `hasMenu` prop — a trailing chevron-down so any button that opens a menu/submenu reads the same way everywhere, instead of each caller picking its own icon. Applied to the new Revoke button above.
- Check-in scan bar: the hint under the field no longer says "Keyboard wedge auto-submits" — an event-day operator reading that had no idea what a "keyboard wedge" is (PO review). It now describes what actually happens in plain language: **"Scan a code — it submits itself · type a name, then press Enter · Esc clears the field."** Pressing Enter on a pasted or typed ticket token, ticket URL, or agency-issued QR code/UUID now actually works, matching what the hint says — previously, an explicit Enter additionally required either proof the value arrived as a genuine hardware-scanner burst (so a real pasted/typed code fell through to a name/email lookup and failed with a misleading "No attendees matched that search"), then a client-side "does this look like our token" shape check that couldn't recognize a ticket URL or an externally-issued agency code either, since neither shares the internal token's shape. An explicit Enter/Search submit on a long value now tries a **scan first** and only falls back to a name/email lookup if that comes back invalid — delegating "is this a valid code" to the server's resolver, which already recognizes every valid shape (raw token, full ticket URL, agency QR payload/UUID), instead of the client re-guessing an incomplete subset of them. The silent auto-submit that fires with no Enter at all is unchanged — it still requires a genuine hardware-scanner burst, since that path has no user confirmation at all (bot review, rounds 3-6; verified live against the dev DB throughout: a pasted token, a pasted full ticket URL, and a pasted long email all now do the right thing). Round 7: the mobile camera overlay's manual-search screen closed itself the instant a long entry was submitted, rather than once the outcome was actually known — the scan attempt (and its lookup fallback) fired in the background, so a no-match or an error landed behind an already-hidden screen; it now waits for the real result before closing (bot review). Round 8: fixed a real regression from round 5's own "consistency" cleanup — the desktop camera's no-match toast is keyed on the scan status again (`INVALID` specifically), not merely "no card in the response": a `PREVIEW` response can legitimately arrive without one too (the server's own card lookup can come back empty; the client already re-fetches it a moment later), and the broader check was intercepting that legitimate, pending scan as if it were a dead end — showing the wrong toast and discarding the scan result the upcoming card fetch needed. Also removed a dead branch in the scan bar's change handler for a value containing an embedded CR/LF — `<input type="text">` strips those characters from `.value` before any JS ever sees it (HTML spec), so the branch could never run; confirmed via direct JSDOM testing before removing it. Round 9: two more gaps in the "try a scan first" logic, both about a genuine hardware-scanner burst specifically. A wedge that appends its own Enter/CR terminator reaches the Enter handler *before* the no-Enter auto-submit timer gets a chance to fire, so it went through the same "might be a search" fallback logic as manually-typed text — a burst-scanned invalid code reported as a failed name/email search instead of an invalid scan. Separately, that same length-first check meant a *short* code (an agency-issued QR payload or external UUID isn't length-constrained the way an internal token is) never even attempted a scan, regardless of how it arrived. Both are now decided by whether the current input is a genuine burst, not by length alone — a burst always attempts a scan, at any length, with no lookup fallback; non-burst input still needs to be long enough to be worth trying as a scan before falling back to a name/email search, so a short manual query doesn't pay for a wasted round-trip. Scoped precisely to the main scan bar's own two submit points (Enter, the Search button) — the mobile camera overlay's separate manual-entry field never receives wedge input and continues to always fall back on a no-match, unaffected (bot review). Round 10: the lookup fallback also needs manual lookup to actually be turned on for this event — without that check, a bad code in a **QR-only event** (manual lookup deliberately disabled) still fell into the fallback, which immediately bailed with "Manual lookup is disabled for this event" instead of the correct "This code is not valid" — confusing wording for an operator who scanned a code and never attempted a name search, and it skipped the normal invalid-scan feedback entirely (bot review).
- Check-in — desktop camera no-match: when a scanned QR matches no attendee, the camera now stays a **plain live viewfinder** and the result shows as the same **toast** manual lookup's no-match already uses, instead of a plain dark result panel borrowed from the mobile overlay (PO review round 1) or, briefly, an inline status card covering the feed (PO review round 2: on desktop the camera is scan-only — unlike the mobile overlay, it never doubles as an operator-actions surface, so no result should render on top of it). The full-color result panel is still used on the mobile camera overlay, where it belongs. Fixed along the way: the no-match toast previously never fired at all once the camera had been toggled on, because the check reading "is the camera active" lived inside a `useCallback` that isn't recreated when the camera is toggled — it kept seeing the camera as off (its value at first render) no matter what; and opening the camera while a stale no-match result from before it was turned on was still showing carried that result straight into the camera as a paused overlay with no way to dismiss it short of closing and reopening the camera (bot review, round 2) — the camera is now cleared the same way it already was when the camera got turned off. Also: submitting a new scan from the scan bar while an earlier scan's attendee card was still showing and the new one came back no-match left that stale card sitting on screen under the toast — the camera being "on" doesn't mean it's what's currently visible, since a shown card hides it the same way it pauses it (bot review, round 3); a new scan now always clears whatever card/result preceded it, whether or not the new one gets one of its own. Round 5 (self-review after the above): the no-match toast was also firing for the **Confirm check-in** button, not just scans — if the attendee row vanished server-side between the card loading and the click, that returns the same card-less "invalid" shape a no-match scan does, so confirming showed a misleading "check the QR code" toast and wiped the card the operator was just looking at; the toast now only fires for an actual scan attempt. Separately, the stale-result clearing above keyed off the camera being toggled on, not the desktop camera view actually being on screen — a tablet rotating past the desktop breakpoint while the camera stayed "on" the whole time could skip it and reproduce the original stuck-panel bug via orientation change instead of the camera button; now keyed off the same condition that decides whether the camera view renders at all.
- Check-in — Recent scans sidebar: each row is now **clickable and reopens that attendee's card**, so an operator can revisit someone they just scanned (e.g. to hand out an item they missed) without re-scanning the QR (PO review). Works on both the desktop sidebar and the mobile camera overlay's Recent scans list; rows are real buttons (keyboard-focusable), not click-only `<div>`s.
- Internal cleanups from the #454 follow-up review (no operator-visible change): the double-submit guard hook `useInFlightIds()` now owns **both** halves of the guard — the synchronous ref that blocks a same-tick double-click *and* the state Set that drives `disabled` — and `start(id)` returns whether the caller should proceed; the check-in card and mobile item-issuing overlay now use it for all their per-item and undo guards instead of six hand-rolled ref+state pairs. The attendee-card DTO's `warnings: string[]` (only ever read as a "is this pass blocked" boolean since the check-in card redesign stopped rendering the strings) narrowed to `blocked: boolean` across producer and consumers. The per-item action label/aria-label helpers collapsed to one shared "gift bag is *given*, everything else uses the raw verb" fact instead of re-listing every item key in two places.
- **Event settings reorganized into tabs:** the single long scrolling page is now five tabs — **General** (basic info + status), **Branding**, **Wallet**, **Integrations** (superadmin only — reserved for the upcoming Ingest/RSVP API tokens, not built yet), and **Danger zone**. Basic information pairs Date and Capacity into one row on wider screens instead of a single spread-out column (#390). The General tab's Status card is a compact 3-column summary (current status with a plain-language hint, organization, and the event's Created date) instead of a paragraph plus a duplicate attendee count already shown on the Attendees page; the now-redundant "Event items" card (a duplicate of the Requirements page) is removed. Danger zone is a bordered card matching every other card's styling exactly, with a small red notice below it explaining these actions can affect the event, and each destructive action (Archive/Unarchive, Export personal data) as its own row with its own plain-language explanation. Copy across the whole page was rewritten to avoid jargon ("immutable", "PII", "audit trail") for readers with intermediate English (Jadzia/PO review).

### Added
- Admin/superadmin can now **revoke** any attendee's check-in — regardless of who admitted them or when — from the Check-in page's attendee card or from the attendee's own Detail page, behind a confirmation dialog. Distinct from the operator's existing device-scoped **Undo check-in** (their own accidental-scan safety net, unchanged); the new action clears the admission, rolls back an auto-issued badge, and logs a `check_in_revoked` entry in the attendee's Activity Log. Admin/superadmin only — never shown to operators (#449).
- **Admin/superadmin can now revoke a single handed-out item** on the Check-in page's attendee card. When something was marked issued by mistake (or needs re-doing), a small red **Revoke** next to an already-issued **Badge / gift bag / headset** resets it back to "to hand out", so the operator can issue it again — no need to pick a target state, it just goes back to pending. Admin/superadmin only: it's never shown to operators, and the endpoint independently rejects a non-admin caller (the hidden button is only a convenience, not the security boundary). Relatedly, revoking an attendee's whole **check-in** now also resets **all** of their handed-out items back to pending in the same action — previously only the auto-issued badge was rolled back, leaving a gift bag or headset stuck as "issued" after a re-admit; per the PO's ask, this is a blanket reset with no need to trace which items belong to which scan. Every item reset (single or blanket) is logged as `item_revoked` in the attendee's Activity Log. Desktop check-in card only for now — the mobile camera overlay's item-issuing flow is unchanged. Bot review: the Revoke button was missing for an **issued item that still requires return** (e.g. a headset) — it still had a pending "Mark returned" action, so it fell into the wrong branch of the card's item row and had no Revoke control at all, forcing an admin to mark it returned first just to reset it. Revoke is now shown for any non-pending item regardless of whether it also has an operator action pending. **Security review round:** the server-side revoke endpoint never actually checked whether the attendee's pass was blocked (revoked/cancelled) — only the card's own Revoke button hid itself for that case, so a direct API call could still reset an item on a blocked pass despite a code comment claiming the server enforced the same check; it now independently rejects a blocked pass. Also fixed: a single item could no longer be revoked once its item type was disabled in Requirements (409 "Item not found or disabled"), while revoking the whole check-in reset it anyway — the only way to fix one stuck disabled item was the much bigger action of revoking the entire check-in; single-item revoke no longer requires the item to still be enabled, since it's correcting a past hand-out, not offering a new one. A lost race between an admin's revoke and a concurrent operator action now surfaces as an error instead of silently doing nothing with no audit trail. **Round 2:** revoke (single-item and whole-check-in) no longer resets an item sitting in one of the exceptional "lost" / "problem" / "not applicable" outcomes (ADR 0010) back to "pending" — those aren't handed-out states, and silently clearing them would erase a real exceptional result as if it were ready to hand out again; only "issued"/"returned" items are actually revocable. The whole-check-in blanket reset also now scopes its queries by event, matching the single-item path, as defense-in-depth. A revoked item is now correctly logged as event-day activity on the attendee's Activity tab — it previously fell back to a generic row and a UTC timestamp instead of the event's local time, the same gap already fixed for admin check-in revokes. **Round 3:** revoking an attendee's **pass** (Attendee Detail page) shared the same mutation as the explicit "Revoke check-in" action, so it picked up that action's blanket item reset as a side effect — revoking a pass after a gift bag/headset was already handed out, then later restoring it, left the item card falsely claiming it still needed to be given out, even though it physically already had been. Pass-revoke now only clears the stale admission (its original, intended behavior); the blanket item reset stays opt-in, used only by the explicit "Revoke check-in" action where the PO actually asked for it. **Round 4:** the check-in card's Revoke controls (both check-in and per-item) were gated on "is this user an admin of *any* organization," not the current event's — a mixed-role user (e.g. admin of one org, only an event-day operator for another) could see the buttons on an event they don't manage and have every click 403 (Codex review). Now gated on admin status for the event's own organization specifically, matching the server's check exactly.
- **Check-in scan outcome feedback: a beep and (where supported) a short vibration on every scan.** Operators scanning at a busy door previously had visual-only feedback — a success beep for a valid scan, a two-tone warning for "already checked in," and a low error tone for invalid/revoked, so the outcome is clear without looking at the screen. A short vibration accompanies it where the platform supports it — Android and desktop Chrome do; iOS Safari (and every browser on iOS, since they all share its WebKit engine) has never supported the Vibration API at all, so it's silently skipped there, not a bug. Respects `prefers-reduced-motion` (skips vibration) and a new mute toggle (speaker icon next to the camera button on desktop, and in the mobile camera overlay's header) that only affects the beep — vibration is silent by nature, so it's unaffected by mute. Web Audio's autoplay restriction (an `AudioContext` starts suspended until a user gesture unlocks it) means the very first scan of a session may be silent while it wakes up; every scan after that has sound, since a hardware scanner's keystrokes count as a user gesture the same as real typing (#431).
- My account: **Download backup codes** button next to the codes shown during 2FA enrollment — same one-code-per-line `.txt` and `admitto-backup-codes.txt` filename as the server-rendered MFA enrollment page; rendered inline in the backup-codes header row so the 2FA card height stays unchanged (#421).
- `eslint-plugin-security` enabled for `apps/*/src` (admin, web, cli) with `detect-object-injection` off as a typed-record false-positive; remaining SAST hits annotated inline.
- `operatorApiErrorMessage()` / `hasApiErrorCode()` helper (`apps/admin/src/api/operator-api-error.ts`) — central mapping for operator-safe admin API error copy; AGENTS.md documents the convention.
- `CheckInPage.scan-queue.test.tsx`: extracted `typeWedge(input, token, { gapMs?, baseTime?, prefix? })` helper — replaces 17 identical character-by-character typing loops; future timing tweaks are a one-line change.
- Codecov Test Analytics: CI coverage run now also emits a JUnit XML per workspace (`--reporter=junit`), uploaded via `codecov/test-results-action` — flaky test and failure-rate reporting, no gate.
- Event settings: new **Branding tab** lets an event admin upload a custom logo and header image scoped to just this event, overriding the organization's default branding for that event only (falls back to the organization's branding whenever left blank). Reuses the existing organization-logo upload component, now generalized to support event-scoped uploads and a disabled state while the event is archived.
- Event Settings — **Delete event** (superadmin only): a new Danger Zone action that permanently deletes an event and everything in it (attendees, items, contacts, resources, mail templates, action-log history, check-ins). It is available on both active and archived events, and only enables once the event shows zero real activity — no attendees, no items beyond the default "Badge", no contacts, no resources, no pinned note, no event-specific mail template, and no event-scoped action-log history (e.g. a report export or item-config change with no attendee attached) — so a genuinely-used event, active or archived, can never be deleted, only archived/unarchived. Confirming requires typing the event's exact title (`ConfirmDialog` gained a reusable typed-confirmation mode); the deletion is recorded in the audit trail (#395).

### Security
- Admin SPA: audit `ApiError.message` exposure — toasts and inline errors now go through `operatorApiErrorMessage()` so unknown server detail is suppressed with a generic fallback (dev console warning only).
- Identity JSON API (`/api/admin/identity/providers*`, `/api/admin/identity/cf-access*`): catch blocks no longer forward raw `err.message` to the client. Unexpected/Prisma errors now return `{ error: "save_failed" }` (HTTP 500) with full details logged server-side only; domain validation errors return `{ error: "validation_failed" }` (HTTP 400); discovery failures return `discovery_failed`; invalid issuer URL returns `invalid_issuer`; invalid/missing CF Access team domain returns `invalid_team_domain` / `team_domain_required`. Integration tests cover all error code paths including simulated DB failures via `vi.mock("@admitto/auth")` factory.
- **Delete event (#395) is layered against both an accidental click and a compromised superadmin session, without requiring an event to be archived first.** The button is disabled unless the event shows zero real activity across 7 independent signals (0 attendees, no items beyond "Badge", no contacts, no resources, no pinned note, no event-specific mail template, no event-scoped action-log entries) — a genuinely-used event can never be deleted regardless of its archived status, so a separate "must archive first" step would only add friction, not safety. The server independently re-validates the exact same guard on every `DELETE` request; it never trusts the settings DTO's `is_deletable` hint, which exists only to drive the button's disabled state. Deleting also requires typing the event's exact title to confirm — an empty confirmation value can never satisfy this and fails closed. `DELETE /api/admin/events/:eventId` is superadmin-gated and CSRF-protected like every other mutating admin route; a concurrent activity change between the guard check and the delete is caught by the database's own foreign-key safety net and reported the same as any other "not deletable" rejection.
- **Dev server no longer binds to every network interface by default.** `npm run dev -w @admitto/web` was reachable from any device on the local network at the dev machine's LAN IP, not just `localhost` — an unintended exposure surface for a tool that handles attendee PII. It now binds to loopback only unless a local mkcert HTTPS cert is present (the existing opt-in phone-over-LAN camera-testing workflow, which still needs to be LAN-reachable). Production is unaffected — it still binds to all interfaces, as required to accept traffic from the container network / reverse proxy.
- Self-service account actions (password change, MFA enroll/reset, session revoke) are now recorded in the admin audit trail — previously only the admin-on-another-user equivalents were logged, so a user changing their own credentials left no trace (#472).
- **Fixed a self-lockout: enrolling MFA from Account settings while already logged in silently broke the current session.** Confirming TOTP enrollment marks backup codes as unacknowledged (IAM-002), which every subsequent request re-checks — but only the login-time enrollment flow ever cleared that flag. A self-service enroll (already-`full` session) never reached that step, so the very next request after confirming was rejected with no explanation, and the account-level acknowledgment endpoint itself required a partial (non-`full`) session the user no longer had — the only way out was logging out and back in. Self-service confirm already shows backup codes at the enroll step, so the fix marks them acknowledged immediately on confirm instead of requiring a separate step.
- **Resetting your own 2FA now requires a current authenticator (or backup) code, not just your password, for accounts whose role requires MFA.** Previously `POST /api/account/mfa/reset` deleted every MFA method after checking only the password — weaker re-auth than linking an extra SSO identity already required. This closes a path where a password-only compromise (without also breaking the second factor) could be used to permanently strip and replace an admin/superadmin account's MFA. Mirrors the existing password+TOTP step-up already used for SSO account linking; accounts whose role doesn't require MFA are unaffected.

### Fixed
- Check-in (desktop): with "Auto-advance after valid check-in" turned on, confirming an attendee who had hand-out items configured (badge, gift bag, headset) cleared their card instantly — including the "Mark issued" buttons — so the operator had to search the same person again just to hand the items over. The desktop card now stays up whenever it lists items, matching the mobile check-in overlay (#434).
- Attendee card: the PREVIEW state's dismiss button read "Cancel" while every other state's read "Clear" for the identical action — unified on **Clear** everywhere on this card (#449 review).
- Activity Log: a `check_in_revoked` entry (from the new admin revoke action, #449) was missing from the timeline's icon/label/timezone maps, so it rendered with the raw lowercase action-type string ("check in revoked") and in UTC instead of the event's local timezone like other on-site check-in activity.
- Recent scans sidebar: reversed admissions (operator self-undo or admin revoke) were excluded from `getRecentCheckIns`' query entirely, so a revoked/undone attendee kept showing as a permanently green "Checked in" row with no indication it had been reversed. The sidebar now shows a distinct "Undone" or "Revoked" row (grey dot) for these events.
- "Revoke check-in" (Check-in page card and Attendee Detail page, #449) stayed visible and clickable after the attendee's **pass** had already been revoked, because its visibility only checked `admitted_at` and ignored `status`. Now hidden once the pass itself is revoked — a stale admitted timestamp on an already-revoked pass no longer offers a redundant/confusing action.
- **Revoke pass now auto-clears any current admission.** PO review: revoking a pass left `admitted_at` untouched, so restoring the pass later silently resurrected a "checked in" state from before the revoke, with no new scan ever happening. Revoking a pass while the attendee is admitted now also un-admits them (rolls back an auto-issued badge and logs `check_in_revoked`, same as the standalone Revoke check-in action) in the same transaction as the status change.
- Attendee card: the "Notes" section used unstyled browser defaults (heading-sized `<h3>`, default paragraph margins) and sat flush against the status banner above it — restyled to match the card's small-caps section-label convention (used elsewhere for Recent scans) with a separating top border and tighter spacing between entries.
- Check-in attendee search no longer matches on **company or department** — only name and email. Searching "Hitachi" used to surface both "Hitachi" and "Hitachi Energy" (and anyone else sharing a company/department substring), which read as a bug rather than a useful result (PO review). Company and department are still shown on each result for context; they're just never used to find one. The scan-bar placeholder now reads "Scan QR · type name or email…". (Removed the extra `custom_data` JSON company/department raw-SQL branch and its result-merge from `lookupAttendees`, since those fields are no longer searched.)
- **Check-in item hand-out — follow-up review of the desktop/mobile flow (#454):** several correctness and accessibility fixes. On the mobile item-issuing screen, navigating **Back** to a just-issued item that has a further step (e.g. a headset configured to require return) showed "Already returned" instead of "Already issued" — the badge re-derived the state from the item's *next* legal action rather than remembering what the operator actually submitted. An item-action / add-note / undo request that failed and was then retried successfully left a stale "Request failed" banner sitting over the successful result — each of these now clears the banner as it starts, matching how a fresh scan already did. When an item action failed while the mobile camera overlay was open, the identical error mounted twice (the page-level paragraph *and* the overlay's own, both `role="alert"`), so a screen reader announced it twice — the page-level one is now suppressed while the overlay covers it, leaving exactly one. The mobile item-summary's **Undo last check-in** now stays disabled while a check-in confirmation is still pending, matching its desktop counterpart. A revoked/invalid pass's "block item actions and admin-revoke" check now fails **closed** for any unrecognized status (defense-in-depth) instead of only matching an explicit list, and is derived from the same status-grouping used by the status badge so the two can't drift.
- `EventSettingsPage.test.tsx` (#459): the branding-save test clicked "Save changes" right after `waitFor`-ing the upload preview's alt text, assuming that also meant the button's label had already flipped from "Uploading…" — but the preview render and the Save button's label update land in separate React commits (the latter only fires once `LogoUploadZone`'s `onUploadingChange` effect runs a tick later), so under CPU contention from parallel test files the click could land before the button existed under that name (flaky `getElementError` on `npx vitest run`, not reproducible in isolation or with `--no-file-parallelism`). Now waits for the button itself via `findByRole` before clicking, matching the pattern already used by the adjacent "disables Save while a branding upload is in flight" test.
- **Archived events now fully lock down check-in, not just admin edits.** Previously archived events deliberately stayed reachable for check-in (the old `ADR 0022` carve-out) — but that let an officially-over event still receive scans, lookups, and admits. Archived events are now excluded from the operator's check-in event list, and every check-in route (scan, lookup, admit, notes, undo, attendee card, stats, stream) returns `403` with `This event is archived.` — reusing the same guard already used by admin mutating routes, so behavior is consistent everywhere. The admin's embedded Check-in tab now shows a "Check-in is disabled" empty state (matching the icon + title + description pattern used elsewhere, e.g. Reports' "No check-ins yet") instead of the scanner. Found during code-review: the emergency ops CLI's `checkin lookup`/`checkin admit` commands call the same check-in domain functions directly, bypassing the HTTP layer entirely — they now run their own archived check first, so the CLI can't be used as a side door around this lockdown.
- Superadmin: archived events are reachable again from the events picker. The Archived tab's event cards had no navigation link at all — only the Unarchive button worked, so a superadmin had no way to open an archived event's Overview/Settings from the picker. The card body is clickable again; Unarchive remains an independent action button alongside it.
- Events picker: archived event cards now use the exact same card style as active ones (same border, spacing, layout), just with an **Archived** badge instead of **Active** — previously archived cards had a visually distinct "static" style plus an on-card **Unarchive** button and a separate caption row, which looked like a different, lesser component. The card's left accent border is now grey for archived events instead of staying the active-event green. Unarchive is no longer offered from the picker card (it remains available from Event Settings → Danger zone and from the superadmin's instance-wide Archiving panel) to keep the card a pure navigation surface. Danger zone copy on Event Settings updated to reflect that archived events are now fully read-only including check-in (stale text still said "Check-in remains available").
- **Archiving/unarchiving an event live no longer requires a page reload to take effect on other tabs.** Event Settings kept its own separate copy of the event and refreshed it correctly after Archive/Unarchive/Save — but every other page nested under the same event (Check-in, Attendees, Requirements, Communication, Import) reads the event from one shared layout state that was only fetched once and never refreshed on its own. Archiving an event while, say, the Check-in tab was already open left it looking active (scanner still mounted) until a full reload. Settings now asks the shared layout to refetch immediately after a successful save/archive/unarchive, so this Check-in lockdown (and every sibling page) reflects the change instantly, without navigating away or reloading.
- **Archived events now grey out every mutating admin control, not just the ones already covered.** Being "archived" previously only stopped check-in — Import, Add attendee, Send tickets, Restore/Revoke pass, Resend ticket, the attendee profile form, Requirements' Add item / per-item Active & Edit / all four Event behaviour switches, Communication's Send email / New / Delete / Preview / Save / Send test and its editor fields, and Import's file upload / Preview / Commit / capacity-override checkbox all kept working on an event that was supposedly locked down. Every one of these ~30 controls is now disabled with a dark hover tooltip ("This event is archived — editing is disabled.") once the event is archived, via a new shared `ArchivedGuard` component; read-only actions (exporting, viewing, navigating, downloading templates, paging the delivery log) are intentionally left untouched. The tooltip reason always wins over any other disabled state the control already had (e.g. a save-in-flight spinner), so operators never see a stale or contradictory explanation. The tooltip's own font-weight is now set explicitly instead of inheriting from its container, fixing an inconsistent bold rendering on the Communication page. Controls that sit at the very top of a scrollable page (Attendees toolbar, Import's upload area) now grow their tooltip downward instead of upward — the default upward placement was getting visually clipped by the page's scroll-container boundary before it could render.
- **Archiving an event live no longer requires a page reload for these controls to grey out.** Event Settings kept its own separate copy of the event and refreshed it correctly after Archive/Unarchive/Save, but every page above (Attendees, Requirements, Communication, Import) reads the event from one shared layout state that was only fetched once and never refreshed on its own — so archiving an event while, say, Requirements was already open left its controls clickable until a full reload. Settings now asks the shared layout to refetch immediately after a successful save/archive/unarchive, so every `ArchivedGuard`-protected control greys out instantly, without navigating away or reloading.
- **Event settings — Status card had a leftover 4th "Items" cell duplicating the Requirements link:** the Status card was described (and CSS-laid-out) as a 3-column summary (current status, organization, created date), but a 4th cell — "Items: N configured" with a "Manage in Requirements →" link — had survived, wrapping onto its own row in the fixed 3-column grid and recreating the exact duplicate-link problem the standalone "Event items" card was removed for. Removed the leftover cell and its now-unused `enabledItemsCount` computation; Requirements stays the one place to manage items (#394).

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
- Identity providers migration cleanup (#266 slice 5): the legacy server-rendered identity admin is removed — `/admin/auth/providers*` and `/admin/auth/cf-access*` HTML routes, their handlers (`auth-providers-routes.ts`, `cf-access-routes.ts`), the HTML renderers (`auth-providers-html.ts`, `cf-access-html.ts`), and the `renderAdminShell` sidebar + `SETTINGS_SUBNAV_ITEMS` + `ADMIN_PAGE_CSS` block in `shared-auth-styles.ts`. The SPA at `/admin/settings/identity/*` is now the only identity admin surface; the JSON API (`/api/admin/identity/*`, slice 1) is unaffected. The `cf-access-routes` integration test was retargeted from the deleted HTML routes to the `/admin` SPA shell (and `/api/admin/identity/providers` for the CF no-role 403 message); the `oidc-admin-routes` and `auth-providers-html` unit tests were removed with the code they covered. Docs/env examples and `SECURITY-CONTROLS.md` updated to reference Settings → Identity; the stale `/admin/auth` Vite dev-proxy rule was removed.

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
- Docs: superadmin runbook for multiple instance admins and OIDC offboarding prerequisites (`SECURITY-CONTROLS.md`, `deploy/README.md`)

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
- Known limitation: OIDC group→role reconciliation runs at OIDC login only — shorten admin session TTL and follow offboarding guidance in `SECURITY-CONTROLS.md`
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
- `docs/SECURITY-CONTROLS.md`: rate-limit matrix, `TRUST_PROXY` trust model, SSRF/DNS-rebind guards, PEN retest checklist for operators

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
- `SECURITY-CONTROLS.md`: configurable security capabilities table with TOTP and OIDC implementation detail
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

[Unreleased]: https://github.com/solarssk/admitto/compare/v0.4.12...HEAD
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
