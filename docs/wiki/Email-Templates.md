# Email Templates

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.7.4

## What this page helps you do

Prepare, preview, save, and test the message sent to attendees, and the four emails a guest gets when they register through the event's form.

## Before you start

Confirm the event title, date, timezone, location, attendee data, and effective mail transport. Keep the default ticket template available for ticket delivery.

## Steps

1. Open **Communication**, then the **Templates** tab.
2. Select the ticket template or another named template from the picker at the top.
3. Edit the **Subject**.
4. Keep the existing **MJML** or **HTML** format unless you are replacing the whole body with that format.
5. Insert variables with the chips above the source editor, grouped as Attendee, Event, Ticket & QR, Wallet, and Branding, plus an Images group when the event has extra named images. Image and Wallet chips insert ready-to-use markup, an image or a wallet badge button, instead of plain text.
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

Saving or reverting a registration email changes every one of its emails that is not sent yet. Emails already sent are unchanged.

## Registration emails

A guest who registers through the event's form gets up to four emails of their own, besides the ticket. They are at the end of the template picker, under your own templates. Each one runs on the built-in English text until you save your own.

Guests cannot register through the form yet, so no one gets these emails yet. You can already read and change them here.

| Email | Sent when |
|-------|-----------|
| Registration: confirm email | The guest has to confirm their email address first. The link in it works for 24 hours |
| Registration: received | The registration waits for your decision, and the guest did not have to confirm the address first |
| Registration: waiting list | The event is full and the registration goes on the waiting list |
| Registration: declined | You decline a registration and choose to let the guest know |

**What the guest does with the confirmation link**

- Opening the link shows a page with a button, **Confirm my address**. Nothing is confirmed until the guest selects it. Mail security scanners open the links in a message too, and this keeps them from confirming for the guest.
- After the button, the guest sees where the registration stands: registered, waiting for your decision, or on the waiting list. A second click shows "Your address is already confirmed" and sends no second email.
- The link works for 24 hours after the guest sent the form. After that, the guest sees "This link has expired" and a button to register again.
- A guest who sends the form again with the same address while the link still works gets the same link in a new email. This happens at most once in 10 minutes. An address also gets at most 3 emails of this kind in 24 hours, across all events.
- The link keeps working while registration is on for the event. It stops when you turn registration off, archive the event, or the event is over.

**Change one**

1. Open **Communication**, then the **Templates** tab, and pick the email. The badge reads **Default template** while it runs on the built-in text.
2. Edit the subject and the body as for any other template. The chips for the confirmation link and for the contact are in their own groups, **Confirmation** and **Contact**.
3. Select **Save**, then **Continue**. The email now has a text of its own for this event, and the badge reads **Last edited**.
4. In **Send test**, enter an approved address such as `docs.test@example.com` and select **Send test**. The button in a test email goes nowhere.

**Go back to the built-in text**

1. Pick the email and select **Revert to default**.
2. Confirm. Your saved text is discarded, unsaved changes included, and the event uses the default text again.

What is different from your other templates:

- You cannot send them to attendees. They are not offered on the **Email** tab, and a bulk send of one is refused.
- They are not listed in the **Delivery log**.
- Their name, icon and description are fixed, so the pencil next to the picker is off.
- The confirmation email must keep `{{confirm_url}}`. No registration email can use the ticket, QR, Wallet or ticket type variables. The editor flags them. See [Template Variables](Template-Variables).
- A guest's name stays empty until the guest has confirmed the address or you have decided about the registration, so it is always empty in the confirmation email. Write a greeting that reads well without a name, as the built-in emails do ("Hello,").
- Preview and **Send test** show your event's own contact in `{{contact_line}}`, or nothing when the event has no contact.

## Common problems

| Problem | What it means and what to do |
|---------|------------------------------|
| **MJML or HTML validation failed** | Read the listed errors and use [Advanced Email Templates](Advanced-Email-Templates) |
| **A variable is rejected** | Use an exact variable offered by the editor. A registration email cannot use the ticket, QR, Wallet or ticket type variables, and only the confirmation email can use `{{confirm_url}}` |
| **A registration email is not on the Email tab** | That is by design. A registration email answers one guest's registration and is never sent in bulk. Edit it on the **Templates** tab |
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
