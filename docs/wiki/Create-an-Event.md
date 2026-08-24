# Create an Event

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.5.0

## What this page helps you do

Create the event workspace before adding attendees, messages, requirements, or operators.

## Before you start

Prepare the event title, calendar date, timezone, and optional location.

> [!NOTE]
> Admitto creates a short permanent ID from the title automatically (used in agency ticket links such as `/t/summer-summit/a/…`). Ordinary tickets use a private token only (`/t/…`). You do not choose that ID in the New event form. Titles without Latin letters or digits (for example Cyrillic-only) still get a unique `event-…` ID so Create stays available.

## Steps

1. Open **Events**. Cards list events by date (past active events first, then upcoming).
2. Select **New event**. On an empty list, the button can read **Create event**.
3. Enter the **Event title**.
4. Select the **Event date** and **Event timezone** (shown with a **UTC±N** offset). Search by city (for example Warsaw); Admitto saves the official region clock for that place (shown as `Europe/Warsaw`) so event times and reports stay correct.
5. Optionally set **Event hours (start)** and **Event hours (end)** in your account's selected 12-hour (AM/PM) or 24-hour format. Set either value independently, or set both for a range. Leave both blank to omit event hours. The configured value appears on tickets and, when configured, wallet passes; it does not change the calendar date itself.
6. Optionally add **Location**. Start typing a venue name or address and pick a match, or type free text. If search finds nothing useful, you can still create the event and set the map pin and coordinates later under **Event settings**, **Location** tab.
7. Select **Create event**.

## Expected result

Admitto creates an active event and opens its **Overview** page directly.

## Important decisions

- The **Event date** is a calendar date. **Event hours (start/end)** is a separate, optional time-of-day range shown on tickets (and later wallet passes): set it if attendees need a specific start/end time, not just the day.
- Capacity is not part of this modal. New events remain unlimited until capacity is set in **Event settings**.
- The timezone controls event-day timestamps and reports; do not use the browser default without checking it.
- Location is optional at create time. Agency ticket links use the auto-generated event ID; ordinary `/t/{token}` tickets do not.

## What changes after this action

The event becomes visible to Superadmins and Organisation Admins for its organisation. No attendees, operators, requirements, or messages are created automatically.

## Common problems

- **An event with a similar name already exists:** change the title slightly and submit again.
- **The wrong date or timezone was saved:** open **Event settings**, then **General**, and correct it before sending tickets.
- **Capacity is missing:** set it later in **Event settings**. Leave it blank there for unlimited capacity.
- **Location search found nothing:** create the event, then open **Event settings**, **Location** tab to drop a pin and fill coordinates (and the display name) by hand.

## Related pages

- [Event Overview and Settings](Event-Overview-and-Settings)
- [First Event Checklist](First-Event-Checklist)
