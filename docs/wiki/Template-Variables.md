# Template Variables

| Field | Value |
|---|---|
| **Audience** | Event Managers and Technical Event Managers |
| **Required role** | Administrator |
| **Feature status** | Available |
| **Last verified** | Admitto 0.5.2 |

Use the variable chips shown in **Communication → Templates**. The editor is the source of truth for the variables available to the selected template. Chips are grouped the same way in the editor.

| Group | Variables | Use |
|---|---|---|
| Attendee | `first_name`, `last_name`, `full_name`, `email` | Personalise visible text. Avoid putting personal data in the subject unless it is necessary. |
| Event | `event_name`, `event_date`, `event_hours`, `event_location`, `event_address`, `event_map_url`, `google_maps_url`, `apple_maps_url`, `directions_text`, `accessibility_text` | Show event details from the current event. `event_location` is the venue name. `event_hours` is the event's start-end time (`HH:MM-HH:MM`, 24h) and is empty when Event settings has no start/end time set. `event_map_url` inserts a static map image through the image chip; `google_maps_url` and `apple_maps_url` are plain links. Map and link values are empty until the event has a saved location pin. When maps display is disabled for the instance, `event_map_url` stays empty (no broken image). When an admin pastes corrected Maps URLs on the Location tab (**Pin wrong? Fix link**), `google_maps_url` / `apple_maps_url` use those links instead of building from coordinates. |
| Ticket & QR | `ticket_type`, `ticket_url`, `qr_image_url`, `download_page_url` | `ticket_type` is the attendee's ticket type label (for example "Standard" or "VIP"); it reads "General" when the attendee has no ticket type assigned. `ticket_url` links to the attendee's browser ticket. `qr_image_url` inserts the ticket QR through the image chip. `download_page_url` is planned and currently renders empty. |
| Wallet | `apple_wallet_url`, `google_wallet_url` | In the body editor, these chips insert an Add to Wallet badge button (badge image linked to the placeholder). In a real attendee message, each link resolves once Wallet, and that specific platform, is turned on and configured for the event; otherwise it stays empty. Preview and Send test always show a placeholder link, by design, no matter how Wallet is configured. |
| Branding | `logo_url` | Inserts the event's logo through the image chip, or the organisation's logo when the event has none. Empty when neither is set. |

## Required ticket variables

`ticket_url` and `qr_image_url` are required URL values for the ticket template. A missing or invalid required URL stops rendering instead of producing a broken ticket.

## Syntax rules

- Use the exact lowercase form, for example `{{event_name}}`.
- Do not add spaces inside the braces.
- Do not invent a variable that is not offered by the editor.
- Put URL variables in a link destination and image variables in image markup. The chips help place them safely; use the `event_map_url` chip to insert a map image.
- Event image assets can add event-specific image variables. Use only assets listed by the editor.

## Related pages

- [Email Templates](Email-Templates)
- [Advanced: Editing MJML and HTML](Advanced-Email-Templates)
