# @admitto/mail-templates

Outlook-safe mail template renderer for Admitto ticket emails.

## Flow

1. **Save:** `body_template` (MJML or HTML) → `compileTemplate` → `compiled_html_template` (placeholders preserved).
2. **Send:** `compiled_html_template` + attendee vars → `renderTemplate` → `{ subject, html }` for `@admitto/mailer`. Subject is plain text (no HTML escaping); HTML body is escaped context-aware.

## Placeholders

Closed whitelist — `{{snake_case}}` only, no interior whitespace (use `{{first_name}}`, not
`{{ first_name }}`). Any `{{...}}` token is validated: malformed names (e.g. `{{First_Name}}`,
`{{first-name}}`, padded spacing) and unknown names fail validation (fail-closed).

| Placeholder | Notes |
|-------------|-------|
| `first_name`, `last_name`, `full_name`, `email` | Attendee |
| `event_name`, `event_date`, `event_location` | Event |
| `ticket_url`, `qr_image_url` | Required URLs — missing/empty values fail render |
| `logo_url`, `header_image_url` | Optional URLs — empty omits `src`/`href` (no `src=""`) |
| `apple_wallet_url`, `google_wallet_url`, `download_page_url` | Reserved — empty until v0.5 |

URL validation applies to **runtime values**, not to `href="{{ticket_url}}"` in the template source.

Placeholders in HTML attributes must use **quoted** values (`alt="{{first_name}}"`, not `alt={{first_name}}`).
Unquoted attribute placeholders are rejected at save and render time (spaces in attendee data can break out of the attribute).
Placeholders inside HTML or Outlook `<!--[if mso]>` conditional comments are also rejected (use live markup outside conditionals).

## Template formats

- **`mjml`** (default) — compiled on save via MJML → table-based, inline CSS HTML.
- **`html`** (advanced) — passthrough; author is responsible for Outlook-safe markup.

Built-in default is MJML, text-only header (no `{{logo_url}}` section).

Empty optional URL placeholders strip `src`, `href`, `action`, and `background` attributes (never `src=""`).

## Scope resolution

- Templates: `resolveTemplate(eventId)` → event → organization → built-in default.
- Branding URLs: `resolveBranding(eventId)` → event → organization → empty (columns on `Organization` / `Event`).

`event_date` in templates is a calendar string (`YYYY-MM-DD`). Use `formatEventDate(date, timeZone)` (exported) so local event midnights do not shift to the previous UTC day. `previewTemplate` accepts optional `{ timeZone }`; default from `ADMITTO_DEFAULT_EVENT_TIMEZONE` env or `UTC`.

## Outlook Classic rules (advanced HTML mode)

Target **Outlook Classic (Word engine)** on Windows. Outlook New/Mac/web use a web engine and are more forgiving.

**Layout**

- Nested `<table role="presentation" cellpadding="0" cellspacing="0" border="0">` only — no flex/grid/`position` for structure.
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
- Hosted PNG for QR (`/q/:token.png` — wired in PR4).

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

## Security

- Placeholder **values** are HTML-escaped (text vs attribute context).
- Template **content** is admin-authored (trusted, RBAC).
- Templates are **not encrypted** (not secrets).
