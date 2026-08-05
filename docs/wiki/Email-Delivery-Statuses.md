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
| Bounced | The receiving system returned the message (for example via bounce detection from a forwarded NDR for this event). | Confirm or correct the attendee address before resending. Open delivery details for the SMTP code and reason when available. |
| Rejected | The transport refused the message and it is not treated as retryable. | Correct the cause before attempting another send. |

## Delivery purpose

- **Initial send** is the first ticket delivery claimed for an attendee and event.
- **Resend** is a later explicit delivery. Custom-template bulk sends are also recorded as resends.

Filters show recorded facts; they do not guarantee that a person read the email. Use the attendee detail and delivery log together when investigating.

## Investigating one delivery

Use a row's **…** menu in the delivery log to look deeper at a single delivery without leaving the page:

- **View sent message** shows the actual subject and body generated for that attendee. The QR code and ticket link are always replaced with a "hidden for privacy" placeholder, so this view is for confirming wording and layout, not for retrieving a working ticket.
- **View delivery details** shows the mail provider, message id, and attempt count. A Failed, Bounced, or Rejected delivery gets a red notice with the SMTP or transport error code and a plain-English explanation; an Accepted, Sent, or Delivered one gets a matching green confirmation instead. Sibling sends and resends for the same attendee stay on Delivery history (attendee page) and the Communication delivery log, not inside this popup.


**Search** (recipient name or email) and the **Template** filter narrow the log alongside Status and Purpose; **Export log** downloads the current filtered view as CSV.

## Related pages

- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
- [Mail Delivery Administration](Mail-Delivery-Administration)
