# @admitto/mail-templates

Outlook-safe mail template renderer for Admitto ticket emails.

## Flow

1. **Save:** `body_template` (MJML or HTML) → `compileTemplate` → `compiled_html_template` (placeholders preserved).
2. **Send:** the compiled template + attendee vars are rendered with `renderTemplateTrustedForStorage` into a frozen `{ subject, html }` snapshot (link placeholders stay literal); at delivery time `materializeStoredDeliveryMessage` fills in the per-attendee links for `@admitto/mailer`. `renderTemplate` (with full placeholder validation) is what preview and test-send use. Subject is plain text (no HTML escaping); HTML body is escaped context-aware.

## Placeholders

Closed whitelist (plus, for event-scoped templates only, the tokens of that event's uploaded image assets, which are treated as optional image URL placeholders) - `{{snake_case}}` only, no interior whitespace (use `{{first_name}}`, not
`{{ first_name }}`). Any `{{...}}` token is validated: malformed names (e.g. `{{First_Name}}`,
`{{first-name}}`, padded spacing) and unknown names fail validation (fail-closed).

| Placeholder | Notes |
|-------------|-------|
| `first_name`, `last_name`, `full_name`, `email` | Attendee |
| `ticket_type` | The attendee's ticket type label (from the event's ticket-type catalog) |
| `event_hours` | Event hours range with the time zone abbreviation, for example "10:00 - 17:00 CEST"; empty when the event has no hours |
| `event_name`, `event_date`, `event_location`, `event_address`, `directions_text`, `accessibility_text` | Event location text; `event_location` is the venue name |
| `event_map_url` | Optional static map image URL; empty until the event has a saved pin, or when `LOCATION_MAPS_ENABLED=false` |
| `google_maps_url`, `apple_maps_url` | Optional directions links; empty until the event has a saved pin |
| `ticket_url`, `qr_image_url` | Required URLs - missing/empty values fail render |
| `logo_url`, `header_image_url` | Optional URLs - empty omits `src`/`href` (no `src=""`) |
| `apple_wallet_url`, `google_wallet_url` | Optional add-to-wallet links, filled per attendee when the event has wallet configured and that platform enabled (they open the Admitto redirect route that creates or reuses the pass); empty otherwise |
| `download_page_url` | Reserved - always empty today |

URL validation applies to **runtime values**, not to `href="{{ticket_url}}"` in the template source.

Placeholders in HTML attributes must use **quoted** values (`alt="{{first_name}}"`, not `alt={{first_name}}`).
Unquoted attribute placeholders are rejected at save and render time (spaces in attendee data can break out of the attribute).
Placeholders inside HTML or Outlook `<!--[if mso]>` conditional comments are also rejected (use live markup outside conditionals).

## Template formats

- **`mjml`** (default) - compiled on save via MJML → table-based, inline CSS HTML.
- **`html`** (advanced) - passthrough; author is responsible for Outlook-safe markup.

Built-in default is MJML, text-only header (no `{{logo_url}}` section).

Empty optional URL placeholders strip `src`, `href`, `action`, and `background` attributes (never `src=""`).

## Scope resolution

- Templates: the default `ticket` template resolves `resolveTemplate(eventId)` → event → organization → built-in default. Events and organizations can also hold additional named templates; `resolveTemplateById(templateId, eventId, prisma)` loads one that belongs to the event or its organization (otherwise `TemplateNotFoundError`).
- Branding URLs: `resolveBranding(eventId)` → event → organization → empty (columns on `Organization` / `Event`).

`event_date` and `event_hours` are display text, not ISO dates. `event_date` is a long date such as "1 September 2026"; day/month order and 12h vs 24h follow the event's Location country and fall back to en-GB. Both are computed by `formatDate` / `formatEventHoursRangeText` from `@admitto/shared/region-date-format`, identically in preview, test-send and real sends. `previewTemplate(eventId, prisma, sampleVars?, { baseUrl?, env? })` takes no time zone. `formatEventDate(date, timeZone)` (`YYYY-MM-DD`, default from `ADMITTO_DEFAULT_EVENT_TIMEZONE` or `UTC`) is exported for report and overview date bucketing and is not used for template variables.

## Outlook Classic rules (advanced HTML mode)

Target **Outlook Classic (Word engine)** on Windows. Outlook New/Mac/web use a web engine and are more forgiving.

**Layout**

- Nested `<table role="presentation" cellpadding="0" cellspacing="0" border="0">` only - no flex/grid/`position` for structure.
- Fixed **600px** width; ghost table: `<!--[if mso]><table width="600">…<![endif]-->`.
- Single column preferred.

**CSS**

- **Inline styles** on every `<td>`; explicit `font-family` (else Times New Roman).
- `mso-line-height-rule: exactly`; `border-collapse: collapse`; `mso-table-lspace/rspace: 0pt`.
- Word ignores: `max-width`, div margins, `border-radius`, `box-shadow`, `background-image` (without VML).

**Buttons**

- Bulletproof CTA: VML `v:roundrect` fallback for Outlook.

**Images**

- `width` / `height` attributes + `display: block` + `alt`.
- **No data-URI** images (blocked in many clients).
- Hosted PNG for QR (`/q/:token.png` - wired in PR4).

**Head**

- DPI fix: `<o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch>`.

MJML handles most of the above automatically; custom HTML authors must follow this list.

## API

```ts
import {
  compileTemplate,
  renderTemplate,
  validateTemplate,
  resolveTemplate,
  setMailTemplate,
  resolveBranding,
  previewTemplate,
} from "@admitto/mail-templates";
```

Browser code (`apps/admin`) must import the subpaths `@admitto/mail-templates/placeholders` and `@admitto/mail-templates/branding`, never the package root, which pulls in `mjml` and node-only modules. Also exported: `resolveTemplateForEvent`, `resolveTemplateById`, `createMailTemplate`, `updateMailTemplateMetadata`, `renderTemplateTrustedForStorage` and `materializeStoredDeliveryMessage`.

## Security

- Placeholder **values** are HTML-escaped (text vs attribute context).
- Template **content** is admin-authored (trusted, RBAC).
- Templates are **not encrypted** (not secrets).
