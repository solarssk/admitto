# Wallet Passes Overview

| | |
|---|---|
| **Audience** | Superadmins (configuration), all staff (attendee actions) |
| **Required role** | Superadmin for Event Settings → Wallet; Staff Admin or higher for attendee wallet actions |
| **Feature status** | Available |
| **Last verified** | Admitto 0.5.1 |

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
- **Field mapping.** Every PassCreator template defines its own custom field names (an admin
  chooses these when building the template in PassCreator's own dashboard - Admitto has no say in
  what they're called). In Event Settings → Wallet, an admin adds one row per template field: pick
  an Admitto **value** from a fixed list (attendee full/first/last name, email, company,
  department, event name/date/hours/location, directions/accessibility text, Google/Apple Maps
  links, individual address parts, ticket type, or the ticket/QR value itself), then type the exact
  **key** that matches that field's name in the PassCreator template. For example, mapping value
  "Attendee full name" to key `fullName` sends the attendee's name to whichever template field is
  registered as `fullName`. There is no default mapping and no auto-detection - nothing beyond the
  QR/barcode is sent until a row exists for it, because different templates use different field
  names and Admitto can't guess them. See the
  [template setup page](Wallet-Passes-PassCreator-Setup) for the full step-by-step, including how
  to register a field on the PassCreator side first.
- **Semantic tags** (Apple Wallet only, off by default). A separate switch next to Apple Wallet
  that sends Apple's own structured pass data (event name, start/end time, venue location, entrance
  directions, attendee name, duration) so the pass gets Siri Suggestions and Maps/Calendar smart
  surfacing. No template setup needed - this is a fixed Apple-defined vocabulary, not something an
  admin maps field by field. No NFC hardware or PassCreator account approval required, and it has
  no effect on Google Wallet.
- **Live updates to already-issued, active passes.** Editing an attendee (name, email, company,
  department, ticket type) or a wallet-relevant event field (title, date, hours, timezone, the
  Apple Wallet toggle, or the Semantic tags toggle) automatically refreshes passes already on
  attendees' devices - no manual re-issue needed. Two things this does not cover: a voided pass is
  skipped until it is restored *and* separately pushed again, since restoring only clears the void
  flag rather than refreshing content; and a single-attendee edit pushes immediately in the same
  request rather than through the background job queue, so it never shows up in Event Settings →
  Wallet's "Wallet push history" list - that list is event-wide and bulk pushes only.
- **Registration status.** Whether an attendee has actually added the pass to their device (not
  just had one issued) is tracked from PassCreator via webhook, with periodic polling as a
  fallback - shown on Attendee Detail and the Attendees list's Wallet column.
- **Wallet lifecycle actions.** Void, push updates, and permanently delete a wallet pass at the
  provider - available both from Attendee Detail (single attendee) and the Attendees list (bulk,
  for a selection). Restore is Attendee Detail only, there is no bulk restore action. Revoking an
  attendee's ticket also voids their wallet pass automatically; restoring the ticket restores the
  pass the same way.

## What's not supported

- **Apple's "Enhanced"/poster event ticket style** (the iOS 18+ lock-screen redesign with live
  countdown). This requires NFC hardware and PassCreator account approval, and Apple's own
  documentation states poster-style tickets are incompatible with QR/barcode-only entry. Admitto's
  check-in is QR/barcode-based, so this isn't a "not yet" - it's architecturally excluded unless
  the check-in model itself changes.
- **Samsung Wallet.** Shown as a disabled row in Event Settings → Wallet for layout consistency
  with Apple/Google. PassCreator has no API support for it today.

## Related pages

- [Wallet Passes - PassCreator Template Setup](Wallet-Passes-PassCreator-Setup) - the detailed field-mapping walkthrough
- [Event Overview and Settings](Event-Overview-and-Settings)
- [Pass Statuses](Pass-Statuses)
