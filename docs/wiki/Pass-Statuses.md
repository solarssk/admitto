# Pass Statuses

> **Audience:** Event Managers and Check-in Operators
> **Required role:** Organisation Admin for changes; Operator for check-in results
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

Pass status controls whether an attendee may use the event ticket. It is separate from email delivery, RSVP, and check-in state.

| Displayed status | Meaning | Check-in |
|---|---|---|
| Active | The attendee has a normal registered pass. | Allowed. |
| Confirmed | The attendee has a confirmed pass. | Allowed. |
| Cancelled | The attendee's pass is cancelled. | Blocked. |
| Revoked | An Event Manager revoked the pass. | Blocked until restored. |

## Revoke or restore a pass

1. Open the attendee detail page.
2. Open **More actions**.
3. Select **Revoke pass** or **Restore pass**.
4. Read the confirmation and complete the action.
5. Confirm the new status before sending or scanning the ticket.

Restoring a pass can be blocked by event capacity. A Superadmin can use the displayed capacity override only for an authorised exception.

## Important distinctions

- Revoking a pass blocks admission; it is not the same as revoking an earlier check-in.
- Restoring a pass does not automatically check the attendee in again.
- RSVP status describes the attendee's response and does not replace pass status.
- Delivery status describes a message attempt and does not prove that the pass is active.

## Related pages

- [Managing Attendees](Managing-Attendees)
- [QR Tickets](QR-Tickets)
- [Scanning Tickets and Results](Scanning-Tickets-and-Results)
- [Manual Lookup and Corrections](Manual-Lookup-and-Corrections)
