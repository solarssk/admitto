# Create an Event

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Create the event workspace before adding attendees, messages, requirements, or operators.

## Before you start

Prepare the event title, calendar date, timezone, and optional location. Choose a short **link name** that will remain suitable for the lifetime of the event.

> [!IMPORTANT]
> The **link name** appears in ticket web links and cannot be changed after the event is created.

## Steps

1. Open **Events**. Cards list events by date (past active events first, then upcoming).
2. Select **New event**. On an empty list, the button can read **Create event**.
3. Enter the **Event title**.
4. Review the auto-filled **Link name**. It is the short text used in ticket web links (for example `/t/summer-summit/…`). Use only lowercase letters, numbers, `_`, or `-`.
5. Select the **Event date** and **Event timezone** (shown with a **UTC±N** offset).
6. Add **Location** when it should appear on tickets and calendar information — start typing a venue name or address and pick a match from the suggestions, or type it in by hand.
7. Select **Create event**.

## Expected result

Admitto creates an active event and opens its **Attendees** page directly.

## Important decisions

- The creation form has a calendar date, not an event start time.
- Capacity is not part of this modal. New events remain unlimited until capacity is set in **Event settings**.
- The timezone controls event-day timestamps and reports; do not use the browser default without checking it.

## What changes after this action

The event becomes visible to Superadmins and Organisation Admins for its organisation. No attendees, operators, requirements, or messages are created automatically.

## Common problems

- **This link name is already in use:** choose another short name and submit again.
- **The wrong date or timezone was saved:** open **Event settings**, then **General**, and correct it before sending tickets.
- **Capacity is missing:** set it later in **Event settings**. Leave it blank there for unlimited capacity.

## Related pages

- [Event Overview and Settings](Event-Overview-and-Settings)
- [First Event Checklist](First-Event-Checklist)
