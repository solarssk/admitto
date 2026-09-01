# Validation Reference

**Audience:** All staff · **Required role:** Any staff role (Superadmin-only sections are marked) · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.4

Every field-level and cross-field rule Admitto enforces, organised by screen. Use this page when a
save is rejected and you want to know exactly why, or when you're preparing data or configuration
and want to check the limits up front. A rule marked **frontend only** blocks the Save button before
a request is even sent; **backend** means the server re-checks it regardless of what the browser
already validated (so scripted or API access can't skip it); **both** means the same rule is
enforced twice, once for immediate feedback and once for real.

## Sign-in and account security

### Signing in

| Rule | What you'll see |
|---|---|
| Email and password are both required | "Invalid email or password." |
| Wrong password, unknown email, and a disabled account all return the *same* generic failure, at the *same* speed - by design, so a failed attempt can't be used to guess which part was wrong | "Invalid email or password." |
| Max 10 login attempts per IP address, per minute | "Too many requests." |
| Max 10 login attempts per email address, per minute (separate limit, checked after a failed attempt) | "Too many requests." |
| Passkey sign-in: max 10 attempts per minute, in two separate stages (start / finish) | "Too many requests." |
| A rejected or cancelled passkey sign-in re-enables the password form | "Could not sign in with your passkey. Try again, or use your email and password below." |
| 5 consecutive failed sign-ins or MFA attempts against an admin/superadmin account raises an internal security alert - this doesn't change what you see, it's recorded for a Superadmin reviewing [Logs and Audit](Logs-and-Audit) | No visible change |
| An owed backup-codes acknowledgement or a forced password change cannot be skipped by closing the tab or calling the API directly - your session is held at that step until you complete it | Redirected back to the required step every time |

### Passwords

| Rule | What you'll see |
|---|---|
| At least 12 characters, everywhere a password is set (sign-up, change, admin reset, invite, CLI bootstrap) | "Password must be at least 12 characters." |
| Must not be a common or easily-guessed password (a fixed blocklist, plus simple patterns like `aaaaaaaaaaaa` or `abcdefghijkl`) | "This password is too common or predictable. Choose a different one." |
| **No** required mix of upper/lower/digit/symbol - this is deliberate (current guidance is that composition rules push people toward predictable substitutions without meaningfully improving security). The password-strength meter you see while typing is advisory only and never blocks saving | n/a |
| New password and its confirmation must match | "Passwords do not match." |
| Changing your own password requires your current password, and a step-up code (authenticator app, backup code, or passkey/security key) if your role requires two-factor and you have a confirmed method | "Current password is incorrect." / "Enter your authenticator app code to continue." |

### Two-factor authentication (TOTP)

| Rule | What you'll see |
|---|---|
| A 6-digit numeric code is treated as an authenticator-app code; anything else is treated as a backup code | Routed automatically, no separate message |
| A code must be current (±30 seconds) and **cannot be reused** - even a code that's numerically correct is rejected if it (or an earlier one) was already accepted | "Invalid code. Try again." |
| Enrolling requires a local password - an account that only signs in via SSO can't enroll local 2FA until it has one | "Password is managed by your identity provider." |
| Max 10 verification attempts per 15 minutes (checked per session **and** per IP - both must pass) | "Too many requests." |
| Across every 2FA-protected action combined (not just one), max 20 proof attempts per 15 minutes, so switching between actions can't multiply your attempts | "Too many requests." |
| After your *first* confirmed 2FA method, you must acknowledge saving your backup codes before continuing - this can't be bypassed | Redirected to the backup-codes step |

### Passkeys and security keys

| Rule | What you'll see |
|---|---|
| A name/nickname is required when registering one, up to 120 characters | Add button stays disabled until you enter one |
| A cloned or replayed credential is detected and rejected (each use must move the credential's internal counter forward) | "Could not verify the passkey/security key. Try again." |
| A setup request expires after 5 minutes and can only be used once | "This passkey/security key setup request expired. Start again." |
| Registration and sign-in only work if a Superadmin has turned passkeys/security keys on for the instance | "Passkeys and security keys are turned off for this instance. Ask an administrator to enable them." |
| Max 10 attempts per 15 minutes, per session and per IP | "Too many requests." |

## Identity providers and Cloudflare Access (Superadmin)

### OIDC / SSO provider setup

| Field | Requirement |
|---|---|
| Display name | Required, up to 200 characters |
| Issuer URL | Required, up to 2000 characters, must start with `http(s)://` |
| Client ID | Required, up to 500 characters |
| Client secret | Required when first creating the provider; leaving it blank on a later edit keeps the existing stored secret |
| Authorization / Token / JWKS / UserInfo endpoints | Optional (usually filled by **Discover**); if entered by hand, must look like a URL |
| Claim mapping fields (email, name, groups, etc.) | Optional, up to 200 characters each |
| Sign-in button label | Optional, up to 120 characters |
| Group → role mapping row | Group name required; role required; the scope type is fixed by the role (Superadmin→instance, Admin→organisation, Operator→event) and a matching scope ID is required for the latter two |

Beyond the form itself: every URL Admitto actually calls (issuer, discovery, JWKS, endpoints) must
use HTTPS and must not point at a private, loopback, or internal address - unless your Superadmin
has explicitly allow-listed that host for a LAN identity provider. Saving a provider's role mappings
always replaces the full list; the request is rejected outright rather than silently deleting your
mappings if that list is missing. Two identity providers can't share the same issuer.

### Cloudflare Access setup

| Field | Requirement |
|---|---|
| Team URL | Required when enabled; must resolve to `https://<your-team>.cloudflareaccess.com` |
| Application Audience (AUD) tag | At least one required when enabled |
| Direct identity provider | Required when enabled, and must be an already-enabled OIDC provider |
| Protected URL paths | Each must start with `/`; falls back to `/admin`, `/api/admin`, `/api/checkin` if left blank |

See [Identity and SSO](Identity-and-SSO) and [Cloudflare Access - Identity Linking](Cloudflare-Access-Identity-Linking) for what each of these actually does and the full list of sign-in denial reasons.

## User management (Superadmin)

| Rule | What you'll see |
|---|---|
| Email must be a valid address and not already used by another account | "Enter a valid email address." / "A user with this email already exists." |
| An **Operator** role must be scoped to an event; an **Admin** role must be scoped to an organisation; a **Superadmin** role has no scope at all | "Select an event for the operator role." / "Select an organization for the admin role." |
| A person holds exactly one role type at a time - assigning a new type revokes the old one, with a confirmation first | "Changing to {role} removes {name}'s current {role} access." |
| You can never remove, deactivate, or delete the last active Superadmin | "Cannot remove or deactivate the last superadmin." |
| You cannot change or remove your own role, deactivate or delete your own account, or unlink your own SSO - ask another Superadmin | "You cannot change your own role. Ask another superadmin." (and similar) |
| A role granted automatically by identity-provider group sync can't be removed by hand | "This role is managed by an identity provider and cannot be removed." |
| Resetting 2FA or a password for an SSO-managed account is blocked - unlink SSO first | "This account is managed by an identity provider. Unlink it first..." |
| Resetting another **Superadmin's** 2FA/password, or force-ending their sessions, requires the acting Superadmin to prove their own identity first (authenticator code, backup code, or passkey/security key) | "You need a confirmed authenticator app, passkey, or security key on your own account before you can reset another superadmin's two-factor or password, or revoke their sessions." |
| An Administrator (not Superadmin) can only grant or remove the Operator role, and only for events in an organisation they administer | "You do not have access." |

## Account self-service (My Account)

| Rule | What you'll see |
|---|---|
| Email cannot be changed here at all | Field is read-only with an explanatory note |
| Profile fields (display name, locale, time format, phone) have individual length limits; at least one must actually change | n/a - Save has nothing to do otherwise |
| You can never revoke your own current session from any session list | "You cannot revoke your current session." |
| Removing a confirmed 2FA method, resetting everything, or regenerating backup codes each requires proving your identity again first (current password, plus a step-up code if your role requires 2FA) | "Current password is incorrect." / "Enter your authenticator app code to continue." |
| Unlinking SSO always requires setting a fresh local password in the same step, plus a step-up code if you have confirmed 2FA; an account with neither a password nor confirmed 2FA to verify with can't self-unlink | "This account has no password or confirmed two-factor method to verify with. Ask a superadmin for help." |
| Unlinking SSO is blocked while any of your roles are still managed by that identity provider | "Some of your roles are managed by an identity provider. Ask an administrator to remove them first." |
| Re-authentication attempts (for any of the above) are capped at 10 per window, per account and per IP | "Too many requests." |

## Attendees, import, and requirements

### Adding or editing an attendee

| Field | Requirement |
|---|---|
| First name, last name | Required, up to 100 characters each |
| Email | Required, a real-looking address, up to 254 characters |
| Company, department | Optional, up to 200 characters each |
| Ticket type | Must exist in the event's current ticket-type catalog - checked again at the moment you save, in case it was deleted in the meantime |

An attendee's email must be unique within the event - a second attendee with the same address is
rejected ("This email is already registered for this event."). If two staff members edit the same
attendee at once, the second save is rejected with "Someone else changed this record. Reload and
try again." rather than silently overwriting the first change. Restoring a revoked attendee
re-checks the event's capacity limit, the same as adding a brand-new one.

### CSV/XLSX import

| Rule | What you'll see |
|---|---|
| File must be `.csv` or `.xlsx`, up to 5 MB | "Unsupported file type. Upload a .csv or .xlsx file." / "File exceeds the 5 MB limit." |
| File content is checked against its real format, not just its extension | "The file could not be read. Check that it is a valid CSV or XLSX." |
| Up to 50,000 data rows per file | "File exceeds the row limit. Split the file and import in parts." |
| A row needs both first and last name, and a valid, non-empty email | "Both first_name and last_name are required." / "Missing email." / "Invalid email: ..." |
| The same email, agency ID, or QR payload can't appear twice **within one file** | "Duplicate email in file: ..." (and similarly for the others) |
| An unrecognised ticket type or custom-field value fails that row, not the whole import | "Unknown ticket type: ..." / "Invalid value for {field} (expected one of: ...)" |
| A row that matches an existing attendee is skipped unless "Overwrite existing attendees" is on | "Attendee already exists. Turn on 'Overwrite existing attendees' to update it instead of skipping." |
| Overwriting only ever updates name, ticket type, company, department, and custom fields - never status, QR code, or token | n/a - by design |
| The whole import is still capped by the event's capacity, the same as adding attendees one at a time (a Superadmin can override it) | "Import would exceed capacity. {current} existing + {incoming} new = {projected} &gt; {capacity}." |

Every row gets its own pass/fail reason in the preview before you commit - nothing is guessed or
silently dropped. See [Import File Reference](Import-File-Reference) for the full column reference.

### Custom attendee fields (Requirements page)

| Field | Requirement |
|---|---|
| Field key | Auto-derived, lowercase letters/numbers/underscore only |
| Label | Required, up to 60 characters |
| Description | Optional, up to 500 characters |
| Type | Text, select, or yes/no |
| Select options | At least one required for a select field; up to 20 options, each up to 60 characters |

An event can have up to 20 custom fields. A field currently used as a hint on an Event item can't be
deleted until you remove it there first. Renaming or removing a select option that attendees have
already chosen asks you to confirm, naming how many attendees are affected, rather than silently
changing what they see or blocking you outright. An attendee's answer to a required field can't be
left blank; a select answer must be one of the configured options; a yes/no answer accepts
Yes/No/true/false (case-insensitive).

### Event items (Requirements page)

An item's name is required (up to 100 characters); its internal key is derived automatically and
kept unique. An item currently issued to any attendee (and not yet returned) can't be disabled or
deleted - return it first. The built-in "Badge" item can never be deleted, only disabled. Turning on
"Issue badge at entry" (Check-in behaviour tab) is blocked unless the Badge item itself is active
and set to issue on check-in.

### Bulk attendee operations

Every bulk action (change RSVP status, change ticket type, set company/department) accepts 1 to 500
attendees at a time. If someone else changes one of the selected attendees at the very same moment,
that one row is quietly left alone and reported back separately (e.g. "12 attendees set to X (2
already had it) (1 skipped, changed by someone else just now)") rather than overwriting their change
or failing the whole batch.

## Event settings

### General information

| Field | Requirement |
|---|---|
| Event name | Required, up to 200 characters |
| Date | A real calendar date (rejects e.g. 30 February) |
| Capacity | A positive whole number, or blank for unlimited |
| Timezone | A real timezone name |
| Event hours | 24-hour `HH:MM` format |
| Event type | One of a fixed list (Conference, Concert, Sports, etc.), or none |

**Capacity is not re-checked when you lower it** - if you reduce an event's capacity below its
current attendee count, Admitto lets the save go through with no warning. The limit is enforced
later, when someone tries to *add* a new attendee or commit an import that would exceed it ("Event
has reached its capacity limit." / "Import would exceed capacity."). Every field on this tab is
locked once the event is archived ("This event is archived.").

### Wallet (Superadmin only)

Editing anything under Wallet requires Superadmin access, even though an Administrator can edit
every other Event Settings tab. A field-mapping row needs both a PassCreator field key (letters,
numbers, underscore, starting with a letter) and a value chosen from a fixed list of attendee/event
tokens - the editor won't let you pick the same source value on two different rows, and warns before
saving a row that has one but not the other. **Test connection** translates PassCreator's own
rejection reasons into plain text (wrong API key, template not found, PassCreator rate-limiting
you, or a timeout).

### Location

| Field | Requirement |
|---|---|
| Venue name | Up to 300 characters |
| Full address | Up to 500 characters |
| Directions / accessibility notes | Up to 2000 characters each |
| Room, entrance/door/gate/portal identifiers, phone number | Up to 300 characters each |
| Opening times (venue, doors, gates, box office, parking, fan zone) | 24-hour `HH:MM` format |
| Latitude / longitude | Real coordinates, and always set (or cleared) together - never just one |
| Map zoom | A whole number between 1 and 19 |
| Google/Apple Maps link overrides | Must be a real `https://` link to that provider's own maps domain |

If the event already has installed wallet passes, changing a wallet-relevant location field (address, coordinates, directions, venue details) asks you to confirm before pushing that update to every installed pass.

### Danger zone (mostly Superadmin)

- **Deleting** an event is only allowed once it has zero attendees, zero non-default items, zero non-standard ticket types, zero contacts/resources, no pinned note, and no extra mail template - the exact list of what's still blocking is shown to you, and re-checked on the server even if your screen is out of date.
- **Archiving or unarchiving** is Superadmin-only, and archiving an already-archived event (or the reverse) is rejected rather than silently accepted.
- **Revoking every check-in or every issued item at once** is Superadmin-only, and disabled if there's currently nothing to revoke.
- Every destructive action here except Delete and Unarchive is blocked while the event is archived.

### Check-in behaviour

Turning on "Issue badge at entry" is rejected unless the event's badge item actually exists, is
enabled, and has "Issue on check-in" turned on - fixed with a clear tooltip explaining which of the
three is missing. Turning off manual lookup for an event takes effect immediately at check-in, not
just in settings.

## Communication

### Templates

| Field | Requirement |
|---|---|
| Subject | Required, up to 500 characters |
| Body | Required, up to 200,000 characters |
| Template label (when creating one) | Required |
| Icon / description (template metadata) | Optional, short limits |

Beyond length limits, the template editor checks the actual content as you type (re-validating
about half a second after you stop):

- **Only known placeholders** (`{{first_name}}`, `{{ticket_url}}`, and about 20 others, plus that
  event's own branding-image tokens) are allowed - an unrecognised one is flagged by name.
- **`{{ticket_url}}` and `{{qr_image_url}}` must both appear somewhere** in the subject or body
  combined - a template that never actually shows the ticket link or QR code is rejected, even if
  every placeholder it does use is individually valid.
- A placeholder written inside an HTML comment, or used unquoted inside an HTML attribute, is
  rejected - both would silently fail to work in a real mail client.
- An MJML-format template is compiled and checked for structural errors (invalid attribute, unknown
  element, wrong nesting, missing title) with a plain-language explanation and the line number.
  HTML-format templates skip this check.
- An event can have **up to 10 saved templates**; a new one's internal name must be unique within
  the event (handled automatically from the label you type).

### Sending (Communication → Send)

| Rule | What you'll see |
|---|---|
| A recipient filter (by ticket type, or specific attendees) must have an actual value chosen | Count/Send buttons stay disabled until you pick one |
| At most 500 attendees can be targeted by one send | "Too many attendees selected." |
| Sending is blocked while the Templates tab has unsaved edits - a send always uses the last **saved** version | "You have unsaved template changes. Save them on the Templates tab first..." |
| Sending is blocked once the event is archived | "This event is archived." |
| Real sends (not the "count recipients" dry run) are capped at 3 per 10 minutes per admin | "Bulk sends are limited to 3 requests every 10 minutes. Try again later." |
| Stopping a send asks for confirmation first, and explains that already-sent messages can't be recalled | "Attendees not yet emailed won't receive it. Anyone already sent the email keeps it..." |

## Check-in and the public ticket page

### Scanning and manual lookup

| Scan result | What the operator sees |
|---|---|
| Valid, unused ticket | "Check-in recorded." |
| Already checked in | "This guest is already checked in." |
| Revoked or cancelled ticket | "This ticket has been revoked or cancelled." |
| Code not recognised | "This code is not valid for this event. Check the QR or use manual lookup." |
| Event requires confirmation before admitting | "Attendee found. Confirm check-in below." (not checked in until you explicitly confirm) |

Two near-simultaneous scans of the same ticket can never both succeed - the loser is reported as
"already checked in", never a duplicate admission. Manual lookup only searches name and email
(never company or department), is capped at 20 results, and does nothing on an empty search. If
manual lookup is turned off for an event, both the button and the underlying request are blocked:
"Manual lookup is disabled for this event. Use QR scan only." All check-in actions from one
device/session share a combined limit of 120 requests per minute.

### Public ticket page

An invalid or unrecognised ticket link shows "This link is invalid or the page no longer exists."
A revoked or cancelled ticket shows "This ticket is no longer valid for entry" rather than the
QR/wallet content. Every response - including error pages - is served with strict caching (never
cached by a shared computer) and no search-engine indexing.

## Wallet actions (Attendee Detail and bulk)

Void, Restore, Push updates, Refresh status, and Delete all require Wallet to actually be configured
for the event and, except Delete's target existing, a wallet pass to exist on that attendee - each
gives a specific reason otherwise ("This attendee has no wallet pass to act on.", "Wallet isn't
configured for this event."). Void, Restore, Push updates, and Delete each require an explicit
confirmation dialog first; Delete's warns that the action is permanent and that Apple/Google Wallet
gives no way to remove a pass from someone's phone - only they can do that.

A provider (PassCreator) rejection is always translated to a specific reason - a wrong API key, the
pass not found, PassCreator rate-limiting the instance, or a timeout - never a bare error. Revoking
or restoring an attendee's admission status automatically voids or restores their wallet pass to
match, best-effort, without blocking the attendee save itself if that sync fails. Single-attendee
wallet actions are limited to 10 per minute per admin/event; bulk wallet actions accept up to 100
attendees per request, one bulk action at a time per admin/event, and silently skip (not error)
anyone who has no pass or is already in the target state - reported back as a count, e.g. "3 had no
pass, or it was already voided."

## Organisation settings (Superadmin)

### Mail transport

The active provider (Microsoft 365 Graph, SMTP, or Power Automate) determines which fields are
required - for example SMTP needs a host and port, Graph needs a tenant and client ID. Across all
providers:

| Rule | What you'll see |
|---|---|
| A from/reply-to/envelope address, when set, must be a real-looking email at a real top-level domain | "From address must be a valid email." |
| An SMTP host or Power Automate URL can't point at a private, internal, or loopback address - checked both when you save it and again right before Admitto actually connects | "The mail destination host resolves to a private address..." |
| A Power Automate URL must use HTTPS | "url must use HTTPS" |
| SMTP port must be between 1 and 65535 | "SMTP port must be between 1 and 65535." |
| Advanced SMTP tuning (connection limits, timeouts, rate limit) must be positive whole numbers when set | "{Field} must be a positive whole number." |
| An "allowed sender domain," if configured, must exactly match the domain actually used to send | "{Field} must use the allowed domain (...)." |
| A field currently set by an environment variable can't be edited here at all | "This setting is controlled by an environment variable and can't be changed here." |
| Saving is rejected up front if the resulting configuration would actually be incomplete for sending mail, rather than only failing on the next real send | "Fill in all required fields for this mail transport before saving." |

### Branding

| Field | Requirement |
|---|---|
| Theme colour | A 6-digit hex colour (e.g. `#066fd1`) |
| Font family name | Letters, numbers, spaces, hyphens, underscores, or periods only, up to 128 characters |
| Logo / header image upload | PNG, JPG, or WebP, up to 2 MB, verified by its actual file content (not just the filename) |
| Custom font upload | WOFF, WOFF2, TTF, or OTF, up to 5 MB *(the error message currently says "2 MB" for a rejected font file - that's a known display bug, the real limit is 5 MB)* |

### External services (Weather and Maps)

Every base URL you configure (Open-Meteo, Nominatim, a custom map tile server) is checked the same
way mail server hosts are: it must be a real, publicly-resolvable address, not a private or internal
one. An Open-Meteo API key is only required if you're using their paid customer API - the free tier
doesn't need one. Both the weather provider (MET Norway) and the geocoding provider (Nominatim)
require a **Support contact email** to be set under General settings before they'll actually work -
without one, you'll see a banner explaining exactly that.

### General / Instance URL

The Instance URL must be a real `https://` address with no trailing slash, no query string, and no
embedded credentials. If it's set by the `BASE_URL` environment variable, the field becomes
read-only in the UI. If neither the environment variable nor this setting is configured, sending a
ticket email (or anything else needing an absolute link) fails outright rather than guessing at one:
"Set the Instance URL in Settings → General before sending ticket emails."

## Related pages

- [Import File Reference](Import-File-Reference) - attendee import columns and rejection reasons
- [Notifications and Messages Reference](Notifications-and-Messages-Reference)
- [Email Delivery Statuses](Email-Delivery-Statuses)
- [Scanning Tickets and Results](Scanning-Tickets-and-Results) - check-in scan outcomes
- [Help and Troubleshooting](Help-and-Troubleshooting)
