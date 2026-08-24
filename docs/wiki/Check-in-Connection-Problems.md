# Check-in Connection Problems

**Audience:** Check-in Operators and Event Managers · **Required role:** Operator for the event · **Feature status:** ✅ Available · **Last verified:** Admitto 0.4.13

## What this page helps you do

Respond safely when check-in loses its connection or live updates.

## Before you start

Know who the event lead is and which network the check-in device should use.

## Steps

1. Read the connection banner before trying another action.
2. If the page says it is offline, pause scans and item changes.
3. Check the device network without leaving the assigned event.
4. Wait for the connection indicator to recover.
5. If only **Reconnecting live updates…** appears, do not assume another device's activity is current until the message clears.
6. Retry one approved test action after recovery.

## Expected result

The connection banner clears, mutations are enabled again, and live check-in history resumes updating.

## Important decisions

- Check-in changes are blocked when the main connection is unavailable.
- The live-update stream and the main application connection are separate. A live-update warning can appear while actions still work.
- Repeated clicking during an outage does not provide a safe offline queue.

## What changes after this action

No attendee state changes until a request succeeds. After reconnection, refresh or reopen the current attendee if its state may have changed on another device.

## Common problems

- **The banner does not clear:** reload only after noting the current attendee, then sign in again if asked.
- **Only one device has the problem:** compare its network and browser state with a working device.
- **Several devices lose access:** stop admissions and contact the event lead or Superadmin through the approved support channel.

## Related pages

- [Operator Quick Start](Operator-Quick-Start)
- [Scanning Tickets and Check-in Results](Scanning-Tickets-and-Results)
- [Help and Troubleshooting](Help-and-Troubleshooting)
