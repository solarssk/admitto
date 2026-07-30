# QR Tickets

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Prepare and test the browser ticket and QR code used at check-in.

## Before you start

Prepare a synthetic attendee with an active pass. Save and test the ticket email template, including `ticket_url` and `qr_image_url`.

> [!WARNING]
> Treat ticket links and QR codes as access credentials. Do not publish them in documentation, screenshots, issues, or test files.

## Steps

1. Open **Communication** and select the ticket template.
2. Preview the message and confirm that the ticket button and QR image are present.
3. Send a template test to an approved test address.
4. Send the ticket to the synthetic attendee.
5. Open **View your ticket** from the received message.
6. Confirm that the browser ticket shows the correct event and attendee information.
7. Scan its QR code in the correct test event.
8. Confirm the expected check-in result, then correct the synthetic check-in if needed.

## Expected result

The email opens a valid browser ticket, the QR image renders clearly, and the code resolves only in the intended event workflow.

## Important decisions

- Treat a ticket link and QR code as access credentials. Do not publish or reuse them in documentation.
- A ticket is event-specific and belongs to one attendee.
- Active and Confirmed passes can be admitted. Cancelled and Revoked passes cannot.
- A repeated valid scan returns an already-checked-in result instead of recording a second admission.
- Wallet passes are planned and are not part of the current supported workflow.

## What changes after this action

An attendee ticket may be issued when the delivery is prepared. Sending or resending creates delivery records; scanning a valid code records check-in separately.

## Common problems

- **The QR image is missing:** insert `qr_image_url` with the image button and preview again.
- **The ticket link is invalid:** use the latest delivery and ask an Event Manager to review the attendee and template.
- **The code is invalid at check-in:** confirm the selected event and the on-screen result.
- **The ticket is revoked or cancelled:** review [Pass Statuses](Pass-Statuses); do not create a replacement attendee.

## Related pages

- [Email Templates](Email-Templates)
- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
- [Pass Statuses](Pass-Statuses)
- [Scanning Tickets and Results](Scanning-Tickets-and-Results)
