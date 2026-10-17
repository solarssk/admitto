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

### Separator and text encoding

A CSV file can separate its columns with a comma, a semicolon or a tab. Admitto reads the header row and takes the separator that gives the columns `first_name`, `last_name` and `email`. If the header does not settle it, the comma is used.

The text of the file must be UTF-8 or Windows-1250:

| The file is | What Admitto does |
|---|---|
| UTF-8, with or without a byte order mark | Reads it as it is. |
| Not valid UTF-8 | Reads it as Windows-1250 and shows a warning in the preview. Check that names with accented letters look right in the sample rows. |
| UTF-16, or any file with a NUL character (an invisible character with the code 0) | Refuses it with a message to save the file as CSV UTF-8. |

On a Windows PC set to Polish, Excel saves CSV files with semicolons. **CSV UTF-8** gives UTF-8 and plain **CSV** gives Windows-1250, so both can be uploaded as they are. **Unicode Text** gives UTF-16, so save the file as **CSV UTF-8** instead.

### Columns, quotes and line breaks

- Wrap a value that contains the separator, a double quote, or a line break in double quotes. Write a double quote inside that value as two double quotes.
- LF and CRLF inside a quoted cell are preserved.
- XLSX cells with line breaks follow the same import rules. The workbook decoder normalises CRLF to LF.
- **Malformed CSV record:** close quoted fields, and remove text after the closing quote or cells that have no corresponding header. Missing trailing optional cells are treated as empty.

### Row numbers

- Diagnostic row numbers count non-empty data records, starting at 1 after the header.
- Blank records are ignored.
- A line break inside a quoted cell does not increase the number.

### Size limits

- The upload accepts at most 50,000 data records.
- The existing file-size and decoded-text limits still apply, including line breaks inside cells.

### XLSX files

An XLSX file is read as a whole, so it counts more than the rows you can see. A file over one of these limits is refused for too many rows:

- **Rows:** the rows of the whole workbook count against the limit of 50,000 data records. Blank rows and the rows of other sheets are included.
- **Cells:** cells count too, up to an average of 20 for each of the rows allowed (1,000,020 in all). Empty cells that only carry a format are included.
- **Memory:** a workbook that would take too much memory to read is refused in the same way.

If a file that looks shorter is refused for too many rows:

1. Delete the sheets you do not need.
2. Delete the unused rows and columns below and beside the data. Delete them, do not only clear them.
3. Save the file.
4. Upload it again.

## Matching and duplicates

- Rows with an external UUID or QR value are matched by those identifiers first, then by email.
- Rows without external identifiers are matched by email.
- A file cannot repeat an email, external UUID, or QR payload.
- If identifiers point to different attendees, the row is skipped as a conflict.
- Unknown columns produce warnings and are ignored.
- Duplicate headers produce a warning; the last value is used.

## Overwrite behaviour

- With **Overwrite existing attendees** off, a matching attendee is skipped.
- With it on, Admitto can update the first name, last name, ticket type, company, department, and supplied custom-field values.
- Even with it on, Admitto does not replace pass status, QR payload, external UUID, or the secure ticket token.

## Validation results

- **Valid row:** can be created or updated.
- **Invalid row:** the file data failed validation and must be corrected.
- **Warning:** the file can continue, but the message should be reviewed.
- **Skipped row:** Admitto deliberately did not create or update it; the displayed reason explains why.

## Related pages

- [Importing Attendees](Importing-Attendees)
- [Ticket Types](Ticket-Types)
- [Custom Attendee Fields](Custom-Attendee-Fields)
