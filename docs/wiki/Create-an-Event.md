# Create an Event

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.13

## What this page helps you do

Create the event workspace before adding attendees, messages, requirements, or operators.

## Before you start

Prepare the event title, calendar date, timezone, and optional location. Choose a short **link name** that will remain suitable for the lifetime of the event.

> [!IMPORTANT]
> The **link name** is a permanent short ID for the event. It cannot be changed after create. It appears in **agency** ticket links (for example `/t/summer-summit/a/…`). Ordinary tickets use a private token only (`/t/…` with no link name in the path).

## Steps

1. Open **Events**. Cards list events by date (past active events first, then upcoming).
2. Select **New event**. On an empty list, the button can read **Create event**.
3. Enter the **Event title**.
4. Review the auto-filled **Link name**. Use only lowercase letters, numbers, `_`, or `-`. This ID is for agency ticket URLs and internal uniqueness; most attendees never see it in their ticket link.
5. Select the **Event date**.
6. Optionally set **Event hours — start** and **Event hours — end** (24-hour time, e.g. `18:00`–`22:00`). Leave both blank to omit a time-of-day range. This is shown on tickets and, when configured, wallet passes — it does not change the calendar date itself.
7. Select the **Event timezone** (shown with a **UTC±N** offset). You can search by city; Admitto stores a standard timezone ID such as `Europe/Warsaw` or `Asia/Kolkata`.
8. Optionally add **Location**. Start typing a venue name or address and pick a match, or type free text. If search finds nothing useful, you can still create the event and set the map pin and coordinates later under **Event settings**, **Location** tab.
9. Select **Create event**.

## Expected result

Admitto creates an active event and opens its **Overview** page directly.

## Important decisions

- The **Event date** is a calendar date. **Event hours — start/end** is a separate, optional time-of-day range shown on tickets (and later wallet passes) — set it if attendees need a specific start/end time, not just the day.
- Capacity is not part of this modal. New events remain unlimited until capacity is set in **Event settings**.
- The timezone controls event-day timestamps and reports; do not use the browser default without checking it.
- Location is optional at create time. Agency ticket links use the link name; ordinary `/t/{token}` tickets do not.

## What changes after this action

The event becomes visible to Superadmins and Organisation Admins for its organisation. No attendees, operators, requirements, or messages are created automatically.

## Common problems

- **This link name is already in use:** choose another short name and submit again.
- **The wrong date or timezone was saved:** open **Event settings**, then **General**, and correct it before sending tickets.
- **Capacity is missing:** set it later in **Event settings**. Leave it blank there for unlimited capacity.
- **Location search found nothing:** create the event, then open **Event settings**, **Location** tab to drop a pin and fill coordinates (and the display name) by hand.

## Related pages

- [Event Overview and Settings](Event-Overview-and-Settings)
- [First Event Checklist](First-Event-Checklist)
