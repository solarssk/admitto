# Ticket Types and Requirements

> **Audience:** Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Define attendee categories, collect event-specific data, and configure items and behaviour used during check-in.

## Before you start

Decide which distinctions operators and reports genuinely need. Use short labels that remain clear on a busy check-in screen.

## Steps

### Ticket types

1. Open **Event settings**, then **Ticket types**.
2. Add a short, recognisable ticket type.
3. Save it before using the value in an import file.
4. Review imported attendees to confirm the type was assigned as intended.

### Custom attendee fields

1. Open **Requirements** and find custom attendee fields.
2. Add a label and a stable source field used by imports and exports.
3. Choose **Text**, **Select**, or **Yes/No**.
4. Add allowed choices for a Select field.
5. Mark the field required only when every attendee record must contain it.
6. Save and test the field with a synthetic attendee.

### Event items and check-in behaviour

1. Add each item operators may issue, such as a badge or event material.
2. Enable only items that are ready for event use.
3. Choose whether a valid scan needs operator confirmation.
4. Choose whether manual attendee lookup is allowed.
5. Enable badge issue at entry only when a usable badge item is configured.

## Expected result

Attendees can be assigned a clear ticket type and event-specific values, while operators see only the items and confirmation steps prepared for the event.

## Important decisions

- The custom field source name cannot be changed after creation. Choose it before importing data.
- A required custom field can prevent incomplete attendee data from being saved or imported.
- Disabling an item does not rewrite its earlier issue and return history.
- Avoid changing check-in behaviour while operators are actively admitting attendees.
- Test the complete setup with synthetic data before event day.

## What changes after this action

Ticket types and custom fields become available in attendee records, imports, filters, exports, and supported template contexts. Enabled items and check-in options become visible to operators.

## Common problems

- **An import value is rejected:** match the configured ticket type and custom field format exactly.
- **A source field cannot be renamed:** create field names carefully; the stable import/export key is intentionally immutable.
- **Badge issue cannot be enabled:** configure and enable a suitable badge item first.
- **A field is unexpectedly empty:** check that the import header uses the source field, not only the visible label.

## Related pages

- [Import File Reference](Import-File-Reference)
- [Importing Attendees](Importing-Attendees)
- [Scanning Tickets and Results](Scanning-Tickets-and-Results)
- [Reports and Archiving](Reports-and-Archiving)
