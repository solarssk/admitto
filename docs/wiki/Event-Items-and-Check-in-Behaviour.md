# Event Items and Check-in Behaviour

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Configure items handled at the entrance and the supported behaviour of the event's check-in screen.

## Before you start

Agree what operators will physically issue or return. Decide whether operators need a confirmation step, manual lookup, and automatic screen clearing after admission.

## Steps

### Event items

1. Open **Requirements**, then **Event items**.
2. Select **Add** and enter a short item name.
3. Open the item and add the description or attendee content fields operators need.
4. Enable **Issue on check-in** only when the item should be offered during admission.
5. Mark the item active when it is ready for event use.

### Event behaviour

1. Enable **Issue badge at entry** only when the badge item exists, is active, and has **Issue on check-in** enabled.
2. Enable **Require confirmation on scan** when operators must review a preview before admission is recorded.
3. Enable **Allow manual lookup** when operators may search by attendee name or email.
4. Enable **Auto-advance after valid check-in** when the screen should clear automatically for the next attendee.
5. Test the complete flow with a synthetic attendee and every required item.

## Expected result

Operators see the intended item actions and check-in flow for the event, including confirmation, lookup, badge issue, and screen clearing.

## Important decisions

- An item action records a real issue or return; configure only actions operators should perform.
- Disabling an item does not erase its earlier issue and return history.
- Badge automation cannot be enabled without a usable badge item.
- Turning off manual lookup affects the check-in screen, not the admin Attendees page.
- Avoid changing these settings while operators are actively admitting attendees.

## What changes after this action

Active items and behaviour settings become available on check-in devices. Later changes affect new operator actions; recorded check-ins and item history remain in the event history.

## Common problems

- **Issue badge at entry is disabled:** enable a badge item and its **Issue on check-in** option first.
- **Operators cannot search attendees:** review **Allow manual lookup**.
- **A scan stops at a preview:** confirmation is required; the operator must confirm the attendee.
- **The result disappears too quickly:** review **Auto-advance after valid check-in**.

## Related pages

- [Custom Attendee Fields](Custom-Attendee-Fields)
- [Operator Quick Start](Operator-Quick-Start)
- [Scanning Tickets and Results](Scanning-Tickets-and-Results)
- [Manual Lookup and Corrections](Manual-Lookup-and-Corrections)
