# Event Overview and Settings

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.14

## What this page helps you do

Check whether an event is ready and maintain its supported event-level settings.

## Before you start

Open the correct organisation and event. If another manager may be editing the same event, agree who will make each change.

## Steps

### Overview

1. Open **Overview**.
2. Review the compact **Setup checklist** for unfinished setup.
3. Review KPI tiles (including attendees and **Failed delivery**), the **Check-in progress** ring with ticket-type breakdown, and **Recent activity** (check-ins, attendees added, item issue/return/revoke, mail failures, and imports).
4. Use **Pinned note**, **Key contacts**, and **Important links & files** when your event keeps that operational context on Overview.
5. Follow a readiness prompt when it points to unfinished setup.

### Event settings tabs

Event settings are organised into tabs. Each card that needs saving (Basic information, Location, Images, Mail transport) has its own **Save** / **Reset**. There is no single page-level Save.

1. Open **Event settings**, then **General**.
2. Review the title, event date, time zone, and capacity.
3. Leave capacity empty for an unlimited event, or enter the maximum number of attendees that may be added.
4. Save the General card.
5. Open **Location** to set the venue's name and address. Start typing a venue name or an address into the single search field. Matching places appear as you type; pick one to also set the map pin, or keep typing free text if nothing matches. Drag the pin or double-click the map to adjust it by hand. Add directions or accessibility notes if attendees need them. If Copy Google/Apple Maps opens the wrong place while the pin looks correct, use **Pin wrong? Fix link** to paste the correct Maps URLs (the pin and static map stay as they are).
6. Review **Ticket types** for the event's catalog (label + colour), not free-text guest types.
7. Review **Images** when the event needs them. On **Images**, drop or browse a logo to open the adjust popup, then drag the selection edges to trim margins and Apply. Use **Edit image** to reopen the adjust popup on the full upload, with the last crop and zoom restored, including after Save and page reload. Logos uploaded before crop persistence need one full-file upload the first time you re-crop; later crop and zoom edits restore from that saved original. External web-link logos cannot be re-cropped in Admitto. Extra named images for mail templates go through the same adjust step before **Add image**. Enter a normal image name; Admitto creates the `{{variable}}` for templates.
8. Return to **Overview** and confirm that the event now shows the intended state.

Tab inventory:

| Tab | Who | Purpose |
|-----|-----|---------|
| General | Organisation Admin | Title, date, time zone, capacity |
| Location | Organisation Admin | Venue, map pin, directions, accessibility |
| Ticket types | Organisation Admin | Event ticket-type catalog |
| Images | Organisation Admin | Logo, header, mail image assets |
| Mailing | Superadmin | Event mail transport and bounce detection |
| Wallet | Planned | Not part of the current event workflow |
| Integrations | Superadmin | Inbound tokens and related integrations |
| Danger zone | Organisation Admin (Archive/Delete: Superadmin) | Bulk revoke and lifecycle actions |

### Danger zone

1. Open **Event settings** → **Danger zone**.
2. Use **Revoke all check-ins** or **Revoke all items issued** only when the event process requires a bulk undo (each asks for confirmation).
3. Ask a Superadmin to **Archive event** when the event should become fully read-only.
4. **Delete event** is Superadmin-only. It is available when the event has no attendees and no event-specific content left to clear (custom items, custom ticket types, contacts, resources, pinned note, or additional named mail templates). A saved Ticket email override is removed with the event and does not block deletion. Operational history alone does not block delete. Confirming requires typing the event title.

## Expected result

The overview reflects the current event lifecycle, and saved settings are used by attendee, communication, reporting, and check-in pages.

## Important decisions

- The event slug (link name) is created once and cannot be edited later. It appears in agency ticket URLs (`/t/{link-name}/a/…`); ordinary tickets use `/t/{token}` without the link name.
- Capacity is managed here, not in the **New event** dialog. A blank capacity means unlimited.
- Use the event's real time zone. Report and activity times depend on it.
- **The Location tab is the only place to set an event's venue name and address.** General no longer has a separate location field. It also holds the map coordinates and directions/accessibility notes, and is optional. Leave it blank if a map is not needed for this event.
- Event-specific images override organisation images where the page explains that behaviour.
- Only a Superadmin can archive, restore, or delete an event.

## What changes after this action

Changes to the event title, date, time zone, capacity, or images become the current event configuration. A capacity change can affect future attendee additions and imports; it does not remove existing attendees. The **Location** tab's venue name and formatted address are attendee-facing on browser tickets. When the event has a map pin, the ticket also shows a map and links to Google Maps and Apple Maps (or any corrected links you pasted under **Pin wrong? Fix link**); directions and accessibility notes appear there when provided. Danger-zone revokes change recorded check-ins or issued items for the whole event.

## Common problems

- **A setting is missing:** check your role. Some tabs are Superadmin-only.
- **The capacity blocks an import:** ask an Organisation Admin to correct the event capacity. Use a Superadmin override only when the authorised limit must be exceeded.
- **The event is read-only:** an archived event cannot be changed or used for check-in. Ask a Superadmin to review its status.
- **Times look wrong:** verify the event time zone before changing source data.
- **The venue search on the Location tab finds nothing, or the map doesn't appear:** try a more specific name or address (for example add a city or country), or drop the pin directly on the map instead. If the map is missing entirely, this instance may have map display turned off; typing the venue name or address by hand still works. A banner asking to set up a Support contact is a reminder for a Superadmin to fill it in under Organisation settings → General. Search still works either way.
- **Google or Apple Maps opens the wrong place:** the OpenStreetMap pin can be correct while the generated deep link snaps to a nearby POI. On the Location tab, use **Pin wrong? Fix link**, paste the correct Google and/or Apple Maps URL, save the links, then save Location. Copy, browser tickets, and mail map tokens use those links; the pin and static map image are unchanged. Moving the pin or picking a different venue search result clears those pasted links so attendees are not sent to the previous place.

## Related pages

- [Create an Event](Create-an-Event)
- [First Event Checklist](First-Event-Checklist)
- [Ticket Types](Ticket-Types)
- [Requirements and Fulfilment](Requirements-and-Fulfilment)
- [Reports and Archiving](Reports-and-Archiving)
- [Mail Delivery Administration](Mail-Delivery-Administration)
