# Email Templates

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.7.4

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
9. Check the message in a normal email client, including event details and responsive layout.
   - The ticket button and QR image in a test message are placeholders. The button goes nowhere, and the QR is a sample picture.
   - So use the test to check layout only. The real link and QR appear in a message sent to an attendee.

## Expected result

The saved template previews without errors. The test message shows your layout and event details with a placeholder ticket button and QR image (they are not live); for another named template, it reflects whatever content and links you built into it.

## Important decisions

- Changing the format button does not convert the source body. Switching a non-empty template asks for confirmation first.
- Required variables are marked by the editor. Only the ticket template requires valid ticket and QR URLs; other named templates do not.
- Image and Wallet chips insert ready-to-use markup, an image element or a wallet badge button linking to the placeholder; a bare token does not display a picture or a button by itself.
- Select the pencil icon next to the template picker to rename the template, change its icon, or edit its description. This does not change the subject or body.
- Preview uses safe sample values. A template test validates rendering and mail delivery but does not send to attendees.
- Preview has a sun/moon switch to check how the message looks in a light or dark email client. Dark is a simulated rendering. It is not a guarantee of how any specific real email app's own dark mode will render the message. Different apps can render dark mode differently from this preview and from each other.

## What changes after this action

Saving changes the source used for later previews, tests, initial sends, and resends for this event. Messages already sent are unchanged.

## Common problems

| Problem | What it means and what to do |
|---------|------------------------------|
| **MJML or HTML validation failed** | Read the listed errors and use [Advanced Email Templates](Advanced-Email-Templates) |
| **A variable is rejected** | Use an exact variable offered by the editor |
| **The QR does not render** | Insert `qr_image_url` with the image chip and preview again |
| **The Wallet badge does not open a pass when tested** | That is expected. Preview and Send test always show a placeholder link, by design, no matter how this event's Wallet is configured. Only a real message sent to an attendee uses the actual link. See [Template Variables](Template-Variables) |
| **Test send fails** | Check template validation first, then ask a Superadmin to review the effective mail transport |

**Communication shows grey cards, says "Taking longer than usual", or "Could not load template"**

The event's templates are being read from the server.

- The title and the tabs stay on screen, and the open tab shows grey cards of its own shape.
- If the read fails, or when 30 seconds have passed without an answer, it shows an error with a **Retry** button. The button stays on screen, busy, until the answer is in.
- An event you have no access to says so, in its own words.
- **Save** and **Send test** show a spinner on the button while they work.

## Related pages

- [Advanced: Editing MJML and HTML](Advanced-Email-Templates)
- [Template Variables](Template-Variables)
- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
