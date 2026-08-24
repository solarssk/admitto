# Ticket Types

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.5.1

## What this page helps you do

Create the event's ticket-type catalog (label + colour). Free-text guest types are no longer used; attendee forms, imports, filters, check-in, and reports read only from this catalog.

## Before you start

Decide which groups genuinely need different preparation, communication, check-in display, or reporting. Use short labels that operators can recognise quickly.

## Steps

1. Open **Event settings**, then **Ticket types**.
2. Select **Add ticket type**, type the intended label, and choose a colour that helps staff distinguish the type.
3. Add the remaining types needed by the event, or edit an existing type's label or colour.
4. Select **Save** to apply the new types and any label/colour edits, or **Reset** to discard them. Leaving the page with unsaved additions or edits prompts for confirmation.
5. Review attendee counts before removing an existing type. Select its trash icon and confirm - removal takes effect immediately and does not wait for Save.
6. Use the configured label or key in attendee imports.

## Expected result

The ticket type appears consistently in attendee forms, imports, filters, communication, check-in, and reports.

## Important decisions

- A ticket type is an operational category, not an access role.
- Labels must be unique within the event.
- The stored key is created with the type and remains stable when its visible label changes.
- A type cannot be removed while attendees still use it.
- Do not create several labels for the same group only to correct spelling; rename the existing type.
- Adding a type or editing its label/colour is staged in the page until you select **Save**; it is not sent to the server before that. Removing a type is the exception - it takes effect immediately once confirmed.

## What changes after this action

New types become available for attendee assignment and event filters. Label and colour changes update how the type is presented throughout the event without changing attendee identity.

## Common problems

- **The label is already used:** choose a distinct label or edit the existing type.
- **The type cannot be removed:** reassign every attendee that still uses it, then try again.
- **An import rejects the value:** use the configured label or key and validate the file again.
- **The event is archived:** ticket types are read-only until a Superadmin restores the event.

## Related pages

- [Custom Attendee Fields](Custom-Attendee-Fields)
- [Import File Reference](Import-File-Reference)
- [Importing Attendees](Importing-Attendees)
- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
