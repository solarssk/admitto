# Wallet Passes Overview

**Audience:** Superadmins (configuration), Administrators and Superadmins (attendee actions) · **Required role:** Superadmin for Event Settings → Wallet; Administrator or Superadmin for attendee wallet actions · **Feature status:** ✅ Available · **Last verified:** Admitto 0.7.4

## What this page helps you do

Understand what Admitto's Apple and Google Wallet integration supports today, where each piece is configured, and where to go for the detailed setup steps. For the field-by-field template setup walkthrough, see [Wallet Passes - PassCreator Template Setup](Wallet-Passes-PassCreator-Setup).

## Before you start

Wallet passes are delivered through PassCreator, a third-party pass-generation service. It is the only supported provider. You need a PassCreator account, an API key and a template before any of this works. Admitto never signs or hosts pass files itself.

## What's supported

### Apple Wallet and Google Wallet

They are toggled independently in Event Settings → Wallet. Turning the whole feature off, or either platform, hides the corresponding "Add to Wallet" button on the public ticket page, without deleting any configuration.

### On-demand creation

A pass is created the first time an attendee taps "Add to Apple Wallet" or "Add to Google Wallet" on their ticket page. It is not created eagerly at ticket issuance, and not in bulk. Repeat taps reuse the same pass.

**When the buttons go away.** The Add to Wallet buttons are hidden, and an old link does nothing (it just returns to the ticket, with no error), in these cases:

- The event is over (its end time, or the end of its day when it has none, in the event's own time zone), or archived.
- The attendee's ticket is no longer valid.
- The attendee's wallet pass is voided, expired or removed.

Tapping never brings a voided pass back to life. Only an admin's **Restore wallet pass** does, and only until the event is over.

### Field mapping

Every PassCreator template defines its own custom field names. An admin chooses them when building the template in PassCreator's own dashboard. Admitto has no say in what they are called.

**How it works.** In Event Settings → Wallet, an admin adds one row for each template field:

1. Pick an Admitto **value**.
2. Type the exact **key** that matches that field's name in the PassCreator template.

For example, mapping the value "Attendee full name" to the key `fullName` sends the attendee's name to whichever template field is registered as `fullName`.

**Available values**

- attendee full, first and last name, email, company, department
- event name, date, hours, location
- directions and accessibility text, Google and Apple Maps links, individual address parts
- ticket type, the ticket/QR value itself, ticket status
- event type
- a venue access-point detail, such as room, entrance, door, gate or portal, phone number, Venue place ID, or an opening time
- this event's own custom fields that are set up as **Single choice** or **Yes/No**

The [template setup page](Wallet-Passes-PassCreator-Setup) shows how each of these reads on the card.

**No default mapping, no auto-detection.** Nothing beyond the QR or barcode is sent until a row exists for it, because different templates use different field names and Admitto cannot guess them.

See the [template setup page](Wallet-Passes-PassCreator-Setup) for the full step-by-step, including how to register a field on the PassCreator side first.

### Semantic tags (Apple Wallet only, no switch)

Siri Suggestions and Maps and Calendar smart surfacing use the same Field mapping mechanism as visible card fields. There is no separate toggle.

1. Map a placeholder such as "Event type", "Venue room", or an access-point opening time to a field in Event Settings → Wallet.
2. Bind that same field to the matching Apple semantic tag inside PassCreator's own Semantic Tags panel.

Both steps are required. Mapping in Admitto alone does nothing. No NFC hardware or PassCreator account approval is required, and it has no effect on Google Wallet. See the [template setup page](Wallet-Passes-PassCreator-Setup) for the full walkthrough.

### Lock Screen relevance date (Apple Wallet only, always on, no switch)

Whenever Apple Wallet is enabled and the event has a start time, Admitto tells PassCreator when the pass should surface on the Lock Screen. This is independent of the semantic tags field mapping above. See the [template setup page](Wallet-Passes-PassCreator-Setup) for details.

### Live updates to already-issued, active passes

Editing an attendee or a wallet-relevant event field automatically refreshes passes already on attendees' devices. No manual re-issue is needed.

**What triggers a push**

- An attendee edit: name, email, company, department, or ticket type.
- A wallet-relevant event field: title, date, hours, timezone, the Apple Wallet toggle, event type, the Pass expiration setting, or a Location field.

**Confirmation**

- Saving an event-wide change shows a confirmation that names how many attendees currently have the pass installed, so it is clear this reaches real devices.
- Editing a single attendee shows a lighter, non-blocking note instead, since that only ever affects one person.
- Neither appears when nothing is actually installed yet.

**Two exceptions**

1. A voided pass is skipped by these pushes until it is restored *and* separately pushed again, because restoring only clears the void flag rather than refreshing content. The one exception is a save that changes the event's expiration (turning Pass expiration on, or changing the date, hours or time zone while it is on). That also gives voided passes the new expiration date.
2. A single-attendee edit pushes immediately, in the same request, rather than through the background job queue. So it never shows up in Event Settings → Wallet's "Wallet push history" list, which shows event-wide and bulk pushes only.

### Registration status

Whether an attendee has actually added the pass to their device (not just had one issued) is tracked from PassCreator. It is shown on Attendee Detail and in the Attendees list's Wallet column.

**How it is tracked**

- Through a webhook, with periodic polling as a fallback. The polling can take a while to reach any one attendee.
- Attendee Detail's wallet **Refresh status** action pulls that one attendee's current status immediately, instead of waiting for the periodic poll. It is useful when PassCreator's own dashboard already shows a pass as added but Admitto has not caught up yet.
- Only an active pass is checked. A voided pass keeps the last status it had. The periodic poll skips archived events (a manual **Refresh status** still works there).

**A pass voided at PassCreator**

- If PassCreator voids or expires a pass on its own, Admitto notices on the next check (or when PassCreator's void notification arrives) and marks the pass **Voided** here too.
- Until a PassCreator time zone setting exists, an expired pass shows as voided rather than expired.
- Right after you void or restore a pass in Admitto, PassCreator's answer is ignored for about ten minutes, so an out-of-date reply cannot undo your action.

**Platform visibility**

- Both surfaces show only the platforms that Event Settings → Wallet actually offers for that event.
- Turning the whole feature off hides the Wallet column and the Attendee Detail Wallet card entirely.
- Turning off just Apple or just Google Wallet drops that platform's icon and row everywhere, without affecting the other one.

**After Remove from provider.** The pass's last known registration counts are kept, but shown as "Was registered" rather than "Registered" on both surfaces. A removed pass is never read again, so this is a frozen snapshot from just before removal, not a live status.

### Wallet lifecycle actions

**Actions available**

- void
- push updates
- refresh status (active passes only)
- permanently delete a wallet pass at the provider, together with its local record
- restore
- once a pass is voided or expired: remove it from the provider, while keeping the local record and its Reports history

Revoking an attendee's ticket also voids their wallet pass automatically. Restoring the ticket restores the pass the same way. It follows the same rule as the manual **Restore wallet pass** action: it does nothing once the event is over.

**Single and bulk**

- Void, push updates, refresh status, delete and remove are available both from Attendee Detail (one attendee) and from the Attendees list (bulk, for a selection).
- Restore is available on Attendee Detail only. There is no bulk version of it.

**Delete or Remove?**

| Action | What it does |
|--------|--------------|
| **Delete** | Erases the wallet pass at the provider and the local record together, including its Reports history |
| **Remove from provider** | Deletes the pass at the provider only, and keeps the local record and history |

Remove from provider exists to stop the provider counting a no-longer-valid pass against its own plan, which void alone does not do. It is only offered once a pass is voided or expired, and it cannot be undone at the provider.

**Archived events and the Wallet switch.** Void, delete, remove and refresh status all still work on an archived event, and when the event's Wallet switch is off. So a pass can be wound down after an event has ended. Restore and push updates stay disabled there.

**Whole event at once**

- **Void active passes**, in the Attendees header menu, makes every active pass of the event show as invalid. It runs in the background and has no 100-attendee limit, unlike a selection. It follows the same rules as void on one attendee (it also works on an archived event and with the Wallet switch off). It leaves passes that are no longer active alone, and it can be run again to retry any that failed.
- **Remove inactive passes**, right next to it, does the same for **Remove from provider**. It removes every voided or expired pass of the event that has been inactive for at least a day, and keeps each pass's local record and Reports history.

**Automatic expiration.** Event Settings → Wallet's **Pass expiration** field can give every issued pass a real expiration date tied to the event's own end time. The pass then goes **Expired** on its own, instead of staying active indefinitely once the event is over. It is off by default. See the [template setup page](Wallet-Passes-PassCreator-Setup) for the template requirement and how to turn it on. An expired pass cannot be restored, the same as one whose event is already over.

**Rate and pacing limits**

- A bulk wallet action accepts at most 100 attendees per selection.
- Each attendee's pass is updated one call at a time, at a fixed pace, to stay within PassCreator's own request limit. It is not done all at once.
- So a bulk action on a large selection takes noticeably longer than the same action on one attendee, up to roughly 15 seconds to finish. This is expected, not a stuck page.

## What's not supported

- **Apple's "Enhanced" (poster) event ticket style**, the iOS 18+ lock-screen redesign with a live countdown. It requires NFC hardware and PassCreator account approval, and Apple's own documentation states that poster-style tickets are incompatible with QR/barcode-only entry. Admitto's check-in is QR/barcode-based, so this is not a "not yet". It is architecturally excluded unless the check-in model itself changes.
- **Samsung Wallet (partially).**
  - Event Settings → Wallet has a real, saveable Samsung Wallet switch next to Apple and Google. An attendee's ticket page shows an Add to Samsung Wallet button when it is on.
  - But PassCreator has not finished activating Samsung Wallet support on any template yet. So the button is not tappable, and no attendee can actually get a Samsung pass.
  - Once PassCreator finishes that activation, a follow-up Admitto change is still needed before the button becomes tappable. It has to read the real install-link field that PassCreator returns once activated, and wire it into the ticket page.
  - Registration-status display (the Attendees table, an attendee's Wallet card) already reads real PassCreator data and needs no further changes.

## Related pages

- [Wallet Passes - PassCreator Template Setup](Wallet-Passes-PassCreator-Setup) - the detailed field-mapping walkthrough
- [Event Overview and Settings](Event-Overview-and-Settings)
- [Pass Statuses](Pass-Statuses)
