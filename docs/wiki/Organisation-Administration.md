# Organisation Administration

> **Audience:** Organisation Admins
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Understand the organisation scope and manage its events without changing instance-wide settings.

## Before you start

Confirm that your account has the Admin role for the organisation that owns the event.

## Steps

1. Open **Events** to see active and archived events in your organisation. Each card shows a map preview when maps are enabled and the event has a pin, a short status (for example **Needs archiving**, **Today**, or **In N days**), location, attendee count, and a weather chip on the map when weather is enabled and the event has coordinates (temperature within the active provider horizon, or “Forecast available N days before the event” further out). Map thumbnails show a **© OpenStreetMap** credit on the card (ticket and mail maps still burn the credit into the PNG; CARTO only appears in that burn-in if you configure CARTO tiles under Organisation Settings → External services). Archive and restore stay in **Event settings** / organisation Event archiving, not on the card.
2. Create events and manage their attendees, requirements, communication, reports, and settings.
3. Open **Users & roles** to review assignments available to your administration scope.
4. Give operators event-scoped access only to the events where they work.
5. Review event capacity, ticket types, custom fields, and check-in behaviour before event day.

## Expected result

The Organisation Admin can manage organisation events and their staff access but cannot open Superadmin-only instance controls.

## Important decisions

- An **organisation** owns events. An **event** owns attendees, operator assignments, requirements, templates, and check-in history.
- Organisation Admin access applies only to events in the assigned organisation.
- Event mail and integration tabs can be restricted to Superadmins even when other event settings are available.

## What changes after this action

Event and access changes take effect for users in the affected scope. They do not change other organisations.

## Common problems

- **An event is missing:** check that it belongs to your assigned organisation and is not under **Archived events**.
- **A settings tab is missing:** it may be Superadmin-only.
- **An operator cannot see an event:** review the event-scoped role assignment.

## Related pages

- [Roles and Permissions](Roles-and-Permissions)
- [Users and Roles Administration](Users-and-Roles-Administration)
- [Event Overview and Settings](Event-Overview-and-Settings)
