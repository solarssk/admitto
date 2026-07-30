# Importing Attendees

> **Audience:** Event Manager
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

Import a CSV or XLSX file when you need to add or update many attendee records.

![Import preview showing only fictional attendees](assets/import-preview.png)

## Prepare the file

Use one attendee per row. Include `first_name`, `last_name`, and `email` for every row. Add optional event information only when it is needed and approved.

Before upload:

- Remove duplicate rows.
- Use a valid email address for every attendee.
- Check that names are in the right columns.
- Use only the event's approved ticket types.
- Do not use real data in a practice file.

## Import the file

1. Open the event, then open **Attendees**.
2. Select **More** and choose **Import**.
3. Upload the CSV or XLSX file.
4. Read the validation summary and sample rows.
5. Choose the offered update option only when you intend to update matching attendees.
6. Resolve invalid rows, warnings, or capacity problems.
7. Confirm the import when the preview is correct.

## After import

Review the import history and open the attendee list. Check the total, ticket types, and a small sample of attendee records before sending tickets.

## Common problems

- **A row is invalid:** read the reason shown in the validation summary, correct the source file, and upload it again.
- **An attendee was skipped:** check whether the attendee already exists and whether the selected import option allows an update.
- **The event is full:** reduce the incoming list or ask a Superadmin to review capacity before retrying.
