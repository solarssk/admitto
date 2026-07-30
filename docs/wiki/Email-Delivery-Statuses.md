# Email Delivery Statuses

> **Audience:** Event Managers and Superadmins
> **Required role:** Organisation Admin or Superadmin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

The delivery log records the latest known state reported by Admitto and the configured mail transport.

| Status | Meaning | Usual action |
|---|---|---|
| Queued | The delivery row exists and is waiting to be processed. | Wait and refresh. Investigate if it remains queued unexpectedly. |
| Accepted | The mail provider accepted the message. This is not proof that the recipient opened or received it. | Usually no action. |
| Sent | The transport reported that the message was sent. | Usually no action. |
| Delivered | A later provider update confirmed delivery. | No action. |
| Failed | Sending failed. The record may indicate whether retry is possible. | Check the address, template, and mail configuration before retrying. |
| Bounced | The receiving system returned the message. | Confirm or correct the attendee address before resending. |
| Rejected | The transport refused the message and it is not treated as retryable. | Correct the cause before attempting another send. |

## Delivery purpose

- **Initial send** is the first ticket delivery claimed for an attendee and event.
- **Resend** is a later explicit delivery. Custom-template bulk sends are also recorded as resends.

Filters show recorded facts; they do not guarantee that a person read the email. Use the attendee detail and delivery log together when investigating.

## Related pages

- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
- [Mail Delivery Administration](Mail-Delivery-Administration)
