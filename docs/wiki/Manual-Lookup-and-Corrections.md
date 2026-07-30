# Manual Lookup and Corrections

> **Audience:** Check-in Operators and Event Managers
> **Required role:** Check-in Operator for lookup; Organisation Admin for administrative corrections
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Find an attendee without a working QR and correct a recent check-in or item action within your role.

## Before you start

- Manual lookup must be enabled in **Requirements**.
- Ask for enough information to identify the correct attendee.
- Use your own account and the correct event.

## Steps

1. Enter part of the attendee's name or email in the lookup field.
2. If several results appear, narrow the search.
3. Select the record and compare the displayed details with the attendee.
4. Confirm check-in only when the record is correct and the pass is allowed.
5. Immediately after a valid admission on this device, use **Undo** only when that last admission was a mistake.
6. Ask an Organisation Admin to revoke another admission or reset an issued item when the operator correction is not available.

## Expected result

Manual lookup opens the same attendee card and status rules as scanning. Undo returns the last valid admission made on that device to a pre-check-in state.

## Important decisions

- **Undo** is device-scoped and applies to the latest valid admission on that device.
- An admin correction can revoke a specific attendee's admission regardless of device.
- Operators can mark offered item transitions. Resetting an already issued or returned item is an admin action.
- No result does not prove that the person is not invited; confirm spelling and the selected event.

## What changes after this action

Manual admission records the manual method. Undo or administrative revoke adds a correction to the event history; it does not delete the original audit trail.

## Common problems

- **Manual lookup is missing:** the event has disabled it; ask an Organisation Admin to review check-in behaviour.
- **Multiple matches appear:** add more of the name or email.
- **No match appears:** check spelling and event selection. Do not create a duplicate at the entrance.
- **Undo is not offered:** the displayed admission may not be the latest one on this device; ask an admin for a targeted correction.

## Related pages

- [Scanning Tickets and Check-in Results](Scanning-Tickets-and-Results)
- [Ticket Types and Requirements](Ticket-Types-and-Requirements)
