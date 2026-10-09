# Managing Attendees

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.7.4

- [What this page helps you do](#what-this-page-helps-you-do)
- [Before you start](#before-you-start)
- [Steps](#steps)
  - [Add one attendee](#add-one-attendee)
  - [Find attendees on the list](#find-attendees-on-the-list)
  - [Bulk actions](#bulk-actions)
  - [Review or update one attendee](#review-or-update-one-attendee)
  - [Erase personal data (privacy requests)](#erase-personal-data-privacy-requests)
- [Expected result](#expected-result)
- [Important decisions](#important-decisions)
- [What changes after this action](#what-changes-after-this-action)
- [Common problems](#common-problems)
- [Related pages](#related-pages)

## What this page helps you do

Add one attendee, find and review attendee records, run bulk actions on a selection, and make supported attendee-level corrections, including erasing a person's personal data for a privacy request.

## Before you start

Open the correct event. Check its ticket types and custom attendee fields before adding data that depends on them.

## Steps

### Add one attendee

1. Open **Attendees**.
2. Select **Add attendee**.
3. Enter the required first name, last name, and email. Last name is required even for a single-name attendee.
4. Select a ticket type and complete any event-specific fields when needed.
5. Save the attendee.
6. Open the new record and check the displayed details.

### Find attendees on the list

1. Use search (clear button clears the box) and filters, including mail delivery status and any custom attendee fields defined for this event, when needed.
2. Choose how many rows per page to show.
3. On phones, attendees appear as cards; on desktop, as a table.
4. Use the single **Export** menu for approved exports of the current view.
5. Entries whose personal data has been erased are left out of the list. A line under the table says how many are hidden; select **Show erased** to list them too and **Hide erased** to leave them out again.

### Bulk actions

1. Select one or more rows (or use the header checkbox for the page).
2. From the bulk bar, choose only the action you need:
   - **Send tickets**
   - **Check in** without scanning (asks for confirmation first, same as the other bulk actions below; can normally be undone afterward with **Revoke check-in**)
   - **Revoke check-in**, **Revoke items**, or **Revoke pass**
   - **Void wallet pass**, **Push updates**, **Refresh status**, **Delete wallet pass**, or **Remove from provider** (only enabled when the selection includes at least one attendee who added a pass)
   - **Change ticket type** (also pushes the new type to any already-issued wallet passes in the selection, in the background), **Change attendance status**, **Set company**, or **Set department** (types one value and applies it to every selected attendee)
   - **Export** the selection as CSV
   - **Erase personal data** of the selected people (for privacy requests; see [Erase personal data](#erase-personal-data-privacy-requests))
   - **Delete** selected attendees (permanently removes them from the event, and from Reports)
3. Confirm when Admitto asks, then verify the list and a sample detail page.

### Review or update one attendee

1. Open the attendee detail page.
2. The profile is read-only until you open **Edit** in the header. Save profile changes from that dialog.
3. Review the status strip: **Pass**, Attendance, Ticket delivery, Check-in, and Wallet.
4. Use **Additional information** for custom fields, **Notes** for shared operator notes, and **Activity** for a plain-language history of changes, newest first. Activity is paged like the other tables: pick **Rows per page** (10, 25, 50, or 100) and use **Previous** and **Next** at the bottom to reach older entries. While you browse older pages the list stays fixed even if colleagues add entries; go back to page 1 to see the newest. The tab you are on is kept in the page address (`?tab=activity` or `?tab=notes`), so you can bookmark or share a link that opens straight to it.
5. Delivery history supports **View sent message** (the rendered mail exactly as sent, including the real ticket link and QR code) and **View delivery details**.
6. Use the red **Revoke** control for revoke pass / revoke check-in. **More actions** holds:
   - **Resend ticket**
   - **Copy ticket link**: copies the attendee's ticket URL to the clipboard without sending anything. It issues the ticket first if it hasn't been issued yet, so this works even for an attendee who has never been sent a mail. It fails only when a ticket can never be issued: for a cancelled or revoked attendee, or an agency-imported attendee missing its reference.
   - **Revoke items**
   - **Erase personal data** (typed confirmation; for a privacy request, see below)
   - **Delete attendee** (typed confirmation; removes the whole entry)
   - Once the attendee has added a wallet pass: **Void wallet pass**, **Push updates**, **Refresh status**, **Delete wallet pass**, and **Remove from provider** (shown greyed out until the pass is voided or expired). A pass that has expired only offers **Delete wallet pass** and **Remove from provider** - expiry is permanent, so there is no Restore, Push updates, or Refresh status for it.

   **Restore wallet pass** is only offered until the event is over (and never on an archived event), because a pass must not become valid again after it. **Restore wallet pass** asks for confirmation before applying; **Refresh status** does not, since it only reads from the provider. Revoking the attendee's pass also voids their wallet pass automatically, if they have one; restoring it does the same in reverse.

### Erase personal data (privacy requests)

Use this when a person asks for their personal data to be erased and your organisation has confirmed that it must be. The entry stays in the event as an anonymous attendee, so the numbers in Reports do not change.

1. Open the attendee, then **More actions** and **Erase personal data**. For several people, select their rows on the **Attendees** list, then **More actions** in the bulk bar and **Erase personal data**.
2. Read what the dialog says is erased and what stays. For one person, type their name to confirm; for a selection there is no name to type.
3. Select **Erase personal data**. It cannot be undone, and it works on an archived event too.
4. If the dialog **Personal data erased** says a wallet pass is still at the provider, everything personal inside Admitto is already gone. Select **Try again** to repeat only the wallet step.

The attendee page of an erased person is read-only. It shows **Erased** in place of the name, email, company, custom fields and notes, keeps the ticket type, the check-in time to the hour and the ticket delivery result, and offers **Try again** next to a pass that is still to be deleted at the provider.

Use [Importing Attendees](Importing-Attendees) for a prepared list rather than adding many records one by one.

## Expected result

The attendee appears once in the event with accurate contact, ticket, and event-specific details. Bulk actions apply only to the selection you confirmed.

## Important decisions

- Correct an existing attendee instead of creating a duplicate.
- Treat pass state, delivery status, and check-in state as separate facts.
- Use notes only for event work that belongs on the attendee record.
- Change a pass state only when the event's authorised process requires it.
- **Erase personal data** is for privacy requests. It removes the name, email, company, notes, custom answers, ticket link, copies of the messages sent, the wallet pass at the provider and the person's address in saved import results, and keeps an anonymous entry so counts, capacity and the hourly chart do not move. A person who had not checked in yet on an event that is not archived is marked cancelled, so their place becomes free. The check-in time is kept to the hour.
- **Delete attendee** permanently removes the whole entry, so Reports change too. Use it for a mistake, a duplicate or a test person, not for a privacy request. Prefer revoke or status corrections when the person should stay in history.
- **Delete wallet pass** permanently deletes the pass at the provider **and** erases the local record, including its Reports history (whether it was ever installed, registration counts). Prefer **Remove from provider** below when that history should stay.
- **Remove from provider**, offered once a pass is voided or expired, permanently deletes the pass at the provider while keeping the local record and its Reports history intact - unlike **Delete wallet pass**. This is what actually stops the provider counting the pass towards its own plan; **Void wallet pass** alone does not. It cannot be undone at the provider, so use it once you are done tracking that pass there. The attendee's Wallet card and the Attendees list then show its registration counts as "Was registered" instead of "Registered", since they are the pass's last known snapshot, not a live read.
- Neither **Delete wallet pass** nor **Remove from provider** removes the pass from the attendee's phone (Apple/Google Wallet gives no third party a way to do that; only the attendee can), and neither affects check-in. Use **Revoke pass** to block entry.
- After **Delete wallet pass**, the attendee would need to add a new pass from their ticket page. Prefer **Void wallet pass** when the person should be able to get it back.
- Once a pass is confirmed installed, the attendee's Wallet card shows an **Added from** row with the browser and OS that installed it (for example "Safari 18.7 / iOS 18.7"). It only appears for a pass confirmed after this was introduced, and never for a link a mail security scanner merely pre-fetched; passes confirmed earlier stay without it.
- **Refresh status** pulls that attendee's current status directly from the provider, immediately. Use it when the provider's own dashboard already shows a pass as added but Admitto's Wallet column or Attendee Detail hasn't caught up yet, instead of waiting for the periodic background check to reach that attendee. It is offered for an active pass only (a voided or expired pass keeps the status it had). If the provider now reports the pass voided or expired, Admitto marks it **Voided**.
- **Void wallet pass**, **Delete wallet pass**, **Remove from provider**, and **Refresh status** all still work on an archived event or with the event's Wallet switch off - useful for winding down wallet passes once an event has ended. **Restore wallet pass** and **Push updates** stay disabled there; reopen the event or turn Wallet back on first.
- Attendees' header **More actions** also has a **Push updates** for the whole event, not just a selection. Use it when a pass needs refreshing but nothing wallet-relevant technically changed (Event Settings' own automatic push only fires on an actual field change).
  - Appears once this event has Wallet configured. The run shows up in Event Settings → Wallet's push history as "Whole event · manual push".
- Attendees' header **More actions** also has a **Refresh status** for the whole event, not just a selection. It pulls the current status for every active wallet pass under the event at once, running in the background with a summary toast once it finishes. Voided and expired passes are skipped.
  - Appears once this event has Wallet configured, and stays available on an archived event.
- Attendees' header **More actions** also has **Void active passes**. It makes every active wallet pass of the event show as invalid in one go (a selection is limited to 100 attendees). It asks first, then runs in the background and shows a summary when it is done: how many passes were voided, how many were left alone because they were no longer active, and how many could not be voided (run it again to try those once more). The pass stays on the attendee's phone and their ticket is not changed. You can restore a single pass from the attendee's page while Wallet is on for this event and the event has not ended. Attendees who have not added a pass yet can still add one under the same conditions; to stop that, a Superadmin can turn Wallet off in Event settings. It is not the same as **Remove from provider** or **Delete wallet pass**, which erase the pass from the wallet service for good.
  - Appears once this event has Wallet configured, and works on an archived event and with the Wallet switch off, like **Void wallet pass**.
  - If someone restores a pass while the run is voiding it, the restore wins: that pass stays active and is counted as left alone.
  - Only one run at a time per event: while one is running, starting another says so and waits. When it has finished, run it again if you want it to catch passes that became active in the meantime.
- Attendees' header **More actions** also has **Remove inactive passes**. It removes every voided or expired wallet pass of the event from the wallet service, once it has stayed inactive for at least a day (counted from when it was voided or expired), in one go (a selection is limited to 100 attendees). It asks first, then runs in the background and shows a summary when it is done: how many passes were removed, how many were left alone because they had changed since, and how many could not be removed (run it again to try those once more). Unlike **Delete wallet pass**, it keeps each pass's local record and its history in Reports.
  - Appears once this event has Wallet configured, and works on an archived event and with the Wallet switch off, like **Remove from provider**.
  - Only removes passes that have been voided or expired for at least a day - a safety margin before something irreversible at the wallet service. A pass restored in that window is never touched. **Remove from provider** on one attendee has no such waiting time.
  - Only one run at a time per event, same as **Void active passes** above.
- Export attendee information only for an approved event purpose.

## What changes after this action

- Saved attendee details become available to templates, ticket rendering, filters, exports, and check-in.
- A pass-state change can immediately affect whether the ticket can be admitted.
- Deletion removes the attendee from the event permanently.
- Erasing personal data cannot be undone. The entry cannot be edited, sent to, checked in or given a pass again, is left out of the list unless you show erased entries, and is left out of exports and mail audiences.
- A bulk ticket type change reports the wallet push outcome in a toast once it finishes. A pass that could not be reached stays on its previous ticket type until you retry with **Push updates**.
- Editing an attendee's name, email, company, department, or ticket type also refreshes their already-issued active wallet pass, if they have one. Unlike the bulk ticket type change above, this push happens immediately and doesn't appear in Event settings → Wallet's Wallet push history list.

## Common problems

- **The attendee already exists:** search by email and other known identifiers before adding a new record.
- **A ticket type or custom field is missing:** configure it before editing or importing attendees.
- **The attendee cannot be admitted:** review the pass state and the on-screen check-in result; do not create a replacement record as a workaround.
- **A message did not arrive:** review delivery activity and [Email Delivery Statuses](Email-Delivery-Statuses).
- **Bulk actions are disabled:** the event may be archived, or your selection may not allow that action.
- **A person is missing from the list:** their personal data may have been erased. Check the line under the table for hidden erased entries and select **Show erased**.
- **The wallet pass is still at the provider after an erasure:** the provider could not be reached. Select **Try again** in the dialog, or open the erased entry and use **Try again** next to the pass. If it keeps failing, check the wallet connection in Event settings, or delete the pass in the provider's own console.

## Related pages

- [Importing Attendees](Importing-Attendees)
- [Requirements and Fulfilment](Requirements-and-Fulfilment)
- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
- [Manual Lookup and Corrections](Manual-Lookup-and-Corrections)
- [Pass Statuses](Pass-Statuses)
