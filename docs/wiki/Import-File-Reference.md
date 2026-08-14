# Import File Reference

| Field | Value |
|---|---|
| **Audience** | Event Managers |
| **Required role** | Organisation Admin |
| **Feature status** | Available |
| **Last verified** | Admitto 0.4.13 |

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
