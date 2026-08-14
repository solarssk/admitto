# Wallet Passes Overview

> **Audience:** Superadmins (configuration), all staff (attendee actions)
> **Required role:** Superadmin for Event Settings → Wallet; Staff Admin or higher for attendee wallet actions
> **Feature status:** Available
> **Last verified:** Admitto 0.5.1

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
- **Field mapping.** PassCreator templates each define their own custom field names; an admin maps
  Admitto values (attendee name, event date/hours/location, ticket type, maps links, and more) onto
  those field names. Nothing beyond the QR/barcode is sent until a field is explicitly mapped - see
  the [template setup page](Wallet-Passes-PassCreator-Setup) for the full walkthrough.
- **Semantic tags** (Apple Wallet only, off by default). A separate switch next to Apple Wallet
  that sends Apple's own structured pass data (event name, start/end time, venue location, entrance
  directions, attendee name, duration) so the pass gets Siri Suggestions and Maps/Calendar smart
  surfacing. No template setup needed - this is a fixed Apple-defined vocabulary, not something an
  admin maps field by field. No NFC hardware or PassCreator account approval required, and it has
  no effect on Google Wallet.
- **Live updates to already-issued passes.** Editing an attendee (name, email, company, department,
  ticket type) or a wallet-relevant event field (title, date, hours, timezone, the Apple Wallet
  toggle, or the Semantic tags toggle) automatically refreshes passes already on attendees' devices
  in the background - no manual re-issue needed. Event Settings → Wallet's "Wallet push history"
  list shows recent runs of this background refresh.
- **Registration status.** Whether an attendee has actually added the pass to their device (not
  just had one issued) is tracked from PassCreator via webhook, with periodic polling as a
  fallback - shown on Attendee Detail and the Attendees list's Wallet column.
- **Wallet lifecycle actions.** From Attendee Detail (single attendee) or the Attendees list
  (bulk): void, restore, push updates, and permanently delete a wallet pass at the provider.
  Revoking an attendee's ticket also voids their wallet pass automatically; restoring the ticket
  restores the pass the same way.

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
