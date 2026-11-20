# @admitto/mail-templates

Outlook-safe mail template renderer for Admitto ticket emails.

## Flow

1. **Save:** `body_template` (MJML or HTML) → `compileTemplate` → `compiled_html_template` (placeholders preserved).
2. **Send:** the compiled template + attendee vars are rendered with `renderTemplateTrustedForStorage` into a frozen `{ subject, html }` snapshot (link placeholders stay literal).
   - At delivery time, `materializeStoredDeliveryMessage` fills in the per-attendee links for `@admitto/mailer`.
   - `renderTemplate` (with full placeholder validation) is what preview and test-send use.
   - Subject is plain text (no HTML escaping). The HTML body is escaped context-aware.

## Placeholders

- The whitelist is closed. For event-scoped templates only, it also includes the tokens of that event's uploaded image assets, which are treated as optional image URL placeholders.
- Only `{{snake_case}}` is allowed, with no interior whitespace. Use `{{first_name}}`, not `{{ first_name }}`.
- Any `{{...}}` token is validated. Malformed names (e.g. `{{First_Name}}`, `{{first-name}}`, padded spacing) and unknown names fail validation (fail-closed).

| Placeholder | Notes |
|-------------|-------|
| `first_name`, `last_name`, `full_name`, `email` | Attendee. In a registration mail the three names stay empty until the guest has confirmed the address or staff have decided about the registration ([System templates](#system-templates-registration-mails)) |
| `ticket_type` | The attendee's ticket type label (from the event's ticket-type catalog) |
| `event_hours` | Event hours range with the time zone abbreviation, for example "10:00 - 17:00 CEST"; empty when the event has no hours |
| `event_name`, `event_date`, `event_location`, `event_address`, `directions_text`, `accessibility_text` | Event location text; `event_location` is the venue name |
| `event_map_url` | Optional static map image URL; empty until the event has a saved pin, or when `LOCATION_MAPS_ENABLED=false` |
| `google_maps_url`, `apple_maps_url` | Optional directions links; empty until the event has a saved pin |
| `ticket_url`, `qr_image_url` | Required URLs - missing/empty values fail render |
| `logo_url`, `header_image_url` | Optional URLs - empty omits `src`/`href` (no `src=""`) |
| `apple_wallet_url`, `google_wallet_url` | Optional add-to-wallet links, filled per attendee when the event has wallet configured and that platform enabled (they open the Admitto redirect route that creates or reuses the pass); empty otherwise |
| `download_page_url` | Reserved - always empty today |
| `confirm_url` | Signed e-mail confirmation link of a guest registration (`buildConfirmUrl` in `@admitto/mail-delivery`). An optional URL placeholder, not required; only `registration-confirm` carries a value |
| `contact_name`, `contact_email` | Who the guest writes to: the first event contact with an e-mail by `sort_order`, else the organization's support contact (`resolveEventContactVars`). Empty when neither exists. Refused at save time outside registration mails |
| `contact_line` | The whole sentence "Questions? Contact NAME at EMAIL.", or empty when there is no contact. Every built-in registration body uses it. Refused at save time outside registration mails |

URL validation applies to **runtime values**, not to `href="{{ticket_url}}"` in the template source.

- Placeholders in HTML attributes must use **quoted** values (`alt="{{first_name}}"`, not `alt={{first_name}}`).
- Unquoted attribute placeholders are rejected at save and render time (spaces in attendee data can break out of the attribute).
- Placeholders inside HTML or Outlook `<!--[if mso]>` conditional comments are also rejected (use live markup outside conditionals).

## System templates (registration mails)

`SYSTEM_TEMPLATE_NAMES` lists the mails a guest gets before an attendee exists: `registration-confirm`, `registration-received`, `registration-waitlist`, `registration-rejected`. Each has an English built-in default; an organizer's override is an ordinary `MailTemplate` row under the same name. `ticket` is not one of them: it stays the one template ticket delivery sends.

- Ask `isSystemTemplateName(name)`, not a literal. A system row is flagged `is_system` in the template list, is not counted toward the ten-template cap, is refused by bulk send (422) and does not block permanent event deletion. `isReservedTemplateName` also covers `ticket`, for a free template's name.
- `systemTemplateLabel(name)` is the name of each mail in the template picker: the label of its built-in default and of a row saved for the first time. It is in this subpath because the admin SPA, which may not import the built-in sources, shows the same name before and after the mail has a row.
- Staff edit these mails in Communication > Templates. A mail that runs on its default is opened, previewed, saved and test-sent by name (`/api/admin/events/:eventId/system-templates/:name`). From its first save it is an ordinary row that the by-id routes serve, and deleting that row reverts the mail to the default: the organization's text if there is one, else the built-in one.
- The body of `registration-confirm` must hold `{{confirm_url}}` (`requiredPlaceholdersForTemplate`, checked by the admin routes with `findMissingRequiredPlaceholders`): a confirmation mail without its link is of no use to the guest. A stored template that lost it fails its queue row for good when the worker renders it.
- A system template cannot use `ticket_url`, `qr_image_url`, `apple_wallet_url`, `google_wallet_url`, `download_page_url` or `ticket_type` (`SYSTEM_TEMPLATE_FORBIDDEN_PLACEHOLDERS`). `setMailTemplate` and `createMailTemplate` apply it through `disallowedPlaceholdersForTemplate(name)`; the admin routes pass the same set to template validation.

What the worker fills in when it sends a registration mail (`drainRegistrationMails` in `@admitto/mail-delivery`):

| Placeholder | Value |
|---|---|
| `event_name`, `event_date`, `event_hours`, `event_location` and the other place and map placeholders, `logo_url`, `header_image_url`, the event's image tokens | As in every other mail |
| `contact_name`, `contact_email`, `contact_line` | `resolveEventContactVars` |
| `confirm_url` | `registration-confirm` only: the signed link of the registration. Empty in the other three |
| `email` | The address the mail goes to |
| `first_name`, `last_name`, `full_name` | The guest's names **only when the address is theirs**: `email_verified_at` is set, or staff decided about the registration (`decided_by`). Before that they are empty |
| `ticket_url`, `qr_image_url`, the wallet links, `download_page_url`, `ticket_type` | Always empty, and refused when a template is saved. A template that already holds `{{ticket_url}}` fails its own queue row for good, and the other rows go on |

- Until an address is confirmed, anyone can type any text for any address. So an unconfirmed guest's names never reach a subject or a body, even from an edited template. The built-in mails greet with "Hello," for that reason. Write an edited greeting so that it reads well without a name.
- A registration mail is rendered with `renderTemplate`, the full placeholder check, at the moment it is sent, from the template as it is then. A template that cannot be rendered fails that one row.

## Template formats

- **`mjml`** (default) - compiled on save via MJML → table-based, inline CSS HTML.
- **`html`** (advanced) - passthrough; author is responsible for Outlook-safe markup.

Built-in default is MJML, text-only header (no `{{logo_url}}` section).

Empty optional URL placeholders strip `src`, `href`, `action`, and `background` attributes (never `src=""`).

## Scope resolution

- Templates: the default `ticket` template resolves `resolveTemplate(eventId)` → event → organization → built-in default. Both `resolveTemplate` and `resolveTemplateForEvent` take an optional last `name` argument (default `ticket`), so every existing caller is unchanged. Events and organizations can also hold additional named templates; `resolveTemplateById(templateId, eventId, prisma)` loads one that belongs to the event or its organization (otherwise `TemplateNotFoundError`).
- Built-in defaults are a registry by name (`getBuiltinTemplate(name = "ticket")`, source and label through `getBuiltinTemplateSource`). A name with no default throws `UnknownBuiltinTemplateError`; it never falls back to the ticket mail.
- Branding URLs: `resolveBranding(eventId)` → event → organization → empty (columns on `Organization` / `Event`).

- `event_date` and `event_hours` are display text, not ISO dates.
- `event_date` is a long date such as "1 September 2026". The day/month order and 12h vs 24h follow the event's Location country, and fall back to en-GB.
- Both are computed by `formatDate` / `formatEventHoursRangeText` from `@admitto/shared/region-date-format`, identically in preview, test-send and real sends.
- `previewTemplate(eventId, prisma, sampleVars?, { baseUrl?, env? })` takes no time zone.
- `formatEventDate(date, timeZone)` (`YYYY-MM-DD`, default from `ADMITTO_DEFAULT_EVENT_TIMEZONE` or `UTC`) is exported for report and overview date bucketing. It is not used for template variables.

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

- Browser code (`apps/admin`) must import the subpaths `@admitto/mail-templates/placeholders`, `@admitto/mail-templates/systemTemplates` and `@admitto/mail-templates/branding`, never the package root, which pulls in `mjml` and node-only modules.
- Also exported: `resolveTemplateForEvent`, `resolveTemplateById`, `createMailTemplate`, `updateMailTemplateMetadata`, `renderTemplateTrustedForStorage` and `materializeStoredDeliveryMessage`.

## Security

- Placeholder **values** are HTML-escaped (text vs attribute context).
- Literal angle brackets inside quoted attribute values do not change the escaping context; quotes in attendee values remain attribute data, including in frozen delivery snapshots.
- Validation and rendering use HTML5 token boundaries from the pinned `parse5` dependency, and scan attribute contexts forward per template.
  - Raw-text/RCDATA content and declarations do not become attribute markup.
  - Repeated placeholders do not rescan earlier markup.
  - The source is never reserialized, and the parser executes no scripts or external IO.
  - Trusted rendering skips whitelist revalidation but still refuses unquoted or structural slots that could construct a tag name or change script text boundaries.
- Template **content** is admin-authored (trusted, RBAC).
- Templates are **not encrypted** (not secrets).
