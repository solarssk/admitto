# Wallet Passes Overview

**Audience:** Superadmins (configuration), Administrators and Superadmins (attendee actions) · **Required role:** Superadmin for Event Settings → Wallet; Administrator or Superadmin for attendee wallet actions · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.7

## What this page helps you do

Understand what Admitto's Apple/Google Wallet integration actually supports today, where each
piece is configured, and where to go for the detailed setup steps. For the field-by-field template
setup walkthrough, see [Wallet Passes - PassCreator Template Setup](Wallet-Passes-PassCreator-Setup).

## Before you start

Wallet passes are delivered through PassCreator, a third-party pass-generation service - it's the
only supported provider. You need a PassCreator account, API key, and template before any of this
works; Admitto never signs or hosts pass files itself.

## What's supported

- **Apple Wallet and Google Wallet**, toggled independently in Event Settings → Wallet. Turning the
  whole feature off, or either platform, hides the corresponding "Add to Wallet" button on the
  public ticket page without deleting any configuration.
- **On-demand creation.** A pass is created the first time an attendee taps "Add to Apple/Google
  Wallet" on their ticket page - not eagerly at ticket issuance, not in bulk. Repeat taps reuse the
  same pass.
  - **When the buttons go away:** the Add to Wallet buttons are hidden, and an old link does
    nothing (it just returns to the ticket, with no error), once the event is over (its end time,
    or the end of its day when it has none, in the event's own time zone) or archived, when the
    attendee's ticket is no longer valid, and when their wallet pass is voided, expired or removed.
    Tapping never brings a voided pass back to life; only an admin's **Restore wallet pass** does,
    and only until the event is over.
- **Field mapping.** Every PassCreator template defines its own custom field names, chosen by an
  admin when building the template in PassCreator's own dashboard; Admitto has no say in what
  they're called.
  - **How it works:** in Event Settings → Wallet, an admin adds one row per template field: pick
    an Admitto **value**, then type the exact **key** that matches that field's name in the
    PassCreator template. For example, mapping value "Attendee full name" to key `fullName` sends
    the attendee's name to whichever template field is registered as `fullName`.
  - **Available values:** attendee full/first/last name, email, company, department, event
    name/date/hours/location, directions/accessibility text, Google/Apple Maps links, individual
    address parts, ticket type, the ticket/QR value itself, event type, or a venue access-point
    detail such as room, entrance, door/gate/portal, phone number, Venue place ID, or an opening
    time.
  - **No default mapping, no auto-detection:** nothing beyond the QR/barcode is sent until a row
    exists for it, because different templates use different field names and Admitto can't guess
    them.

  See the [template setup page](Wallet-Passes-PassCreator-Setup) for the full step-by-step,
  including how to register a field on the PassCreator side first.
- **Semantic tags** (Apple Wallet only, no switch). Siri Suggestions and Maps/Calendar smart
  surfacing use the same Field mapping mechanism as visible card fields - there is no separate
  toggle. Map a placeholder such as "Event type", "Venue room", or an access-point opening time to
  a field in Event Settings → Wallet, then bind that same field to the matching Apple semantic tag
  inside PassCreator's own Semantic Tags panel. Both steps are required; mapping in Admitto alone
  does nothing. No NFC hardware or PassCreator account approval required, and it has no effect on
  Google Wallet. See the [template setup page](Wallet-Passes-PassCreator-Setup) for the full
  walkthrough.
- **Lock Screen relevance date** (Apple Wallet only, always on, no switch). Whenever Apple Wallet
  is enabled and the event has a start time, Admitto tells PassCreator when the pass should surface
  on the Lock Screen - independent of, and regardless of, the semantic tags field mapping above.
  See the [template setup page](Wallet-Passes-PassCreator-Setup) for details.
- **Live updates to already-issued, active passes.** Editing an attendee or a wallet-relevant
  event field automatically refreshes passes already on attendees' devices, no manual re-issue
  needed.
  - **What triggers a push:** an attendee edit (name, email, company, department, ticket type), or
    a wallet-relevant event field (title, date, hours, timezone, the Apple Wallet toggle, event
    type, or a Location field).
  - **Confirmation UX:** saving an event-wide change shows a confirmation naming how many
    attendees currently have the pass installed, so it's clear this reaches real devices. Editing
    a single attendee shows a lighter, non-blocking note instead, since that only ever affects one
    person. Neither appears when nothing is actually installed yet.
  - **Two exceptions:** a voided pass is skipped until it is restored *and* separately pushed
    again, since restoring only clears the void flag rather than refreshing content. A
    single-attendee edit pushes immediately in the same request rather than through the background
    job queue, so it never shows up in Event Settings → Wallet's "Wallet push history" list, which
    is event-wide and bulk pushes only.
- **Registration status.** Whether an attendee has actually added the pass to their device (not
  just had one issued) is tracked from PassCreator, shown on Attendee Detail and the Attendees
  list's Wallet column.
  - **How it's tracked:** via webhook, with periodic polling as a fallback (can take a while to
    reach any one attendee). Attendee Detail's wallet **Refresh status** action pulls that one
    attendee's current status immediately instead of waiting for the periodic poll, useful when
    PassCreator's own dashboard already shows a pass as added but Admitto hasn't caught up yet.
    Only an active pass is checked: a voided pass keeps the last status it had, and the periodic
    poll skips archived events (a manual **Refresh status** still works there).
  - **A pass voided at PassCreator:** if PassCreator voids or expires a pass on its own, Admitto
    notices on the next check (or when PassCreator's void notification arrives) and marks the pass
    **Voided** here too. Until a PassCreator time zone setting exists, an expired pass shows as
    voided rather than expired. Right after you void or restore a pass in Admitto, PassCreator's
    answer is ignored for about ten minutes, so an out-of-date reply can't undo your action.
  - **Platform visibility:** both surfaces only show the platform(s) Event Settings → Wallet
    actually offers for that event. Turning the whole feature off hides the Wallet column and the
    Attendee Detail Wallet card entirely; turning off just Apple or just Google Wallet drops that
    platform's icon/row everywhere, without affecting the other one.
  - **After Remove from provider:** the pass's last known registration counts are kept, but
    shown as "Was registered" rather than "Registered" on both surfaces, since a removed pass is
    never read again - it is a frozen snapshot from just before removal, not a live status.
- **Wallet lifecycle actions.**
  - **Actions available:** void, push updates, refresh status (active passes only), permanently
    delete a wallet pass at the provider (and its local record), restore, and - once a pass is
    voided or expired - remove it from the provider while keeping the local record and its Reports
    history. Revoking an attendee's ticket also voids their wallet pass automatically; restoring
    the ticket restores the pass the same way.
  - **Single vs bulk scope:** void, push updates, refresh status, delete, and remove are available
    both from Attendee Detail (single attendee) and the Attendees list (bulk, for a selection).
    Restore is Attendee Detail only, there is no bulk version of it.
  - **Delete vs Remove:** delete erases the wallet pass at the provider and the local record
    together, including its Reports history. Remove from provider only deletes it at the
    provider, keeping the local record and history - it exists specifically to stop the provider
    counting a no-longer-valid pass against its own plan, which void alone does not
    do. Remove is only offered once a pass is voided or expired, and cannot be undone at the
    provider.
  - **Archived events and the Wallet switch:** void, delete, remove, and refresh status all still
    work on an archived event and when the event's Wallet switch is off, so a pass can be wound
    down after an event has ended. Restore and push updates stay disabled there.
  - **Whole event at once:** **Void active passes** in the Attendees header menu makes every active
    pass of the event show as invalid, in the background and without the 100-attendee limit of a
    selection. It follows the same rules as void on one attendee (it also works on an archived
    event and with the Wallet switch off), leaves passes that are no longer active alone, and can be
    run again to retry any that failed. **Remove inactive passes**, right next to it, does the same
    for **Remove from provider**: it removes every voided pass of the event that has stayed voided
    for at least a day, keeping each pass's local record and Reports history. Expired passes are not
    included yet - remove those one at a time or from a selection.
  - **Automatic expiration.** Event Settings → Wallet's **Pass expiration** field can give every
    issued pass a real expiration date tied to the event's own end time, so it goes **Expired** on
    its own instead of staying active indefinitely once the event is over. Off by default; see the
    [template setup page](Wallet-Passes-PassCreator-Setup) for the template requirement and how to
    turn it on. An expired pass can't be restored, the same as one whose event is already over.
  - **Rate and pacing limits:** a bulk wallet action accepts at most 100 attendees per selection.
    Each attendee's pass is updated one call at a time at a fixed pace, to stay within
    PassCreator's own request limit, rather than all at once, so a bulk action against a large
    selection takes noticeably longer than an equivalent single-attendee action multiplied out, up
    to roughly 15 seconds to finish at this pace. This is expected, not a stuck page.

## What's not supported

- **Apple's "Enhanced"/poster event ticket style** (the iOS 18+ lock-screen redesign with live
  countdown). This requires NFC hardware and PassCreator account approval, and Apple's own
  documentation states poster-style tickets are incompatible with QR/barcode-only entry. Admitto's
  check-in is QR/barcode-based, so this isn't a "not yet" - it's architecturally excluded unless
  the check-in model itself changes.
- **Samsung Wallet (partially).** Event Settings → Wallet has a real, saveable Samsung Wallet
  switch alongside Apple/Google, and an attendee's ticket page shows an Add to Samsung Wallet
  button when it's on - but PassCreator hasn't finished activating Samsung Wallet support on any
  template yet, so the button isn't tappable and no attendee can actually get a Samsung pass. Once
  PassCreator finishes that activation, a follow-up Admitto change is still needed before the
  button becomes tappable (reading the real install-link field PassCreator returns once activated
  and wiring it into the ticket page); registration-status display (Attendees table, an
  attendee's Wallet card) already reads real PassCreator data and needs no further changes.

## Related pages

- [Wallet Passes - PassCreator Template Setup](Wallet-Passes-PassCreator-Setup) - the detailed field-mapping walkthrough
- [Event Overview and Settings](Event-Overview-and-Settings)
- [Pass Statuses](Pass-Statuses)
