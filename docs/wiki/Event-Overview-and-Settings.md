# Event Overview and Settings

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.7.4

- [What this page helps you do](#what-this-page-helps-you-do)
- [Before you start](#before-you-start)
- [Steps](#steps)
  - [Overview](#overview)
  - [Event settings tabs](#event-settings-tabs)
  - [Danger zone](#danger-zone)
- [Expected result](#expected-result)
- [Important decisions](#important-decisions)
- [What changes after this action](#what-changes-after-this-action)
- [Common problems](#common-problems)
- [Related pages](#related-pages)

## What this page helps you do

Check whether an event is ready and maintain its supported event-level settings.

## Before you start

Open the correct organisation and event. If another manager may be editing the same event, agree who will make each change.

## Steps

### Overview

1. Open **Overview**.
2. Review the **Setup checklist**.
   - Its bar and the **N of M done** count show progress.
   - The bar turns amber or red when a check needs attention.
   - Problems are listed first, and each row opens the page where you fix it.
3. Review the KPI tiles (including attendees and **Failed delivery**), the **Check-in progress** card, and **Recent activity**. Recent activity covers check-ins, attendees added, item issue, return and revoke, mail failures, and imports.
4. Use **Pinned note**, **Key contacts** and **Important links & files** when your event keeps that operational context on Overview.
5. Follow a readiness prompt when it points to unfinished setup.

A key contact is checked when you save it:

- The phone number takes digits only: 3 to 15 in total. Spaces, dashes, dots, parentheses and a leading + are allowed. Letters cannot be typed.
- The email must be a valid address.

**What Check-in progress shows**

- How many attendees have checked in.
- The rest are **not yet arrived** while the event can still fill up, and **no-shows** once it is over. "Over" means after its end time when one is set in Event settings, otherwise at the end of its day.
- Below it, **Last check-in** sits next to **Wallet passes installed** when the event uses wallets (a template and API key are saved, and Apple or Google is switched on). Without wallets, it sits next to **Busiest hour**.
- **Wallet passes installed** counts attendees whose pass was confirmed on a device at any point. It does not drop if someone later removes the pass.
- Breakdowns by ticket type or by hour are in **Reports**.

### Event settings tabs

Each card that needs saving (Basic information, Location, Ticket types, Images, Mail transport) has its own **Save** and **Reset**. There is no single page-level Save.

| Tab | Who | Purpose |
|-----|-----|---------|
| General | Organisation Admin | Title, date, time zone, capacity, event type |
| Location | Organisation Admin | Venue, map pin, directions, accessibility, access points |
| Ticket types | Organisation Admin | Event ticket-type catalog |
| Images | Organisation Admin | Logo, header, mail image assets |
| Check-in | Organisation Admin | Scan, manual lookup and item behaviour. See [Event Items and Check-in Behaviour](Event-Items-and-Check-in-Behaviour) |
| Mailing | Superadmin | Event mail transport and bounce detection |
| Wallet | Superadmin | Per-event PassCreator API key, template, and Apple and Google toggles |
| Integrations | Superadmin | Not yet built. A placeholder for future inbound API connections |
| Danger zone | Superadmin (an Organisation Admin can open the tab, but its actions are disabled) | Export personal data, bulk revoke, archive or restore, and delete |

#### General

1. Open **Event settings**, then **General**.
2. Review the title, event date, time zone and capacity.
3. Optionally set **Event hours (start/end)** between the date and time zone fields, in your account's selected 12-hour (AM/PM) or 24-hour format. Set either value alone, or both for a time-of-day range. The range is shown on tickets, separately from the calendar date. Leave both blank to omit event hours.
4. Optionally choose an **Event type** (Conference, Workshop, Social gathering and similar). It reaches a wallet pass only once it is mapped in **Wallet**'s Field mapping. For Siri Suggestions, Maps and Calendar smart data (Apple's Semantic Tags), the mapped value must also be bound inside PassCreator's own Semantic Tags panel. See [Wallet Passes - PassCreator Template Setup](Wallet-Passes-PassCreator-Setup).
5. Leave capacity empty for an unlimited event, or enter the maximum number of attendees that may be added.
6. Save the General card.

#### Location

1. Open **Location** to set the venue's name and address.
2. Start typing a venue name or an address in the single search field. Matching places appear as you type. Pick one to also set the map pin, or keep typing free text if nothing matches.
3. Drag the pin, or double-click the map, to adjust it by hand. Add directions or accessibility notes if attendees need them.
4. If Copy Google/Apple Maps opens the wrong place while the pin looks correct, use **Pin wrong? Fix link**. Paste the correct Maps URLs. The pin and the static map stay as they are.
5. Below that, **Venue access details** holds optional venue details and access-point opening times:
   - venue details: room or hall, entrance, door, gate or portal names, phone number, Apple Maps place ID
   - opening times: venue, doors, gates, box office, parking lots, fan zone, in a collapsible **Opening hours** section

All of these are used only once they are mapped in **Wallet**'s Field mapping. It is the same two-step Semantic Tags process as for Event type above.

#### Ticket types

- Review the event's catalog (label and colour), not free-text guest types.
- Adding a type, or editing a label or colour, is staged until you select **Save**. **Reset** discards it.
- Removing a type takes effect immediately once confirmed. It does not wait for Save.

#### Images

- Drop or browse a logo to open the adjust popup. Drag the selection edges to trim margins, then Apply.
- **Edit image** reopens the adjust popup on the full upload, with the last crop and zoom restored. This also works after Save and a page reload.
- A logo uploaded before crop persistence needs one full-file upload the first time you re-crop. Later crop and zoom edits restore from that saved original.
- External web-link logos cannot be re-cropped in Admitto.
- Extra named images for mail templates go through the same adjust step before **Add image**. Each one gets its own **Edit** button in **Your images**. It reopens the adjust popup on the original upload with the last crop restored, the same way **Edit image** works for the logo.
- Images added before this capability existed have no stored original, so **Edit** re-crops the already-cropped image.
- Enter a normal image name. Admitto creates the `{{variable}}` for templates.

When you are done, return to **Overview** and confirm that the event shows the intended state.

#### Wallet (Superadmin)

**API key and Template ID**

- Superadmins set the PassCreator **API key** and **Template ID** on **Wallet**. Both are stored for this event. Use **Test connection** to check the key and template against PassCreator before you save.
- **The Template ID locks (cannot be edited) once any wallet pass has been issued for the event.** The wallet provider cannot move an issued pass to a different template, so changing it would leave those passes unmanageable.
- The **API key** stays editable after passes are issued, subject to the event's normal read-only rules (a leaked key must still be rotatable). Saving a new key for an event with issued passes first re-verifies it against the currently configured template. It is rejected if it cannot reach that template.

**Platform toggles and confirmations**

- A header switch turns the whole feature on or off for the event.
- Independent **Apple Wallet** and **Google Wallet** switches turn off either platform without clearing the API key or template. Use them when only one platform is ready, or to pause one for a while.
- **Header switch off, on an event with issued passes:** it asks for confirmation first. It stops syncing, restoring and pushing for those passes. Voiding, removing and deleting them still work. PassCreator's own notifications (a device registration, or a pass voided or expired) are still read and applied. Only the periodic background check pauses, and it resumes once the switch is back on.
- **One platform off, when attendees already added it:** it also asks first. It hides that platform's Add to Wallet button for new attendees. Its status disappears from the Attendees list and the attendee detail pages, instead of showing "not added", until it is turned back on. Nothing changes on attendees' devices. The one exception is turning off Apple Wallet when it also triggers the Lock Screen relevance-date push described next. In that case the confirmation says so.
- Saving with Apple Wallet enabled on an event that has a start time also sets PassCreator's Lock Screen relevance date automatically. No field mapping is needed for this.
- See [Wallet Passes Overview](Wallet-Passes-Overview) for what this covers.

**Field mapping**

- **Field mapping** assigns each selected attendee or event value to the matching PassCreator template property key. This includes Event type and the Location tab's Venue access details, which power Apple's Semantic Tags (Siri Suggestions, Maps and Calendar smart surfaces).
- There is no default mapping. Every value shown on the pass, including the attendee's name, must be mapped explicitly.
- A correct API key and Template ID are not enough on their own. The PassCreator template itself needs matching fields first. See [Wallet Passes - PassCreator Template Setup](Wallet-Passes-PassCreator-Setup).
- PassCreator API keys inherit the permissions of the account that created them, not a fixed scope to one template. For real isolation between events, use a dedicated PassCreator service user whose own permissions are limited to that event's template.

**Wallet push history**

- Below the Wallet card, **Wallet push history** lists the event's pushes, newest first, paginated.
- Pushes trigger automatically from a bulk ticket type change, or from saving a wallet-relevant event settings or location field.
- You can also push by hand: **Attendees** → **More actions** → **Push updates**. It pushes to every already-installed pass across the whole event at once. Use it when nothing wallet-relevant changed but a pass still needs refreshing.
- Each entry shows:
  - when it ran, in UTC, with the triggering admin's own local time underneath when known (it is a server action, not tied to the event's venue time zone)
  - its **Scope**: the number of specific attendees pushed, or "Whole event" plus which kind of save triggered it
  - how many passes were updated, skipped or errored
- Single-attendee edits push immediately and do not appear in this list.

### Danger zone

1. Open **Event settings** → **Danger zone**.
2. Ask a Superadmin to use **Revoke all check-ins** or **Revoke all items issued** only when the event process requires a bulk undo. Each asks for confirmation.
3. Ask a Superadmin to **Archive event** when the event should become fully read-only.
   - If the event has wallet passes that are voided or expired but still at the wallet service, the confirmation says how many. Archiving does not remove them.
   - **Remove inactive passes** on Attendees clears the ones voided or expired for at least a day. **Remove from provider**, per attendee or for a selection, reaches the rest, including any from the last day. Both work before or after archiving.
4. **Delete event** is Superadmin-only.
   - It is available when the event has no attendees and no event-specific content left to clear: custom items, custom ticket types, contacts, resources, pinned note, or additional named mail templates.
   - A saved Ticket email override is removed with the event and does not block deletion. Operational history alone does not block delete.
   - Deleting the event also deletes the export files and import files that its jobs left behind.
   - Confirming requires typing the event title.

## Expected result

The overview reflects the current event lifecycle, and saved settings are used by attendee, communication, reporting, and check-in pages.

## Important decisions

- The event slug (link name) is created once and cannot be edited later. It appears in agency ticket URLs (`/t/{link-name}/a/…`). Ordinary tickets use `/t/{token}` without the link name.
- Capacity is managed here, not in the **New event** dialog. A blank capacity means unlimited.
- Use the event's real time zone. Report and activity times depend on it.
- **The Location tab is the only place to set an event's venue name and address.** General no longer has a separate location field. The Location tab also holds the map coordinates and the directions and accessibility notes. It is optional. Leave it blank if the event needs no map.
- Event-specific images override organisation images where the page explains that behaviour.
- Only a Superadmin can archive, restore or delete an event.

## What changes after this action

- Changes to the event title, date, event hours, time zone, capacity or images become the current event configuration.
- A capacity change can affect future attendee additions and imports. It does not remove existing attendees.
- **On browser tickets:**
  - Event hours (start, end or range) appear next to the date when provided.
  - The **Location** tab's venue name and formatted address are attendee-facing.
  - When the event has a map pin, the ticket also shows a map, with links to Google Maps and Apple Maps (or any corrected links you pasted under **Pin wrong? Fix link**).
  - Directions and accessibility notes appear there when provided.
- **On wallet passes:** when the event has Wallet configured, saving a change to the title, date, event hours, time zone, venue, address, coordinates, directions, accessibility notes or Maps links also refreshes every attendee's already-issued active wallet pass in the background. It works the same way as a bulk ticket type change.
- Actions in the Danger zone can revoke recorded check-ins or issued items for the whole event.

## Common problems

| Problem | What it means and what to do |
|---------|------------------------------|
| **A setting is missing** | Check your role. Some tabs are Superadmin-only |
| **The capacity blocks an import** | Ask an Organisation Admin to correct the event capacity. Use a Superadmin override only when the authorised limit must be exceeded |
| **The event is read-only** | An archived event cannot be changed or used for check-in, and its **Overview** page shows an archived notice. Ask a Superadmin to review its status. A Superadmin can restore it with **Restore event** in that notice |
| **Times look wrong** | Verify the event time zone before changing source data |
| **The venue search on the Location tab finds nothing, or the map does not appear** | Try a more specific name or address (for example, add a city or country), or drop the pin directly on the map. If the map is missing entirely, this instance may have map display turned off. Typing the venue name or address by hand still works. A banner asking you to set up a Support contact is a reminder for a Superadmin to fill it in under Organisation settings → General. Search still works either way |
| **Google or Apple Maps opens the wrong place** | The OpenStreetMap pin can be correct while the generated deep link snaps to a nearby place of interest. On the Location tab, use **Pin wrong? Fix link**. Paste the correct Google and/or Apple Maps URL, save the links, then save Location. Copy, browser tickets and mail map tokens use those links. The pin and the static map image are unchanged. Moving the pin or picking a different venue search result clears the pasted links, so attendees are not sent to the previous place |

**A page shows grey cards, says "Taking longer than usual", or shows a "Could not load…" error**

The data is being read from the server. Wait a moment and check your connection. After 30 seconds the page stops waiting and shows an error with a **Retry** button. The button stays on screen, busy, until the answer is in.

- **Overview:** the header and the archived notice stay on screen, with grey cards of the page's own shape. Once the page is there, it refreshes itself every 30 seconds and after each live check-in. A refresh that fails changes nothing on screen, and the next one tries again.
- **Event settings:** the header and the tabs stay on screen, and the open tab shows grey cards of its own shape. The Location, Ticket types and Check-in tabs read their own data too. Each shows its own grey cards and **Retry**, without touching the other tabs.
- **The Mailing, Wallet and Images tabs:** they read the bounce detection settings, the wallet push history and the image library. The rest of the tab stays usable. Changing the page of the wallet push history keeps the rows on screen, dimmed, until the next page arrives.
- **Buttons that show a spinner while they work:** **Save** and **Add** in the Pinned note, key contact and link dialogs; **Save** and **Export personal data** in Event settings; **Test connection**, **Run check now**, **Find on map** and **Add image**.

## Related pages

- [Create an Event](Create-an-Event)
- [First Event Checklist](First-Event-Checklist)
- [Ticket Types](Ticket-Types)
- [Requirements and Fulfilment](Requirements-and-Fulfilment)
- [Reports and Archiving](Reports-and-Archiving)
- [Mail Delivery Administration](Mail-Delivery-Administration)
- [Wallet Passes - PassCreator Template Setup](Wallet-Passes-PassCreator-Setup)
