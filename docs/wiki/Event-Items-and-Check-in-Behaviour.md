# Event Items and Check-in Behaviour

| Field | Value |
|---|---|
| **Audience** | Event Managers |
| **Required role** | Administrator |
| **Feature status** | Available |
| **Last verified** | Admitto 0.4.13 |

## What this page helps you do

Configure items handled at the entrance and the supported behaviour of the event's check-in screen.

## Before you start

Agree what operators will physically issue or return. Decide whether operators need a confirmation step, manual lookup, and automatic screen clearing after admission.

## Steps

### Event items

1. Open **Requirements**, then **Event items**.
2. New events start with an always-present **Badge** item (legacy events are backfilled). You can disable Badge, but you cannot delete it.
3. Select **Add** for any extra item and enter a short name. Edits open in a centred modal with validation.
4. Open the item and add the description or attendee content fields operators need. Select-type option lists accept multi-line entry.
5. Enable **Issue on check-in** only when the item should be offered during admission.
6. Mark the item active when it is ready for event use (Active-toggle changes confirm with a toast).

### Check-in behaviour

1. Enable **Issue badge at entry** only when the Badge item is active and has **Issue on check-in** enabled. Admitto keeps that toggle in sync with Badge's Active / Issue on check-in state so the two cannot drift.
2. Enable **Require confirmation on scan** when operators must review a preview before admission is recorded.
3. Enable **Allow manual lookup** when operators may search by attendee name or email.
4. Enable **Auto-advance after valid check-in** when the screen should clear automatically for the next attendee. When the attendee still has items to hand out, the card stays until those actions are done (desktop matches mobile).
5. Test the complete flow with a synthetic attendee and every required item. On check-in, operators attest with **Mark issued** / **Mark given**, not a free-form instruction.

## Expected result

Operators see the intended item actions and check-in flow for the event, including confirmation, lookup, badge issue, and screen clearing.

## Important decisions

- An item action records a real issue or return; configure only actions operators should perform.
- Disabling an item does not erase its earlier issue and return history.
- **Badge** cannot be deleted; disable it when badges are not used at the door.
- Badge automation cannot be enabled without a usable Badge item.
- Turning off manual lookup affects the check-in screen, not the admin Attendees page.
- Avoid changing these settings while operators are actively admitting attendees.

## What changes after this action

Active items and behaviour settings become available on check-in devices. Later changes affect new operator actions; recorded check-ins and item history remain in the event history.

## Common problems

- **Issue badge at entry is disabled:** enable Badge and its **Issue on check-in** option first.
- **Badge cannot be removed:** that is expected; set it inactive instead.
- **Operators cannot search attendees:** review **Allow manual lookup**. Check-in search matches name and email only (not company or department).
- **A scan stops at a preview:** confirmation is required; the operator must confirm the attendee.
- **The result disappears too quickly:** review **Auto-advance after valid check-in**.

## Related pages

- [Custom Attendee Fields](Custom-Attendee-Fields)
- [Operator Quick Start](Operator-Quick-Start)
- [Scanning Tickets and Results](Scanning-Tickets-and-Results)
- [Manual Lookup and Corrections](Manual-Lookup-and-Corrections)
