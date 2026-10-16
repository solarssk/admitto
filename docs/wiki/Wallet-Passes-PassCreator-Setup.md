# Wallet Passes - PassCreator Template Setup

**Audience:** Superadmins · **Required role:** Superadmin · **Feature status:** ✅ Available · **Last verified:** Admitto 0.7.4

## What this page helps you do

Configure a PassCreator template so an event's Apple Wallet and Google Wallet passes show real attendee and event data. Without this, the card prints literal placeholder text such as `eventDate`.

## Before you start

Have a PassCreator account with a pass template already created for the event. Know that template's API key and Template ID (from the PassCreator dashboard, under API Keys and the template's own page).

## Steps

1. Open the PassCreator dashboard, then **Templates** and the event's template.
2. Open **Editor**, then **Design & Content → Additional Properties** (also labelled **Personalization**).
3. Add one custom field for each value the pass should show. Choose any property name you want, for example `attendeeName`, `eventDate` or `ticketKind`. Admitto has no built-in default names, so what you type here is what you map to in step 4.
4. In Admitto, open the event's **Event settings → Wallet** tab. Under **Field mapping**, add one row for each property from step 3:
   - Pick what value it should hold (for example "Attendee full name").
   - Type the exact same property name from step 3 as the key.
   - Nothing beyond the QR code is sent to PassCreator until it is mapped here. There is no default to fall back on.
   - "Event date" ("24 September 2026") and "Event date (short)" ("24 Sep 2026") are two separate values for the same calendar day. Map whichever fits the card field's width.
   - "Event hours" is the start-end time range. It reads the same as on the attendee's public ticket page.
5. Back in PassCreator, save each new property. PassCreator generates a placeholder token for it, shown next to the field (for example `{eventDate}`).
6. Open **Design & Content → Frontfields** (or Secondary or Auxiliary fields, depending on where the value should appear on the card).
7. For each field on the card, set its **Value** to the generated placeholder token from step 5 (for example `{eventDate}`). Do not type the plain field name as text.
8. Save the template. PassCreator warns "Non-existent placeholders" if a token does not match a registered property. Resolve every warning before saving.
9. Open **Design & Content → Barcode & NFC**. If **Value** shows `{userProvidedId}`, or **Insert unique pass ID as value** is checked, the pass's scanned QR or barcode will not match the attendee's real ticket. To fix it:
   - Add an Additional Property (step 3) named to match a **Ticket/QR value** entry in Event Settings → Wallet's Field mapping.
   - Uncheck **Insert unique pass ID as value**.
   - Set **Value** to that property's placeholder token instead.
10. In Admitto, open the event's **Event settings → Wallet** tab and use **Test connection** to confirm the API key and Template ID are still correct. Then ask a real attendee's ticket page (or your own test attendee) to add the pass, and check that the card shows real values.

## Expected result

The Apple Wallet and Google Wallet pass shows the attendee's name, the event date, hours, location, and ticket type as real values, not literal field names.

## Important decisions

**How placeholders work**

- PassCreator only substitutes a value into a card field when that field's Value box holds the property's generated placeholder token. Typing the plain field name as text (no braces) does nothing. PassCreator prints it exactly as typed.
- A property must be registered as an Additional Property on that specific template before it can be referenced anywhere on that template. Nothing in Admitto or PassCreator does this automatically. It is a manual, per-template step.

**Field mapping**

- Admitto has no built-in default field mapping. An event with an empty **Field mapping** sends nothing beyond the QR code to PassCreator. Every value shown on the pass, including the attendee's name, must be mapped explicitly. This is deliberate. Different templates use different property names, so a guessed default would only ever match one specific template and silently send nothing for every other one.
- Event Settings → Wallet's **Field mapping** and the template's Additional Properties must stay in sync by hand. The mapping's key must match a registered property's name character for character.
- **Field mapping** also offers this event's own custom fields (Event Settings → Requirements/Registrations) as values. Only fields set up as **Single choice** or **Yes/No** are offered, not free text.
  - A Yes/No field shows as "Yes" or "No" on the card.
  - A Single choice field shows the option the attendee picked.
  - A custom field mapped here and later deleted, or changed to free text, just stops sending a value. That is the same as any other unmapped field. It is not an error.

**Barcode value and ticket status**

- The pass's Barcode Value is separate from Additional Properties field substitution. Admitto always sends the attendee's real ticket/QR value as a dedicated API value. It is the same raw token that is encoded in the ticket's own QR code, not a URL. But a template's Barcode Value box only uses it when it is explicitly bound to a registered Additional Property (step 9). PassCreator's own default for this box is the pass's internal ID, not this value. There is no automatic way to point it at Admitto's value without step 9.
- **Ticket status** ("Valid" / "Checked in" / "Revoked" / "Cancelled") reflects the attendee's status at the moment the pass was created or last reissued. It is not a live value. Nothing in Admitto refreshes an already-issued pass automatically when the attendee is later checked in or revoked. A card can keep showing "Valid" after the attendee has actually checked in.

## What changes after this action

New and reissued wallet passes for this event's attendees show real data. Passes already added to an attendee's phone before this fix do not update automatically. The attendee needs to re-add the pass from their ticket page.

## Common problems

| Problem | What it means and what to do |
|---------|------------------------------|
| **A wallet operation fails** | Logs contain the operation and a safe failure category, without provider reply text or attendee details. Check the event's API key, template and field mapping, then retry. Rate-limit and connection failures keep their existing retry behavior. A failed remote removal remains pending for cleanup |
| **PassCreator shows a "Non-existent placeholders" warning when saving** | The placeholder token used in a Value box does not match any registered Additional Property on this template. Add the missing property (steps 3 and 5) or fix the token's spelling |
| **A field is registered in PassCreator and shows a real value on other passes, but this one field stays blank or shows "no value given"** | The Field mapping row for it is missing in Admitto (step 4). A property existing in PassCreator does nothing on its own. Admitto only sends a value for a property once it is mapped. Check Event Settings → Wallet's Field mapping list for a row with that exact key |
| **The card still shows a literal field name like `eventPlace` after adding the property** | The Value box still has the plain field name typed as text. Replace it with the generated placeholder token (step 7). Do not leave both |
| **Test connection succeeds in Admitto, but the pass still shows blank or wrong fields** | Test connection only checks that the API key and Template ID are valid and reachable. It does not check that Additional Properties are registered, that Field mapping rows exist for them, or that Value boxes reference them correctly |
| **Scanning the wallet pass at check-in does not find the attendee, or the QR looks different from the ticket page's QR** | The template's Barcode Value box is still bound to `{userProvidedId}` (PassCreator's own pass identifier) instead of the ticket/QR value. See step 9 |

## Apple Wallet semantic tags (Siri Suggestions, Maps, Calendar)

Semantic tags are a separate, optional layer on top of the card fields above. They power Siri Suggestions, Maps, and Calendar smart surfacing on Apple Wallet. They never appear as visible text on the pass card itself.

They need **two** things set up, on two different systems. Both are required.

1. **In Admitto**, Event Settings → Wallet's Field mapping supports the same kind of entries as any other field. The placeholders include "Event type", "Venue room", "Venue entrance" (and door, gate, portal), "Venue phone number", "Venue place ID", and the access-point opening times (venue, doors, gates, box office, parking lots, fan zone). Map any of these to a property name, the same as in step 4 above. Most of the underlying data comes from Event Settings → General (**Event type**) and → Location's **Venue access details** section.
   - **Venue place ID** has no automatic source, because Admitto's geocoding does not produce Apple Maps' own place identifiers. Look it up yourself in the Apple Maps app (search the venue, tap Share, copy the ID from the link) and enter it in Event Settings → Location.
2. **In PassCreator**, register the same Additional Property (steps 2-3 above) if it does not exist yet. Then open **Design & Content → Semantic Tags** and bind the matching Apple field (for example "Event Type", "Venue Room") to that property's placeholder token. It is the same `{propertyName}` token used for card fields, just placed in the Semantic Tags panel instead of Frontfields.

Good to know:

- Mapping a field in Admitto alone does nothing for Siri, Maps or Calendar without step 2. Binding a Semantic Tags field in PassCreator to a property Admitto never sends is equally silent. PassCreator only substitutes a value when both sides use the exact same property name. Admitto has no way to complete step 2 for you, because the binding lives entirely inside that PassCreator template's own editor.
- There is no toggle for this in Admitto. A semantic tag placeholder becomes live the moment it is mapped in Field mapping and bound in PassCreator, the same as any other field.
- It has no effect on Google Wallet passes, and it does not require NFC or any special PassCreator account approval.

An earlier version of this integration sent a separate `semantics` object through the wallet API, with an event-level "Semantic tags" toggle. That object was never a documented part of PassCreator's pass API and had no effect on issued passes (confirmed by inspecting real `.pkpass` files), so it has been removed. There is no impact if you had the toggle turned on.

## Lock Screen relevance date (always on for Apple Wallet, no switch)

Whenever Apple Wallet is enabled for an event and the event has a start time set (Event settings → Basic information → Event hours), Admitto also tells PassCreator when the pass becomes relevant enough to surface on the Lock Screen.

- It works independently of the semantic tags setup above and needs no configuration of its own.
- It has no effect on Google Wallet passes.
- An event with no start time set gets no Lock Screen surfacing behavior. Nothing else about the pass changes.

## Pass expiration (event_end mode)

Event Settings → Wallet's **Pass expiration** field controls whether an issued pass ever expires on its own, without an admin voiding it. It has two options:

| Option | What happens |
|--------|--------------|
| **Do not expire automatically** (the default) | Passes stay active until an admin explicitly voids them, or the wallet feature's own other lifecycle actions apply |
| **Expire when the event ends** | Every pass issued or reissued while this is on gets an expiration date equal to the event's own end time: its `Event hours` end, or the end of its day when it has none, in the event's own time zone. Admitto sends this to PassCreator as the pass's `expirationDate`, in addition to keeping its own record of it |

**Time zone.** The date is sent as plain local time (for example `2026-09-24 18:00`) without a time zone. PassCreator reads it in your account's own time zone, so set your PassCreator account's time zone to the event's. If they differ, PassCreator expires the pass earlier or later than Admitto does. Turning this on, and later changing the event's date, hours or time zone while it is on, also updates the expiration date of passes already issued (voided ones included) through a background push.

**Turning it on needs template support.** Click **Test connection** first, and again after any change to the Template ID or API key. It checks the template's own PassCreator setting (**Different for each pass** under the template's expiration options). When the template supports it, **Expire when the event ends** becomes available. Until then, the option stays greyed out and a note asks you to test the connection. Without that template setting on, PassCreator silently ignores the expiration date sent with each pass. So Admitto refuses to turn this mode on until the check succeeds. There is no way to tell from the pass itself that the date was ignored.

**Turning it back off is blocked once any pass has been issued for the event.** There is no PassCreator-confirmed way to clear an already-sent expiration date on an existing pass. Allowing the switch would risk leaving a stale date behind with no visible warning. To switch it off anyway:

1. Delete every issued pass of the event with **Delete wallet pass** (Attendee Detail, or the Attendees list for a selection of up to 100 at a time).
2. Void and **Remove from provider** are not enough. They keep the pass record, and any record counts as an issued pass.
3. Deleting erases the pass and its Reports history. Attendees who tap Add to Wallet again get a new pass.

**What happens once a pass expires.** A background job checks every active or voided pass's own expiration date. It does this independently of PassCreator and of whether the event is archived. It marks the pass **Expired** once that date has passed. That is the same terminal status a manually set expiration reaches. An expired pass can no longer be restored, the same as one whose event is already over.

## Related pages

- [Wallet Passes Overview](Wallet-Passes-Overview) - what the wallet integration supports overall, and where each piece is configured
- [Event Overview and Settings](Event-Overview-and-Settings)
- [Sending Wallet Messages](Sending-Wallet-Messages)
