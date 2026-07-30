# Advanced: Editing MJML and HTML

> **Audience:** Technical Event Manager
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Edit the source of an event email when the standard template needs a controlled layout change.

## Before you start

- Save a copy of the current source outside the editor if you may need to restore it.
- Know whether the selected template is **MJML** or **HTML**.
- Read [Template Variables](Template-Variables) before changing ticket or image placeholders.

## Steps

1. Open **Communication** and select the template.
2. Keep **MJML** selected when the body contains tags such as `<mj-section>` or `<mj-text>`.
3. Keep **HTML** selected when the body is a complete HTML fragment or document.
4. Edit one section at a time.
5. Insert placeholders with the buttons above the editor. Image buttons insert usable image markup.
6. Select **Preview** and resolve every validation message.
7. Save the template, then send a test to an approved test address.

## Expected result

The preview renders without validation errors, required ticket values are present, and the test message has the intended layout in a normal email client.

## Important decisions

- Changing **MJML** to **HTML**, or the reverse, does not convert the existing body.
- MJML is compiled before sending. Invalid nesting, such as an image inside `<mj-text>`, can fail validation.
- `ticket_url` and `qr_image_url` are required for a usable ticket message.
- Unknown or malformed `{{placeholders}}` are rejected. Do not invent variable names.
- Wallet variables are planned and currently render empty. Do not depend on them in a live message.

## What changes after this action

Saving replaces the event template source used by later previews, tests, initial sends, and resends. It does not change messages that were already sent.

## Common problems

- **The preview is blank or incomplete:** confirm that the selected format matches the body.
- **A required placeholder is missing:** insert it with the editor button and preview again.
- **An image shows as text:** use the image placeholder button instead of typing the token as plain text.
- **The test succeeds but looks different in one client:** simplify the layout and test again; email clients support different subsets of HTML.

## Related pages

- [Email Templates](Email-Templates)
- [Template Variables](Template-Variables)
- [Sending Messages and Delivery](Sending-Tickets-and-Delivery)
