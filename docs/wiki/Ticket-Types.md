# Ticket Types

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Create clear attendee categories used across the event lifecycle.

## Before you start

Decide which groups genuinely need different preparation, communication, check-in display, or reporting. Use short labels that operators can recognise quickly.

## Steps

1. Open **Event settings**, then **Ticket types**.
2. Select **Add ticket type**.
3. Replace **New type** with the intended label.
4. Choose a colour that helps staff distinguish the type.
5. Add the remaining types needed by the event.
6. Review attendee counts before removing or changing an existing type.
7. Use the configured label or key in attendee imports.

## Expected result

The ticket type appears consistently in attendee forms, imports, filters, communication, check-in, and reports.

## Important decisions

- A ticket type is an operational category, not an access role.
- Labels must be unique within the event.
- The stored key is created with the type and remains stable when its visible label changes.
- A type cannot be removed while attendees still use it.
- Do not create several labels for the same group only to correct spelling; rename the existing type.

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
