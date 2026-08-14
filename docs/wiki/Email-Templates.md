# Email Templates

| Field | Value |
|---|---|
| **Audience** | Event Managers |
| **Required role** | Organisation Admin |
| **Feature status** | Available |
| **Last verified** | Admitto 0.5.1 |

## What this page helps you do

Prepare, preview, save, and test the message sent to attendees.

## Before you start

Confirm the event title, date, timezone, location, attendee data, and effective mail transport. Keep the default ticket template available for ticket delivery.

## Steps

1. Open **Communication**, then the **Templates** tab.
2. Select the ticket template or another named template from the picker at the top.
3. Edit the **Subject**.
4. Keep the existing **MJML** or **HTML** format unless you are replacing the whole body with that format.
5. Insert variables with the chips above the source editor, grouped as Attendee, Event, Ticket & QR, Wallet, and Branding. Image and Wallet chips insert ready-to-use markup, an image or a wallet badge button, instead of plain text.
6. Select **Preview** and resolve all validation messages.
7. Save the template.
8. In **Send test**, enter an approved address such as `docs.test@example.com` and select **Send test**.
9. Check the message in a normal email client, including links, QR image, event details, and responsive layout.

## Expected result

The saved template previews without errors and the test message contains a working ticket link and rendered QR image.

## Important decisions

- Changing the format button does not convert the source body. Switching a non-empty template asks for confirmation first.
- Required variables are marked by the editor. Ticket messages require valid ticket and QR URLs.
- Image and Wallet chips insert ready-to-use markup, an image element or a wallet badge button linking to the placeholder; a bare token does not display a picture or a button by itself.
- Select the pencil icon next to the template picker to rename the template, change its icon, or edit its description. This does not change the subject or body.
- Preview uses safe sample values. A template test validates rendering and mail delivery but does not send to attendees.

## What changes after this action

Saving changes the source used for later previews, tests, initial sends, and resends for this event. Messages already sent are unchanged.

## Common problems

- **MJML or HTML validation failed:** read the listed errors and use [Advanced Email Templates](Advanced-Email-Templates).
- **A variable is rejected:** use an exact variable offered by the editor.
- **The QR does not render:** insert `qr_image_url` with the image chip and preview again.
- **The Wallet badge does not open a pass when tested:** Wallet links only resolve once Wallet is turned on and configured for this event. Confirm that under Event settings → Wallet, then preview again; see [Template Variables](Template-Variables).
- **Test send fails:** check template validation first, then ask a Superadmin to review the effective mail transport.

## Related pages

- [Advanced: Editing MJML and HTML](Advanced-Email-Templates)
- [Template Variables](Template-Variables)
- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
