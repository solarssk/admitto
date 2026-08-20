# Managing Attendees

| Field | Value |
|---|---|
| **Audience** | Event Managers |
| **Required role** | Administrator |
| **Feature status** | Available |
| **Last verified** | Admitto 0.5.2 |

## What this page helps you do

Add one attendee, find and review attendee records, run bulk actions on a selection, and make supported attendee-level corrections (including GDPR erasure).

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

1. Use search (clear button clears the box) and filters, including mail delivery status when needed.
2. Choose how many rows per page to show.
3. On phones, attendees appear as cards; on desktop, as a table.
4. Use the single **Export** menu for approved exports of the current view.

### Bulk actions

1. Select one or more rows (or use the header checkbox for the page).
2. From the bulk bar, choose only the action you need:
   - **Send tickets**
   - **Check in** without scanning (asks for confirmation first, same as the other bulk actions below; can normally be undone afterward with **Revoke check-in**)
   - **Revoke check-in**, **Revoke items**, or **Revoke pass**
   - **Void wallet pass**, **Push updates**, or **Delete wallet pass** (only enabled when the selection includes at least one attendee who added a pass)
   - **Change ticket type** (also pushes the new type to any already-issued wallet passes in the selection, in the background) or **Change attendance status**
   - **Export** the selection as CSV
   - **Delete** selected attendees (GDPR erasure; confirmation with a delay)
3. Confirm when Admitto asks, then verify the list and a sample detail page.

### Review or update one attendee

1. Open the attendee detail page.
2. The profile is read-only until you open **Edit** in the header. Save profile changes from that dialog.
3. Review the status strip: **Pass**, Attendance, Ticket delivery, Check-in, and Wallet.
4. Use **Additional information** for custom fields, **Notes** for shared operator notes, and **Activity** for a plain-language history of changes.
5. Delivery history supports **View sent message** (rendered mail with ticket link redacted) and **View delivery details**.
6. Use the red **Revoke** control for revoke pass / revoke check-in. **More actions** holds **Resend ticket**, **Copy ticket link** (copies the attendee's existing ticket URL to the clipboard, without resending anything; fails without sending a new ticket if none has been issued yet - use **Resend ticket** first), **Revoke items**, **Delete attendee** (typed confirmation for GDPR erasure), and, once the attendee has added a wallet pass, **Void wallet pass**, **Push updates**, and **Delete wallet pass**. **Restore pass** asks for confirmation before applying. Revoking the attendee's pass also voids their wallet pass automatically, if they have one; restoring it does the same in reverse.

Use [Importing Attendees](Importing-Attendees) for a prepared list rather than adding many records one by one.

## Expected result

The attendee appears once in the event with accurate contact, ticket, and event-specific details. Bulk actions apply only to the selection you confirmed.

## Important decisions

- Correct an existing attendee instead of creating a duplicate.
- Treat pass state, delivery status, and check-in state as separate facts.
- Use notes only for event work that belongs on the attendee record.
- Change a pass state only when the event's authorised process requires it.
- **Delete attendee** permanently erases that person's event record for GDPR. Prefer revoke or status corrections when the person should stay in history.
- **Delete wallet pass** permanently removes the pass record at the provider, so it stops receiving updates - it does **not** remove the pass from the attendee's phone (Apple/Google Wallet gives no third party a way to do that; only the attendee can). It also does not affect check-in - use **Revoke pass** to block entry. The attendee would need to add a new pass from their ticket page. Prefer **Void wallet pass** when the person should be able to get it back.
- Export attendee information only for an approved event purpose.

## What changes after this action

Saved attendee details become available to templates, ticket rendering, filters, exports, and check-in. A pass-state change can immediately affect whether the ticket can be admitted. Deletion removes the attendee from the event permanently. A bulk ticket type change reports the wallet push outcome in a toast once it finishes; a pass that could not be reached stays on its previous ticket type until you retry with **Push updates**. Editing an attendee's name, email, company, department, or ticket type also refreshes their already-issued active wallet pass, if they have one - unlike the bulk ticket type change above, this push happens immediately and doesn't appear in Event settings → Wallet's Wallet push history list.

## Common problems

- **The attendee already exists:** search by email and other known identifiers before adding a new record.
- **A ticket type or custom field is missing:** configure it before editing or importing attendees.
- **The attendee cannot be admitted:** review the pass state and the on-screen check-in result; do not create a replacement record as a workaround.
- **A message did not arrive:** review delivery activity and [Email Delivery Statuses](Email-Delivery-Statuses).
- **Bulk actions are disabled:** the event may be archived, or your selection may not allow that action.

## Related pages

- [Importing Attendees](Importing-Attendees)
- [Requirements and Fulfilment](Requirements-and-Fulfilment)
- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
- [Manual Lookup and Corrections](Manual-Lookup-and-Corrections)
- [Pass Statuses](Pass-Statuses)
