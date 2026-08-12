# Wallet Passes - PassCreator Template Setup

> **Audience:** Superadmins
> **Required role:** Superadmin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.14

## What this page helps you do

Configure a PassCreator template so an event's Apple Wallet and Google Wallet passes show real attendee and event data instead of literal placeholder text like `eventDate` printed on the card.

## Before you start

Have a PassCreator account with a pass template already created for the event, and know that template's API key and Template ID (from the PassCreator dashboard, under API Keys and the template's own page).

## Steps

1. Open the PassCreator dashboard, then **Templates** and the event's template.
2. Open **Editor**, then **Design & Content → Additional Properties** (also labelled **Personalization**).
3. Add one custom field per value the pass should show, choosing any property name you want (for example `attendeeName`, `eventDate`, `ticketKind`) - Admitto has no built-in default names, so what you type here is what you'll map to in step 4.
4. In Admitto, open the event's **Event settings → Wallet** tab. Under **Field mapping**, add one row per property from step 3: pick what value it should hold (for example "Attendee full name"), and type the exact same property name from step 3 as the key. Nothing beyond the QR code is sent to PassCreator until it's mapped here - there is no default to fall back on.
5. Back in PassCreator, save each new property. PassCreator generates a placeholder token for it, shown next to the field (for example `{eventDate}`).
6. Open **Design & Content → Frontfields** (or Secondary/Auxiliary fields, depending on where the value should appear on the card).
7. For each field on the card, set its **Value** to the generated placeholder token from step 5 (for example `{eventDate}`), not the plain field name typed as text.
8. Save the template. PassCreator warns "Non-existent placeholders" if a token doesn't match a registered property - resolve every warning before saving.
9. Open **Design & Content → Barcode & NFC**. If **Value** shows `{userProvidedId}` or **Insert unique pass ID as value** is checked, the pass's scanned QR/barcode will not match the attendee's real ticket - add an Additional Property (step 3) named to match a **Ticket/QR value** entry in Event Settings → Wallet's Field mapping, uncheck **Insert unique pass ID as value**, and set **Value** to that property's placeholder token instead.
10. In Admitto, open the event's **Event settings → Wallet** tab and use **Test connection** to confirm the API key and Template ID are still correct, then ask a real attendee's ticket page (or your own test attendee) to add the pass and check the card shows real values.

## Expected result

The Apple Wallet and Google Wallet pass shows the attendee's name, the event date, hours, location, and ticket type as real values, not literal field names.

## Important decisions

- PassCreator only substitutes a value into a card field when that field's Value box holds the property's generated placeholder token. Typing the plain field name as text (no braces) does nothing - PassCreator prints it exactly as typed.
- A property must be registered as an Additional Property on that specific template before it can be referenced anywhere on that template. Nothing in Admitto or PassCreator does this automatically; it is a manual, per-template step.
- Admitto has no built-in default field mapping. An event with an empty **Field mapping** sends nothing beyond the QR code to PassCreator - every value shown on the pass, including the attendee's name, must be mapped explicitly. This is deliberate: different templates use different property names, so a guessed default would only ever match one specific template and silently send nothing for every other one.
- Event Settings → Wallet's **Field mapping** and the template's Additional Properties must stay in sync by hand - the mapping's key must match a registered property's name character for character.
- The pass's Barcode Value is separate from Additional Properties field substitution. Admitto always sends the attendee's real ticket/QR value (the same raw token encoded in the ticket's own QR code, not a URL) as a dedicated API value, but a template's Barcode Value box only uses it when it's explicitly bound to a registered Additional Property (step 9) - PassCreator's own default for this box is the pass's internal ID, not this value, and there is no automatic way to point it at Admitto's value without this step.

## What changes after this action

New and reissued wallet passes for this event's attendees show real data. Passes already added to an attendee's phone before this fix do not update automatically; the attendee needs to re-add the pass from their ticket page.

## Common problems

- **PassCreator shows a "Non-existent placeholders" warning when saving:** the placeholder token used in a Value box doesn't match any registered Additional Property on this template. Add the missing property (steps 3, 5) or fix the token's spelling.
- **A field is registered in PassCreator and shows a real value on other passes, but this one field stays blank or shows "no value given":** the Field mapping row for it is missing in Admitto (step 4) - a property existing in PassCreator does nothing on its own, Admitto only sends a value for a property once it's mapped. Check Event Settings → Wallet's Field mapping list for a row with that exact key.
- **The card still shows a literal field name like `eventPlace` after adding the property:** the Value box still has the plain field name typed as text - replace it with the generated placeholder token (step 7), don't leave both.
- **Test connection succeeds in Admitto but the pass still shows blank or wrong fields:** Test connection only checks that the API key and Template ID are valid and reachable - it does not check that Additional Properties are registered, that Field mapping rows exist for them, or that Value boxes reference them correctly.
- **Scanning the wallet pass at check-in doesn't find the attendee, or the QR looks different from the ticket page's QR:** the template's Barcode Value box is still bound to `{userProvidedId}` (PassCreator's own pass identifier) instead of the ticket/QR value - see step 9.

## Related pages

- [Event Overview and Settings](Event-Overview-and-Settings)
