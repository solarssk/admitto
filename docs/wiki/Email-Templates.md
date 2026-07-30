# Email Templates

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Prepare, preview, save, and test the message sent to attendees.

## Before you start

Confirm the event title, date, timezone, location, attendee data, and effective mail transport. Keep the default ticket template available for ticket delivery.

## Steps

1. Open **Communication**, then the compose view.
2. Select the ticket template or another named template.
3. Edit the **Subject**.
4. Keep the existing **MJML** or **HTML** format unless you are replacing the whole body with that format.
5. Insert attendee, event, link, and image variables with the buttons above the source editor.
6. Select **Preview** and resolve all validation messages.
7. Save the template.
8. In **Send test**, enter an approved address such as `docs.test@example.com` and select **Send test**.
9. Check the message in a normal email client, including links, QR image, event details, and responsive layout.

## Expected result

The saved template previews without errors and the test message contains a working ticket link and rendered QR image.

## Important decisions

- Changing the format button does not convert the source body.
- Required variables are marked by the editor. Ticket messages require valid ticket and QR URLs.
- Image-variable buttons insert image markup; a bare image URL token does not display an image by itself.
- Preview uses safe sample values. A template test validates rendering and mail delivery but does not send to attendees.

## What changes after this action

Saving changes the source used for later previews, tests, initial sends, and resends for this event. Messages already sent are unchanged.

## Common problems

- **MJML or HTML validation failed:** read the listed errors and use [Advanced Email Templates](Advanced-Email-Templates).
- **A variable is rejected:** use an exact variable offered by the editor.
- **The QR does not render:** insert `qr_image_url` with the image button and preview again.
- **Test send fails:** check template validation first, then ask a Superadmin to review the effective mail transport.

## Related pages

- [Advanced: Editing MJML and HTML](Advanced-Email-Templates)
- [Template Variables](Template-Variables)
- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
