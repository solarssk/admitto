# Custom Attendee Fields

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.4

## What this page helps you do

Define event-specific attendee information for forms, imports, exports, filtering the attendee list, and supported operator views.

## Before you start

Decide which information is necessary for this event. Choose a stable field name before importing data and avoid collecting information that the event does not need.

## Steps

1. Open **Requirements**, then find **Custom attendee fields**.
2. Select **Add field**.
3. Enter a clear **Display label**.
4. Review the generated field ID. It is the source field used by imports and references.
5. Add an optional description when operators need context.
6. Choose **Text**, **Select**, or **Yes/No**.
7. For a Select field, select **+ Add option** for each value attendees can choose, and drag a row's handle (or, with it focused, use the up/down arrow keys) to reorder the list.
8. Mark the field **Required** only when every attendee must have a valid value.
9. Create the field and test it with a synthetic attendee or dry-run import.

## Expected result

The field appears in supported attendee and import workflows with the label, type, options, and required state you selected.

## Important decisions

**Field ID and import**

- The generated field ID cannot be changed after creation.
- Use the field ID, not only the display label, as the import column name.
- A required field can prevent incomplete attendee data from being saved or imported.
- Select values must match an allowed option.
- A field used by an event item cannot be deleted until that reference is removed.

**Wallet passes**

- Single choice and Yes/No fields can also be mapped onto a wallet pass field in Event Settings → Wallet (Field mapping). Free-text fields are not offered there.
- A field mapped this way and later deleted, or changed to free text, simply stops being sent to the pass.
- See [Wallet Passes PassCreator Setup](Wallet-Passes-PassCreator-Setup).

**Select options**

- Renaming or removing a Select option is a real content change, not a display tweak. Any attendee currently holding that exact value stops matching it and needs to be reassigned.
- Clearing an option's text down to nothing has the same effect as removing it.

**Order of fields**

- An event's fields have one order. It is the same in the field list, the attendee forms, imports and exports, the Reports tab and the registration form.
- A new field goes to the end of the list.

**Registration form**

- The registration form asks a guest only for the fields that are set to appear on it. A field that was created before the registration form is not on it.
- A guest cannot answer a field that is not on the form. For that reason, once an event accepts registrations, a field cannot be **Required** and also left off the form. Admitto refuses to save that combination. Put the field on the form, or clear **Required**.
- An event that does not accept registrations is not affected.
- The label is the question the guest reads, so write it as a question. The description is shown under the field as a hint.
- A **Text** field is a box for a short answer of up to 100 characters. A **Select** field is a list, and the guest picks one option.
- An optional **Yes/No** field is a checkbox. A guest who leaves it unticked sends no answer, so Admitto does not record a "No". A **Required** Yes/No field is a list of Yes and No instead, because the guest has to answer.
- A guest cannot send the form until every **Required** field is answered.

## What changes after this action

The field becomes part of the event's attendee data. Editing its label, description, type, required state, or options affects later data entry and validation. Existing values are not rewritten automatically.

**Editing a Select field.** When you reopen an existing Select field, each option shows how many attendees currently have it selected.

- Renaming or clearing an option that is in use flags it in place. When you select **Save**, Admitto asks you to confirm. It lists exactly which options and how many attendees are affected.
- Removing an option outright (its **×** button) asks for confirmation the same way before it disappears.
- None of this applies to a brand-new option that has not been saved yet.

## Common problems

| Problem | What it means and what to do |
|---------|------------------------------|
| **The field ID is not what you need** | Delete and recreate the unused field before importing data. It cannot be renamed later |
| **A Select field cannot be saved** | Add at least one option |
| **An import value is invalid** | Use the field ID as the column and match the selected type or option |
| **The field cannot be deleted** | Remove its use from event items first |
| **A Required field cannot be saved because of the registration form** | The event accepts registrations, and a guest cannot answer a field that is not on the form. Put the field on the form, or clear **Required** |
| **An attendee's Select value now shows as unset** | Someone renamed or removed the option it used to match. Open the attendee and choose a current option to reassign it. The confirmation shown when the option was edited names which attendees were affected |

**A Select field's Save button is off, or its options say "Unknown"**

When you edit a Select field, Admitto reads how many attendees use each option, so that it can warn you before a rename or a removal affects them.

- The counts are grey bars until they arrive. After 8 seconds, a line above the options says it is taking longer than usual.
- If they cannot be read (after 30 seconds, or on an error), the options say **Unknown**. An error with a **Retry** button appears. It stays on screen, busy, until the answer is in.
- **Save** and the remove buttons stay off in that state, because the numbers decide whether a change is risky.
- **Save** and **Create field** show a spinner while they work.

## Related pages

- [Import File Reference](Import-File-Reference)
- [Importing Attendees](Importing-Attendees)
- [Event Items and Check-in Behaviour](Event-Items-and-Check-in-Behaviour)
- [Managing Attendees](Managing-Attendees)
