# Importing Attendees

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.4.13

![Import preview showing only fictional attendees](assets/import-preview.png)

## What this page helps you do

Validate and import many attendees from CSV or XLSX while controlling duplicates and updates.

## Before you start

- Download the current CSV template from **Import attendees**.
- Configure ticket types and custom attendee fields before preparing their columns.
- Read [Import File Reference](Import-File-Reference) for every supported column.
- Remove practice data and confirm that the source file is approved for this event.

## Steps

1. Open the event, then **Attendees**.
2. Select **More**, then **Import**.
3. Drop a CSV or XLSX file onto the dropzone, or browse to upload.
4. Keep **Dry run (validate only, no writes)** enabled and select **Validate file**. The button shows a spinner and a thin bar runs along the file's card while the file is checked; when the summary appears, the keyboard focus moves to its title.
5. Review valid, invalid, warning, skipped, create, and update counts plus the sample rows.
6. If needed, change **Overwrite existing attendees**, then select **Re-validate**.
7. Correct the source file and validate again until the summary is understood.
8. Turn off **Dry run** only when you intend to write the displayed changes.
9. Select **Commit**. Admitto queues the import for the background worker and shows progress until it finishes. Keep the worker running (`npm run worker` locally, or compose `worker` in deploy). While it runs, **Commit** shows a spinner and the same bar runs along the file's card; when the success summary (created / updated / skipped) appears, the keyboard focus moves to its title. Then review **Import history**, which refreshes after the import.

## Expected result

New attendees are created, permitted fields on matched attendees are updated when overwrite is on, and every skipped or invalid row has a displayed reason.

## Important decisions

- `first_name`, `last_name`, and `email` are always required. A `name` column is not supported and is ignored with a warning.
- External UUID and QR values are optional and should be used only when an external ticket source already owns them.
- In an XLSX file, a formula cell is imported as its last calculated value, and an Excel error cell (such as #N/A) as its error text, so the preview shows readable values instead of an unusable object string. Save the workbook in Excel once before uploading so formula results are up to date.
- Matching uses agency identifiers first when present, then email. Conflicting identifiers are skipped.
- With overwrite off, matching attendees are skipped.
- With overwrite on, Admitto can update name, ticket type, company, department, and supplied custom fields. It never overwrites pass status, QR payload, external UUID, or the secure ticket token.

## What changes after this action

A committed import changes the attendee list and records an import-history entry. Validation alone writes nothing.

## Common problems

- **Invalid row:** correct the displayed data error in the source file.
- **Warning:** review it; unknown columns are ignored and duplicate headers use the last value.
- **Skipped attendee:** read the reason, then decide whether overwrite is appropriate.
- **Unknown ticket type:** use a configured label or key and validate again.
- **Import history could not be loaded:** the card says so with a **Retry** that stays busy until the answer is in. An import that already ran is not affected; **Retry** reads the list again.
- **The event's custom columns could not be loaded:** the **Required CSV columns** list says so with a **Retry**. Select it before preparing the file, because without it the list is missing the event's own columns.
- **Event is at capacity:** an Organisation Admin can open **Event settings** and review capacity. A Superadmin-only override is offered only when an authorised exception is required.

## Related pages

- [Import File Reference](Import-File-Reference)
- [Managing Attendees](Managing-Attendees)
- [Ticket Types](Ticket-Types)
- [Custom Attendee Fields](Custom-Attendee-Fields)
