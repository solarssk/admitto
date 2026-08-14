# Scanning Tickets and Results

| Field | Value |
|---|---|
| **Audience** | Check-in Operators |
| **Required role** | Operator for the event |
| **Feature status** | Available |
| **Last verified** | Admitto 0.4.13 |

## What this page helps you do

Scan tickets and respond consistently to every supported check-in result.

## Before you start

- Open the assigned active event and set a clear device label when asked.
- Test the camera or hardware scanner with an approved test ticket.
- Confirm whether the event requires a second confirmation before admission.

## Steps

1. Open **Check-in**.
2. Use **Use camera** (desktop viewfinder is QR-sized; **Disable camera** turns it off), a hardware scanner, or the focused scan field. You can also paste or type a ticket token, URL, or agency QR and press Enter.
3. Point the camera at one QR code or scan one ticket. Admitto plays a short beep (and vibration where the device supports it), with distinct tones for valid, already checked in, and invalid results.
4. Read the status, attendee name, and ticket type before acting.
5. Confirm check-in when the screen shows **Ready to check in**.
6. Mark required items with **Mark issued** / **Mark given** when the attendee card offers those actions (attest after the physical hand-over).
7. Open a row in **Recent scans** when you need to reopen that attendee's card.

## Expected result

One of these results appears:

| Result | Meaning | Operator action |
|---|---|---|
| PREVIEW / Ready to check in | The attendee was found and the event requires confirmation. | Confirm only after checking the person and ticket. |
| VALID / Valid | Check-in was recorded. | Continue with any item actions, then scan the next ticket. |
| ALREADY_CHECKED_IN | The attendee is already admitted. | Do not record a second admission. Ask the event lead if correction is needed. |
| REVOKED | The pass was revoked or cancelled. | Do not admit. Escalate to an Event Manager. |
| INVALID | The code is not valid for this event. | Check the QR or use manual lookup when enabled. |

## Important decisions

- A green result belongs only to the attendee shown on screen.
- Item buttons record a real hand-over or return; do not press them before the physical action.
- Do not create a replacement attendee or use another person's ticket to bypass a blocked result.

## What changes after this action

A valid admission records the attendee, time, device, and method in the event history. Item actions update the attendee's event-item state.

## Common problems

- **The camera does not start:** check browser camera permission or use the hardware scanner.
- **The scanner types but does not submit:** refocus the scan field and try one complete code.
- **The wrong event is open:** stop scanning and return to the event list.

## Related pages

- [Operator Quick Start](Operator-Quick-Start)
- [Manual Lookup and Corrections](Manual-Lookup-and-Corrections)
- [Check-in Connection Problems](Check-in-Connection-Problems)
