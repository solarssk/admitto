# Custom Attendee Fields

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.4

## What this page helps you do

Define event-specific attendee information for forms, imports, exports, and supported operator views.

## Before you start

Decide which information is necessary for this event. Choose a stable field name before importing data and avoid collecting information that the event does not need.

## Steps

1. Open **Requirements**, then find **Custom attendee fields**.
2. Select **Add custom field**.
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

- The generated field ID cannot be changed after creation.
- Use the field ID, not only the display label, as the import column name.
- A required field can prevent incomplete attendee data from being saved or imported.
- Select values must match an allowed option.
- A field used by an event item cannot be deleted until that reference is removed.
- Renaming or removing a Select option is a real content change, not a display tweak: any attendee currently holding that exact value stops matching it and needs to be reassigned. Clearing an option's text down to nothing has the same effect as removing it.

## What changes after this action

The field becomes part of the event's attendee data. Editing its label, description, type, required state, or options affects later data entry and validation; existing values are not automatically rewritten.

When you reopen an existing Select field to edit it, each option shows how many attendees currently have it selected. Renaming or clearing an option that's in use flags it in place, and selecting **Save** then asks you to confirm before it goes through, listing exactly which options and how many attendees are affected. Removing an option outright (its **×** button) asks for confirmation the same way before it disappears. None of this applies to a brand-new option that hasn't been saved yet.

## Common problems

- **The field ID is not what you need:** delete and recreate the unused field before importing data. It cannot be renamed later.
- **A Select field cannot be saved:** add at least one option.
- **An import value is invalid:** use the field ID as the column and match the selected type or option.
- **The field cannot be deleted:** remove its use from event items first.
- **An attendee's Select value now shows as unset:** someone renamed or removed the option it used to match. Open the attendee and choose a current option to reassign it - the confirmation shown when the option was edited names which attendees were affected.

## Related pages

- [Import File Reference](Import-File-Reference)
- [Importing Attendees](Importing-Attendees)
- [Event Items and Check-in Behaviour](Event-Items-and-Check-in-Behaviour)
- [Managing Attendees](Managing-Attendees)
