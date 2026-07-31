# Event Overview and Settings

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Check whether an event is ready and maintain its supported event-level settings.

## Before you start

Open the correct organisation and event. If another manager may be editing the same event, agree who will make each change.

## Steps

1. Open **Overview** and review attendee, delivery, check-in, and recent activity information.
2. Follow a readiness prompt when it points to unfinished setup.
3. Open **Event settings**, then **General**.
4. Review the title, event date, time zone, and capacity.
5. Leave capacity empty for an unlimited event, or enter the maximum number of attendees that may be added.
6. Save the General card.
7. Open **Location** to set the venue's name and address. Start typing a venue name or an address into the single search field — matching places appear as you type; pick one to also set the map pin, or keep typing free text if nothing matches. Drag the pin or click elsewhere on the map to adjust it by hand. Add directions or accessibility notes if attendees need them.
8. Review **Ticket types** and **Images** when the event needs them.
9. Return to **Overview** and confirm that the event now shows the intended state.

Superadmins can also see event-level **Mailing** and **Integrations** settings. Wallet settings are planned and are not part of the current event workflow.

## Expected result

The overview reflects the current event lifecycle, and saved settings are used by attendee, communication, reporting, and check-in pages.

## Important decisions

- The event slug is created once and cannot be edited later.
- Capacity is managed here, not in the **New event** dialog. A blank capacity means unlimited.
- Use the event's real time zone. Report and activity times depend on it.
- **The Location tab is the only place to set an event's venue name and address** — General no longer has a separate location field. It also holds the map coordinates and directions/accessibility notes, and is optional — leave it blank if a map isn't needed for this event.
- Event-specific images override organisation images where the page explains that behaviour.
- Only a Superadmin can archive or restore an event.

## What changes after this action

Changes to the event title, date, time zone, capacity, or images become the current event configuration. A capacity change can affect future attendee additions and imports; it does not remove existing attendees. The **Location** tab's venue name, address, map pin, and directions/accessibility notes are saved with the event; they don't yet appear on tickets or other attendee-facing pages.

## Common problems

- **A setting is missing:** check your role. Some tabs are Superadmin-only.
- **The capacity blocks an import:** ask an Organisation Admin to correct the event capacity. Use a Superadmin override only when the authorised limit must be exceeded.
- **The event is read-only:** an archived event cannot be changed or used for check-in. Ask a Superadmin to review its status.
- **Times look wrong:** verify the event time zone before changing source data.
- **The venue search on the Location tab finds nothing, or the map doesn't appear:** try a more specific name or address (e.g. add a city or country), or drop the pin directly on the map instead. If the map is missing entirely, this instance may have map display turned off; typing the venue name or address by hand still works. A banner asking to set up a Support contact is a reminder for a Superadmin to fill it in under Instance settings → General — search still works either way.

## Related pages

- [Create an Event](Create-an-Event)
- [First Event Checklist](First-Event-Checklist)
- [Requirements and Fulfilment](Requirements-and-Fulfilment)
- [Reports and Archiving](Reports-and-Archiving)
