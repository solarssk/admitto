# Template Variables

> **Audience:** Event Managers and Technical Event Managers
> **Required role:** Organisation Admin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

Use the variable buttons shown in **Communication**. The editor is the source of truth for the variables available to the selected template.

| Group | Variables | Use |
|---|---|---|
| Attendee | `first_name`, `last_name`, `full_name`, `email` | Personalise visible text. Avoid putting personal data in the subject unless it is necessary. |
| Event | `event_name`, `event_date`, `event_location` | Show event details from the current event. An optional value can be empty. |
| Ticket links | `ticket_url` | Link to the attendee's browser ticket. |
| Images | `qr_image_url`, `logo_url` | Use through the image button so the editor inserts image markup. |
| Wallet and download page | `apple_wallet_url`, `google_wallet_url`, `download_page_url` | Planned; these values currently render empty. |

## Required ticket variables

`ticket_url` and `qr_image_url` are required URL values for the ticket template. A missing or invalid required URL stops rendering instead of producing a broken ticket.

## Syntax rules

- Use the exact lowercase form, for example `{{event_name}}`.
- Do not add spaces inside the braces.
- Do not invent a variable that is not offered by the editor.
- Put URL variables in a link destination and image variables in image markup. The editor buttons help place them safely.
- Event image assets can add event-specific image variables. Use only assets listed by the editor.

## Related pages

- [Email Templates](Email-Templates)
- [Advanced: Editing MJML and HTML](Advanced-Email-Templates)
