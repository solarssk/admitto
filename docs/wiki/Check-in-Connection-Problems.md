# Check-in Connection Problems

**Audience:** Check-in Operators and Event Managers · **Required role:** Operator for the event · **Feature status:** ✅ Available · **Last verified:** Admitto 0.4.13

## What this page helps you do

Respond safely when check-in loses its connection or live updates.

## Before you start

Know who the Organisation Admin for this event is and which network the check-in device should use.

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

- **"Live updates paused briefly (too many reconnects) - retrying automatically":** this device reconnected the live-update stream many times in a short period, usually because of unstable Wi-Fi or mobile data, or a proxy in between. Scanning still works. The page tries again by itself after about a minute. If it keeps coming back, move the device to a steadier network. If many devices share one network address, an instance administrator can raise the limit (`CHECKIN_STREAM_RATE_LIMIT_PER_EVENT`, 120 per minute by default; see the environment reference).
- **"Live updates unavailable. Check access":** the live-update stream was refused, for example because you were signed out or lost access to this event. Sign in again and confirm you are assigned to the event.
- **"Could not load the counts and recent scans" (or "Count unavailable" on the phone camera view):** the admitted and expected counts and the recent-scans list could not be loaded when check-in opened, usually on a weak connection. Scanning and checking in still work. Press **Retry** next to the message; the counts and the list appear when it succeeds. The counts and the newest check-ins also reappear by themselves after the next successful check-in.
- **"The server did not answer in time" on the event list:** the list of events waited 30 seconds without an answer. Check the device network and press **Retry**.
- **The banner does not clear:** reload only after noting the current attendee, then sign in again if asked.
- **Only one device has the problem:** compare its network and browser state with a working device.
- **Several devices lose access:** stop admissions and contact an Organisation Admin or Superadmin through the approved support channel.

## Related pages

- [Operator Quick Start](Operator-Quick-Start)
- [Scanning Tickets and Results](Scanning-Tickets-and-Results)
- [Help and Troubleshooting](Help-and-Troubleshooting)
