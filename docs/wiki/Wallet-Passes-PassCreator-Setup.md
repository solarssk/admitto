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
3. Add one custom field per value the pass should show. Use these exact names to match Event Settings → Wallet's default field mapping:
   - `name` - attendee full name
   - `eventDate` - event date
   - `eventHours` - event hours
   - `eventPlace` - event location
   - `ticketType` - ticket type
4. If Event Settings → Wallet's **Field mapping** uses different PassCreator field keys, add a custom field with that exact key instead - the property name must match the field mapping key character for character.
5. Save each new property. PassCreator generates a placeholder token for it, shown next to the field (for example `{eventDate}`).
6. Open **Design & Content → Frontfields** (or Secondary/Auxiliary fields, depending on where the value should appear on the card).
7. For each field on the card, set its **Value** to the generated placeholder token from step 5 (for example `{eventDate}`), not the plain field name typed as text.
8. Save the template. PassCreator warns "Non-existent placeholders" if a token doesn't match a registered property - resolve every warning before saving.
9. In Admitto, open the event's **Event settings → Wallet** tab and use **Test connection** to confirm the API key and Template ID are still correct, then ask a real attendee's ticket page (or your own test attendee) to add the pass and check the card shows real values.

## Expected result

The Apple Wallet and Google Wallet pass shows the attendee's name, the event date, hours, location, and ticket type as real values, not literal field names.

## Important decisions

- PassCreator only substitutes a value into a card field when that field's Value box holds the property's generated placeholder token. Typing the plain field name as text (no braces) does nothing - PassCreator prints it exactly as typed.
- A property must be registered as an Additional Property on that specific template before it can be referenced anywhere on that template. Nothing in Admitto or PassCreator does this automatically; it is a manual, per-template step.
- Admitto's default field mapping (name, eventDate, eventHours, eventPlace, ticketType) only works once a template has these five properties registered under those exact names. A template cloned or created without them needs this setup even if Admitto's own settings look correctly configured.
- Changing Event Settings → Wallet's **Field mapping** to custom keys means registering matching Additional Properties under those same keys in PassCreator - the two must stay in sync.

## What changes after this action

New and reissued wallet passes for this event's attendees show real data. Passes already added to an attendee's phone before this fix do not update automatically; the attendee needs to re-add the pass from their ticket page.

## Common problems

- **PassCreator shows a "Non-existent placeholders" warning when saving:** the placeholder token used in a Value box doesn't match any registered Additional Property on this template. Add the missing property (steps 3-5) or fix the token's spelling.
- **The card still shows a literal field name like `eventPlace` after adding the property:** the Value box still has the plain field name typed as text - replace it with the generated placeholder token (step 7), don't leave both.
- **Test connection succeeds in Admitto but the pass still shows blank or wrong fields:** Test connection only checks that the API key and Template ID are valid and reachable - it does not check that Additional Properties are registered or that Value boxes reference them correctly.

## Related pages

- [Event Overview and Settings](Event-Overview-and-Settings)
