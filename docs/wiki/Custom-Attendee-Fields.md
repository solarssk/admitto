# Custom Attendee Fields

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.13

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
7. For a Select field, enter at least one option, one per line.
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

## What changes after this action

The field becomes part of the event's attendee data. Editing its label, description, type, required state, or options affects later data entry and validation; existing values are not automatically rewritten.

## Common problems

- **The field ID is not what you need:** delete and recreate the unused field before importing data. It cannot be renamed later.
- **A Select field cannot be saved:** add at least one option.
- **An import value is invalid:** use the field ID as the column and match the selected type or option.
- **The field cannot be deleted:** remove its use from event items first.

## Related pages

- [Import File Reference](Import-File-Reference)
- [Importing Attendees](Importing-Attendees)
- [Event Items and Check-in Behaviour](Event-Items-and-Check-in-Behaviour)
- [Managing Attendees](Managing-Attendees)
