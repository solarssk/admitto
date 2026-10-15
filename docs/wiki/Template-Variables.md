# Template Variables

**Audience:** Event Managers and Technical Event Managers · **Required role:** Administrator · **Feature status:** ✅ Available · **Last verified:** Admitto 0.5.4

Use the variable chips shown in **Communication → Templates**. The editor is the source of truth for the variables available to the selected template. The chips are grouped the same way in the editor: Attendee, Event, Ticket & QR, Wallet and Branding.

## Attendee

| Variable | Use |
|----------|-----|
| `first_name`, `last_name`, `full_name`, `email` | Personalise visible text. Avoid putting personal data in the subject unless it is necessary |

## Event

These show details from the current event.

| Variable | Shows |
|----------|-------|
| `event_name` | The event's name |
| `event_date` | The event date, in the event's own regional convention and timezone, the same way it appears on the attendee's ticket. For example `21 August 2026` |
| `event_hours` | The start and end time, in the event's own regional convention and timezone, the same way it appears on the ticket. For example `10:00 am - 6:05 pm IST`. It shows an open-ended `from` or `until` when only one of start and end is set. It is empty when Event settings has no start or end time |
| `event_location` | The venue name |
| `event_address`, `directions_text`, `accessibility_text` | The venue address, and the directions and accessibility notes from the event |
| `event_map_url` | A static map image. Insert it through the image chip |
| `google_maps_url`, `apple_maps_url` | Plain links. When an admin pastes corrected Maps URLs on the Location tab (**Pin wrong? Fix link**), these use those links instead of building them from coordinates |

- Map and link values are empty until the event has a saved location pin.
- When maps display is disabled for the instance, `event_map_url` stays empty, so there is no broken image.

## Ticket & QR

| Variable | Shows |
|----------|-------|
| `ticket_type` | The attendee's ticket type label (for example "Standard" or "VIP"). It reads "General" when the attendee has no ticket type assigned |
| `ticket_url` | A link to the attendee's browser ticket |
| `qr_image_url` | The ticket QR code. Insert it through the image chip |
| `download_page_url` | Planned. It currently renders empty |

## Wallet

| Variable | Use |
|----------|-----|
| `apple_wallet_url`, `google_wallet_url` | In the body editor, these chips insert an Add to Wallet badge button (a badge image linked to the placeholder) |

- Each chip is offered, and a template can be saved with it, only while that specific platform is turned on in the event's Wallet settings. If you turn a platform off later, a template that still has its chip cannot be saved again until you remove the chip or turn the platform back on.
- Preview and Send test always show a placeholder link, by design, no matter how Wallet is configured.

## Branding

| Variable | Shows |
|----------|-------|
| `logo_url` | The event's logo, inserted through the image chip. It falls back to the organisation's logo when the event has none, and is empty when neither is set |

## Required ticket variables

`ticket_url` and `qr_image_url` are required URL values for the ticket template. A missing or invalid required URL stops rendering instead of producing a broken ticket.

## Syntax rules

- Use the exact lowercase form, for example `{{event_name}}`.
- Do not add spaces inside the braces.
- Do not invent a variable that is not offered by the editor.
- Put URL variables in a link destination and image variables in image markup. The chips help place them safely. Use the `event_map_url` chip to insert a map image.
- Event image assets can add event-specific image variables. Use only assets listed by the editor.

## Related pages

- [Email Templates](Email-Templates)
- [Advanced: Editing MJML and HTML](Advanced-Email-Templates)
