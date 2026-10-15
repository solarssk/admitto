# Import File Reference

**Audience:** Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.4.13

Download the current CSV template from **Import attendees**. Headers are trimmed and case-insensitive.

| Column | Required | Meaning |
|---|---|---|
| `email` | Yes | Valid attendee email. Stored in lowercase and used as the normal match key. |
| `first_name` | Yes | Attendee's first name. |
| `last_name` | Yes | Attendee's last name. |
| `ticket_type` | No | Must match a configured ticket type label or key. The value is normalised to the configured key. |
| `company` | No | Attendee company. |
| `department` | No | Attendee department or team. |
| `external_uuid` | No | Existing identifier supplied by an external ticket source. |
| `qr_payload` | No | Existing QR value supplied by an external ticket source. Leave empty for Admitto-generated tickets. |
| Custom field key | Depends on field | Use the `source_field` key from **Requirements**. Required custom fields must have a valid value. |

## File format and row numbers

- CSV uses comma-separated columns. Wrap a value containing a comma, double quote, or line break in double quotes; write a double quote inside that value as two double quotes. LF and CRLF inside a quoted cell are preserved. XLSX cells with line breaks follow the same import rules; the workbook decoder normalises CRLF to LF.
- Diagnostic row numbers count non-empty data records, starting at 1 after the header. Blank records are ignored, and a line break inside a quoted cell does not increase the number.
- The upload accepts at most 50,000 data records. The existing file-size and decoded-text limits still apply, including line breaks inside cells.
- An XLSX file counts the rows of the whole workbook against that limit, blank rows and the rows of other sheets included, because the file is read as a whole. Cells count too, up to an average of 20 for each of the rows allowed (1,000,020 in all), empty cells that only carry a format included. A workbook that would take too much memory to read is refused in the same way. If a file that looks shorter is refused for too many rows, delete the sheets you do not need and the unused rows and columns below and beside the data (delete them, do not only clear them), save it and upload it again.
- **Malformed CSV record:** close quoted fields and remove text after the closing quote or cells that have no corresponding header. Missing trailing optional cells are treated as empty.

## Matching and duplicates

- Rows with an external UUID or QR value are matched by those identifiers first, then by email.
- Rows without external identifiers are matched by email.
- A file cannot repeat an email, external UUID, or QR payload.
- If identifiers point to different attendees, the row is skipped as a conflict.
- Unknown columns produce warnings and are ignored. Duplicate headers produce a warning; the last value is used.

## Overwrite behaviour

With **Overwrite existing attendees** off, a matching attendee is skipped. With it on, Admitto can update the first name, last name, ticket type, company, department, and supplied custom-field values. It does not replace pass status, QR payload, external UUID, or the secure ticket token.

## Validation results

- **Valid row:** can be created or updated.
- **Invalid row:** the file data failed validation and must be corrected.
- **Warning:** the file can continue, but the message should be reviewed.
- **Skipped row:** Admitto deliberately did not create or update it; the displayed reason explains why.

## Related pages

- [Importing Attendees](Importing-Attendees)
- [Ticket Types](Ticket-Types)
- [Custom Attendee Fields](Custom-Attendee-Fields)
