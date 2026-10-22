# Validation Reference

**Audience:** All staff · **Required role:** Any staff role (Superadmin-only sections are marked) · **Feature status:** ✅ Available · **Last verified:** Admitto 0.7.4

Every field-level and cross-field rule Admitto enforces, organised by screen.

Use this page when:

- a save is rejected and you want to know exactly why
- you are preparing data or settings and want to check the limits first

Most tables have two columns: the rule, and what you see when you break it. Text in quotation marks is the exact message on screen. Words in braces, such as {role}, stand for a value that Admitto fills in.

- [Sign-in and account security](#sign-in-and-account-security)
- [Identity providers and Cloudflare Access (Superadmin)](#identity-providers-and-cloudflare-access-superadmin)
- [User management (Superadmin)](#user-management-superadmin)
- [Account self-service (My Account)](#account-self-service-my-account)
- [Attendees, import, and requirements](#attendees-import-and-requirements)
- [Event settings](#event-settings)
- [Communication](#communication)
- [Check-in and the public ticket page](#check-in-and-the-public-ticket-page)
- [Wallet actions (Attendee Detail and bulk)](#wallet-actions-attendee-detail-and-bulk)
- [Organisation settings (Superadmin)](#organisation-settings-superadmin)
- [Related pages](#related-pages)

## Sign-in and account security

### Signing in

| Rule | What you'll see |
|---|---|
| Email and password are both required | "Invalid email or password." |
| A wrong password, an unknown email and a disabled account all fail the same way, at the same speed. This is by design: a failed attempt can't be used to find out which part was wrong | "Invalid email or password." |
| Up to 30 login attempts per minute from one IP address. An IPv6 network (a /64 block) counts as one address | "Too many requests." |
| Up to 10 login attempts per minute for one email address. This is a separate limit, counted before the password is checked. Once it is used up, even the correct password is refused until the minute is over | "Too many requests." |
| Passkey sign-in: up to 30 attempts per minute, with the start and the finish stage counted separately | "Too many requests." |
| A rejected or cancelled passkey sign-in turns the password form back on | "Could not sign in with your passkey. Try again, or use your email and password below." |
| 5 failed sign-ins or MFA attempts in a row on an admin or superadmin account raise an internal security alert. It is recorded for a Superadmin to review in [Logs and Audit](Logs-and-Audit) | No visible change |
| A pending backup-codes acknowledgement or a forced password change can't be skipped, either by closing the tab or by calling the API directly. Your session stays held at that step until you finish it | You are sent back to the required step every time |

### Passwords

| Rule | What you'll see |
|---|---|
| At least 12 characters, everywhere a password is set: sign-up, change, admin reset, invite and CLI bootstrap | "Password must be at least 12 characters." |
| Not a common or easily guessed password. Admitto uses a fixed blocklist and also rejects simple patterns such as `aaaaaaaaaaaa` or `abcdefghijkl` | "This password is too common or predictable. Choose a different one." |
| The new password and its confirmation must match | "Passwords do not match." |
| Changing your own password needs your current password. If your role requires two-factor and you have a confirmed method, it also needs a step-up code (authenticator app, backup code, or passkey or security key) | "Current password is incorrect." / "Enter your authenticator app code to continue." |

**There is no required mix of upper case, lower case, digits and symbols.** This is deliberate: composition rules push people toward predictable substitutions without making a password meaningfully safer. The strength meter you see while typing is only advice and never blocks saving.

### Two-factor authentication (TOTP)

| Rule | What you'll see |
|---|---|
| A 6-digit numeric code is treated as an authenticator-app code. Anything else is treated as a backup code | Routed automatically, no separate message |
| A code must be current (±30 seconds) and can't be reused. A numerically correct code is still rejected if it, or an earlier one, was already accepted | "Invalid code. Try again." |
| Enrolling needs a local password. An account that only signs in through SSO can't enroll local two-factor until it has one | "Password is managed by your identity provider." |
| Up to 10 verification attempts per 15 minutes. The limit is checked per session, per IP and, at sign-in, per account, and all of them must pass. New sessions or a different address do not give you more attempts | "Too many requests." |
| Up to 20 proof attempts per 15 minutes across all two-factor-protected actions together, so switching between actions can't multiply your attempts | "Too many requests." |
| After your first confirmed two-factor method, you must confirm that you saved your backup codes before you continue. This can't be bypassed | You are sent to the backup-codes step |

### Passkeys and security keys

| Rule | What you'll see |
|---|---|
| A name (nickname) is required when you register one, up to 120 characters | The Add button stays disabled until you enter one |
| A cloned or replayed credential is detected and rejected. Each use must move the credential's internal counter forward | "Could not verify the passkey/security key. Try again." |
| A setup request expires after 5 minutes and can be used only once | "This passkey/security key setup request expired. Start again." |
| Registration and sign-in work only if a Superadmin has turned passkeys and security keys on for the instance | "Passkeys and security keys are turned off for this instance. Ask an administrator to enable them." |
| Up to 10 attempts per 15 minutes, per session and per IP | "Too many requests." |

## Identity providers and Cloudflare Access (Superadmin)

### OIDC / SSO provider setup

| Field | Requirement |
|---|---|
| Display name | Required, up to 200 characters |
| Issuer URL | Required, up to 2000 characters, must start with `http(s)://` |
| Client ID | Required, up to 500 characters |
| Client secret | Required when you first create the provider. Leave it blank on a later edit to keep the stored secret |
| Authorization / Token / JWKS / UserInfo endpoints | Optional (usually filled by **Discover**). If you enter one by hand, it must look like a URL |
| Claim mapping fields (email, name, groups, etc.) | Optional, up to 200 characters each |
| Sign-in button label | Optional, up to 120 characters |
| Group → role mapping row | Group name and role are required. The role decides the scope: Superadmin → instance, Admin → organisation, Operator → event. Admin and Operator also need a matching scope ID |

Beyond the form itself:

- Every URL Admitto actually calls (issuer, discovery, JWKS, endpoints) must use HTTPS. It must not point at a private, loopback or internal address, unless your Superadmin has explicitly allow-listed that host for a LAN identity provider.
- Saving a provider's role mappings always replaces the full list. If the list is missing from the request, the request is rejected outright instead of silently deleting your mappings.
- Two identity providers can't share the same issuer.

### Cloudflare Access setup

| Field | Requirement |
|---|---|
| Team URL | Required when enabled. It must resolve to `https://<your-team>.cloudflareaccess.com` |
| Application Audience (AUD) tag | At least one is required when enabled |
| Direct identity provider | Required when enabled, and must be an already-enabled OIDC provider |
| Protected URL paths | Each must start with `/`. If left blank, it falls back to `/admin`, `/api/admin`, `/api/checkin` |

See [Identity and SSO](Identity-and-SSO) and [Cloudflare Access - Identity Linking](Cloudflare-Access-Identity-Linking) for what each of these does and for the full list of sign-in denial reasons.

## User management (Superadmin)

| Rule | What you'll see |
|---|---|
| The email must be a valid address and not used by another account | "Enter a valid email address." / "A user with this email already exists." |
| An **Operator** role is scoped to an event and an **Admin** role to an organisation. A **Superadmin** role has no scope at all | "Select an event for the operator role." / "Select an organization for the admin role." |
| A person holds exactly one role type at a time. Assigning a new type revokes the old one, after a confirmation | "Changing to {role} removes {name}'s current {role} access." |
| You can never remove, deactivate or delete the last active Superadmin | "Cannot remove or deactivate the last superadmin." |
| You can't change or remove your own role, deactivate or delete your own account, or unlink your own SSO. Ask another Superadmin | "You cannot change your own role. Ask another superadmin." (and similar) |
| A role that identity-provider group sync granted can't be removed by hand | "This role is managed by an identity provider and cannot be removed." |
| You can't reset the two-factor method or password of an SSO-managed account. Unlink SSO first | "This account is managed by an identity provider. Unlink it first..." |
| To reset another **Superadmin's** two-factor method or password, or to end their sessions, you must first prove your own identity: an authenticator code, a backup code, or a passkey or security key | "You need a confirmed authenticator app, passkey, or security key on your own account before you can reset another superadmin's two-factor or password, or revoke their sessions." |
| An Administrator (not a Superadmin) can only grant or remove the Operator role, and only for events in an organisation they administer | "You do not have access." |

## Account self-service (My Account)

| Rule | What you'll see |
|---|---|
| Email can't be changed here | The field is read-only, with an explanatory note |
| Profile fields (display name, locale, time format, phone) have their own length limits. At least one must actually change | No message. Without a change, Save has nothing to do |
| You can never revoke your own current session from any session list | "You cannot revoke your current session." |
| Removing a confirmed two-factor method, resetting everything and regenerating backup codes each ask you to prove your identity again: your current password, plus a step-up code if your role requires two-factor | "Current password is incorrect." / "Enter your authenticator app code to continue." |
| Adding a passkey, a security key or an authenticator app to an account that already has a confirmed two-factor method needs a step-up code (authenticator app, backup code, or an existing passkey or security key), whatever the role. The account's first method needs none | "Enter your authenticator app code to continue." / "Invalid authenticator or backup code." |
| Unlinking SSO always needs a fresh local password, set in the same step, plus a step-up code if you have confirmed two-factor. An account with neither a password nor a confirmed two-factor method can't unlink itself | "This account has no password or confirmed two-factor method to verify with. Ask a superadmin for help." |
| Unlinking SSO is blocked while any of your roles is still managed by that identity provider | "Some of your roles are managed by an identity provider. Ask an administrator to remove them first." |
| Re-authentication attempts (for any of the above) are capped at 10 per window, per account and per IP | "Too many requests." |

## Attendees, import, and requirements

### Adding or editing an attendee

| Field | Requirement |
|---|---|
| First name, last name | Required, up to 100 characters each |
| Email | Required, a real-looking address, up to 254 characters. It is saved in lower case: `Jan@Example.com` becomes `jan@example.com` |
| Company, department | Optional, up to 200 characters each |
| Ticket type | Must exist in the event's current ticket-type catalog. This is checked again at the moment you save, in case the type was deleted in the meantime |

| Rule | What you'll see |
|---|---|
| An attendee's email must be unique within the event. Capital letters do not make a different address | "This email is already registered for this event." |
| Adding a new attendee also checks the event's capacity limit. Once the event is full, the Attendees page's **Add attendee** button is disabled with a tooltip that shows the same count, so you normally see this before you open the form | "Event is at capacity ({current}/{capacity}). Free a slot or increase capacity before adding this attendee." |
| If two staff members edit the same attendee at once, the second save is rejected instead of silently overwriting the first change | "Someone else changed this record. Reload and try again." |

Restoring a revoked attendee checks the event's capacity limit again, the same as adding a new one.

### CSV/XLSX import

| Rule | What you'll see |
|---|---|
| The file must be `.csv` or `.xlsx`, up to 5 MB | "Unsupported file type. Upload a .csv or .xlsx file." / "File exceeds the 5 MB limit." |
| The file content is checked against its real format, not just its extension | "The file could not be read. Check that it is a valid CSV or XLSX." |
| A CSV file is UTF-8 or Windows-1250 text. A file saved as UTF-16 (Excel "Unicode Text"), or with a NUL character, is refused | "This file is saved in a format Admitto cannot read, for example Unicode Text. Save it again as CSV UTF-8 and upload it." |
| A CSV file that is not valid UTF-8 is read as Windows-1250 | A warning in the preview: "This file is not saved as UTF-8, so Admitto read it as Windows-1250. Check that names with accented letters look right in the sample rows. If they do not, save the file as CSV UTF-8 and upload it again." |
| Up to 50,000 data rows per file | "File exceeds the row limit. Split the file and import in parts." |
| A row needs a first name, a last name and a valid, non-empty email | "Both first_name and last_name are required." / "Missing email." / "Invalid email: ..." |
| The same email, agency ID or QR payload can't appear twice **within one file** | "Duplicate email in file: ..." (and similarly for the others) |
| An unrecognised ticket type, or a custom-field answer that does not fit its field's type or format rules, fails that row, not the whole import | "Unknown ticket type: ..." / "Invalid value for {field} (expected one of: ...)" / "Invalid value for {field} (expected a date as YYYY-MM-DD)" |
| In an XLSX file, a date or date and time cell is read as the date it shows. In a CSV file, write a date as `YYYY-MM-DD` and a date and time as `YYYY-MM-DDTHH:mm` | No message. This is by design |
| In a CSV file, a date written as `YYYY-MM-DDT00:00:00.000Z` and a date and time written as `YYYY-MM-DDTHH:mm:00.000Z` are read as the day or the time shown, not converted from UTC | No message. This is the form in which an XLSX date cell arrives |
| A row that matches an existing attendee is skipped, unless "Overwrite existing attendees" is on | "Attendee already exists. Turn on 'Overwrite existing attendees' to update it instead of skipping." |
| Overwriting updates only name, ticket type, company, department and custom fields. It never touches status, QR code or token | No message. This is by design |
| The whole import is capped by the event's capacity, the same as adding attendees one at a time. A Superadmin can override the cap | "Import would exceed capacity. {current} existing + {incoming} new = {projected} &gt; {capacity}." |

Every row gets its own pass or fail reason in the preview before you commit. Nothing is guessed or silently dropped. See [Import File Reference](Import-File-Reference) for the full column reference.

### Custom attendee fields (Requirements page)

| Field | Requirement |
|---|---|
| Field key | Derived automatically. Lowercase letters, numbers and underscore only |
| Label | Required, up to 60 characters |
| Description | Optional, up to 500 characters |
| Type | Text, long text, date, date and time, phone, select (shown as Single choice), or yes/no. The field editor offers all seven |
| Select options | At least one for a select field. Up to 20 options, each up to 60 characters |
| Format rules | Optional, for text, long text and phone fields only. Set in the field editor. See "Format rules" below |
| Icon, suggestions, condition | Optional, for the registration form. An icon fits every type, suggestions fit text fields only, and a condition fits every type. See "Icons and suggestions" and "Questions that depend on another answer" below |

**Limits and protections**

- An event can have up to 20 custom fields.
- A field that is currently used as a hint on an Event item can't be deleted until you remove it there first.
- A field that other fields are shown by can't be deleted, changed to another type, or lose the option they are shown for, until you change or remove their condition. See "Questions that depend on another answer" below.
- Renaming or removing a select option that attendees have already chosen asks you to confirm and tells you how many attendees are affected. It does not change what they see without asking, and it does not block you outright.

**What an answer must look like**

- An answer to a required field can't be left blank.
- A select answer must be one of the configured options.
- A yes/no answer accepts Yes, No, true or false, in any letter case.
- An answer that does not fit its type or format rules is refused when you add an attendee, when you save one and when you import a file. Nothing is guessed. The one thing that is cut is a text answer in an import, which is cut to 100 characters.
- The Add attendee dialog and the attendee page check an answer with the same limits before they send it, and say which field is wrong.

| Type | An answer is |
|---|---|
| Text | Up to 100 characters. Adding or saving an attendee refuses more than 100. An import cuts it to 100 |
| Long text | Up to 1000 characters, line breaks included. Longer text is refused, never cut |
| Date | Written `YYYY-MM-DD`, and a day that exists. `2026-02-30` is refused |
| Date and time | Written `YYYY-MM-DDTHH:mm`, for example `2026-11-04T10:30`. It is the time on the clock at the event, so it has no time zone. A zone, seconds, or a space in place of the `T` are refused |
| Phone | 3 to 15 digits, written with digits, spaces, dashes, dots and brackets, and an optional `+` at the start. It is saved as the `+` and the digits: `+48 600-100-200` becomes `+48600100200` |
| Select | One of the field's options |
| Yes/No | Yes, No, true or false |

**Format rules**

Text, long text and phone fields can carry rules about what an answer looks like. A rule is a plain setting that Admitto reads as written. You never type a pattern.

| Rule | What it asks |
|---|---|
| Minimum length | At least this many characters, from 1 to 1000 |
| Maximum length | At most this many characters. It can't be more than the type holds: 100 for text, 1000 for long text, 16 for a phone number |
| Digits only | Only the digits 0 to 9. No spaces, dashes or letters |
| Example | A hint for the person answering. It is never checked |

- A length counts characters as a person sees them: an emoji is one character.
- A phone number is checked in its saved form, so its length counts the `+`, and "digits only" refuses a number that starts with `+`.
- A date, date and time, select or yes/no field takes no format rules (lengths, digits only, example). Saving one with such a rule is refused. The field editor shows no format rules for these types, and removes the format rules of a field that becomes one of them. An icon and a condition stay.
- The field editor refuses a length that is not a whole number from 1 to what the type holds, a shortest answer longer than the longest, and phone lengths that no number can meet (a saved number has 3 to 16 characters, or 3 to 15 with digits only). It also refuses an example of more than 100 characters, or one with an invisible character.
- A rule applies to every answer entered after it is set, and to the answers already saved. An attendee whose older answer breaks a new rule can't be saved until that answer is fixed.
- An export writes a phone number as saved, with its `+`, so an exported file can be imported again.

**Icons and suggestions**

These two rules shape the registration form. They are set through the admin API. The field editor does not show them, and it sends them again when it saves a field, so a save in the editor never removes them.

| Rule | What it asks |
|---|---|
| Icon | One name from a fixed list: `parking`, `car`, `food`, `accessible`, `bed`, `user-plus`, `users`, `building`, `calendar`, `clock`, `phone`, `mail`, `pin`, `plane`, `train` or `shirt`. A field of any type can have one. Any other name is refused |
| Suggestions | Text fields only. A list of 1 to 30 texts, each 1 to 100 characters on one plain line, with no control, invisible or formatting characters. The same text twice is refused, in any letter case. They only suggest: a guest can still type any text, and Admitto never checks an answer against the list |

- Saving suggestions on a field that is not a text field is refused. So is changing a text field that has suggestions to another type, unless the same save leaves the suggestions out.
- A save with rules replaces all the rules of the field. Send every rule you want to keep, the format rules too.

**Questions that depend on another answer**

A question can be shown only when another question has a certain answer. For example, the question "Car registration number" can be shown only when the yes/no question "Do you need parking?" is answered Yes. This is the rule `show_when` of the field. It is set through the admin API. The field editor does not show it, and it sends it again when it saves a field, so a save in the editor never removes it.

| Rule | What you'll see when you break it |
|---|---|
| The condition names another field of the same event. It can't name the field itself | "This condition cannot be kept. It must point at another yes/no or select field of this event that has no condition of its own, and name an answer that field can have. A field that other fields depend on cannot have a condition itself." |
| The other field is a yes/no field (the answer is Yes) or a select field (the answer is one of its options, written exactly) | The same message |
| The other field has no condition of its own. So there are no chains of conditions and no cycles | The same message |
| A field with a condition is on the registration form only if the field it depends on is on the form too. Taking that field off the form while a question that depends on it is on the form is refused as well | "A field with a condition can be on the registration form only when the field it depends on is on the form too." |
| A field that other fields depend on can't be deleted, changed to another type, or lose or rename the option a condition names | "Other fields are shown only for an answer to this one. Change or remove their condition first." |

These checks run when you save the field, in one step with every other change to the event's fields, so two people saving at the same time can't break them. An event that does not accept registrations is held to the same rules.

**What happens to an answer to a question that is not shown**

| Where | What happens |
|---|---|
| A required question | "Required" means "required when shown". A question that is not shown is never required |
| The registration form | A guest's answer to a question that is not shown is ignored. It is never saved, even when a changed form sends it, and it causes no error. Admitto decides from the answers it received, not from what the page claims |
| Adding an attendee | The same: the answer is ignored and not saved, with no error |
| Editing an attendee | The same for an answer set in the edit. Clearing an answer is always saved |
| Import | A cell is still checked against the field's type and rules, as for every field. The value of a question that is not shown is then not saved. Whether it is shown is judged on the file row together with the attendee's saved answers |

- An answer saved while its question was shown stays when the question stops being shown, for example when staff change "Do you need parking?" from Yes to No. Admitto never deletes it by itself. Staff can clear it on the attendee.
- A question is shown only when the answer it depends on is saved as Yes (yes/no field) or as the option (select field). No answer at all does not show it.
- The staff screens for adding and editing an attendee list every field and ask for every required one, whether or not its question is shown. Only the server applies the condition, so a required question that is not shown is not required when the same attendee is saved through the admin API.

### Event items (Requirements page)

- An item's name is required, up to 100 characters. Its internal key is derived automatically and kept unique.
- An item that is currently issued to any attendee (and not yet returned) can't be disabled or deleted. Return it first.
- The built-in "Badge" item can never be deleted, only disabled.
- Turning on "Issue badge at entry" (Check-in behaviour tab) is blocked unless the Badge item itself is active and set to issue on check-in.

### Bulk attendee operations

- Every bulk action (change RSVP status, change ticket type, set company or department) takes 1 to 500 attendees at a time.
- If someone else changes one of the selected attendees at that very moment, that row is quietly left alone and reported back separately. The other rows are still changed, and the batch does not fail. Example: "12 attendees set to X (2 already had it) (1 skipped, changed by someone else just now)".

## Event settings

### General information

| Field | Requirement |
|---|---|
| Event name | Required, up to 200 characters |
| Date | A real calendar date (rejects, for example, 30 February) |
| Capacity | A positive whole number, or blank for unlimited |
| Timezone | A real timezone name |
| Event hours | 24-hour `HH:MM` format |
| Event type | One of a fixed list (Conference, Concert, Sports, etc.), or none |

- **Lowering the capacity is not checked.** If you reduce an event's capacity below its current attendee count, the save goes through with no warning. The limit applies later, when someone tries to add a new attendee or commit an import that would exceed it ("Event has reached its capacity limit." / "Import would exceed capacity.").
- **An archived event is locked.** Every field on this tab becomes read-only ("This event is archived.").

### Wallet (Superadmin only)

- Editing anything under Wallet needs Superadmin access. Together with the Mail and Integrations tabs, it is one of three Event Settings tabs that an Administrator can't edit. Every other tab is open to Administrators.
- A field-mapping row needs both a PassCreator field key (letters, numbers and underscore, starting with a letter) and a value chosen from a fixed list of attendee and event tokens.
- The editor won't let you pick the same source value on two rows. It warns you before you save a row that has only one of the two.
- **Test connection** turns PassCreator's own rejection reasons into plain text: a wrong API key, a template that was not found, PassCreator rate-limiting you, or a timeout.

### Location

| Field | Requirement |
|---|---|
| Venue name | Up to 300 characters |
| Full address | Up to 500 characters |
| Directions / accessibility notes | Up to 2000 characters each |
| Room, entrance/door/gate/portal identifiers, phone number | Up to 300 characters each |
| Opening times (venue, doors, gates, box office, parking, fan zone) | 24-hour `HH:MM` format |
| Latitude / longitude | Real coordinates, always set (or cleared) together, never just one |
| Map zoom | A whole number between 1 and 19 |
| Google/Apple Maps link overrides | Must be a real `https://` link to that provider's own maps domain |

If the event already has installed wallet passes, changing a wallet-relevant location field (address, coordinates, directions, venue details) asks you to confirm before Admitto pushes that update to every installed pass.

### Danger zone (mostly Superadmin)

- **Deleting an event** is allowed only when it has none of the following:
  - attendees
  - non-default items
  - non-standard ticket types
  - contacts or resources
  - a pinned note
  - an extra mail template

  The screen lists what still blocks you. The server checks again, even if your screen is out of date.
- **Archiving or restoring** is Superadmin only. Archiving an archived event, or restoring one that is not archived, is rejected instead of silently accepted.
- **Revoking every check-in or every issued item at once** is Superadmin only. It is disabled when there is nothing to revoke.
- Every destructive action here except Delete and Restore is blocked while the event is archived.

### Check-in behaviour

- Turning on "Issue badge at entry" is rejected unless the event's badge item exists, is enabled, and has "Issue on check-in" turned on. A tooltip explains which of the three is missing.
- Turning off manual lookup for an event takes effect at check-in immediately, not only in the settings.

## Communication

### Templates

| Field | Requirement |
|---|---|
| Subject | Required, up to 500 characters |
| Body | Required, up to 200,000 characters |
| Template label (when creating one) | Required |
| Icon / description (template metadata) | Optional, short limits |

The editor also checks the content itself while you type. It validates again about half a second after you stop typing.

- **Only known placeholders are allowed.** These are `{{first_name}}`, `{{ticket_url}}` and about 20 others, plus that event's own branding-image tokens. An unrecognised placeholder is flagged by name.
- **The ticket template must contain `{{ticket_url}}` and `{{qr_image_url}}`.** Both must appear somewhere in the subject and body together. A ticket template that never shows the ticket link or the QR code is rejected, even if every placeholder it does use is valid. Any other named template (a reminder, an announcement) can be saved without either.
- **A placeholder inside an HTML comment, or unquoted inside an HTML attribute, is rejected.** Both would fail silently in a real mail client.
- **An MJML template is compiled and checked for structural errors:** an invalid attribute, an unknown element, wrong nesting or a missing title. The message explains the problem in plain language and gives the line number. HTML templates skip this check.
- **An event can have up to 10 saved templates.** A new template's internal name must be unique within the event. Admitto creates it automatically from the label you type.

### Sending (Communication → Send)

| Rule | What you'll see |
|---|---|
| A recipient filter (by ticket type, or specific attendees) must have an actual value chosen | The Count and Send buttons stay disabled until you pick one |
| At most 500 attendees can be targeted by one send | "Too many attendees selected." |
| Sending is blocked while the Templates tab has unsaved edits. A send always uses the last **saved** version | "You have unsaved template changes. Save them on the Templates tab first..." |
| Sending is blocked once the event is archived | "This event is archived." |
| Real sends (not the "count recipients" dry run) are capped at 3 per 10 minutes per admin | "Bulk sends are limited to 3 requests every 10 minutes. Try again later." |
| Stopping a send asks for confirmation first. It explains that messages already sent can't be recalled | "Attendees not yet emailed won't receive it. Anyone already sent the email keeps it..." |

## Check-in and the public ticket page

### Scanning and manual lookup

| Scan result | What the operator sees |
|---|---|
| Valid, unused ticket | "Check-in recorded." |
| Already checked in | "This guest is already checked in." |
| Revoked or cancelled ticket | "This ticket has been revoked or cancelled." |
| Code not recognised | "This code is not valid for this event. Check the QR or use manual lookup." |
| The event requires confirmation before admitting | "Attendee found. Confirm check-in below." The guest is not checked in until you explicitly confirm |

- Two near-simultaneous scans of the same ticket can never both succeed. The second one is reported as "already checked in", never as a duplicate admission.
- Manual lookup searches only name and email, never company or department. It returns at most 20 results and does nothing on an empty search.
- If manual lookup is turned off for an event, both the button and the underlying request are blocked: "Manual lookup is disabled for this event. Use QR scan only."
- All check-in actions from one device or session share a combined limit of 120 requests per minute.

### Public ticket page

| What happens | What you'll see |
|---|---|
| The ticket link is invalid or not recognised | "This link is invalid or the page no longer exists." |
| The ticket is revoked or cancelled | "This ticket is no longer valid for entry", instead of the QR or wallet content |

Every response, error pages included, is served with strict caching (a shared computer never keeps a copy) and with no search-engine indexing.

## Wallet actions (Attendee Detail and bulk)

**Credentials only** means that the event has its wallet provider credentials configured. For those actions the Wallet switch and the archived state do not matter.

| Action | Requires | Confirmation dialog |
|---|---|---|
| Void | Credentials only, and a wallet pass on that attendee | Required |
| Void active passes (whole event) | Credentials only. No attendee or pass selection needed | Required, then runs in the background |
| Restore | Wallet configured for the event, the event not over or archived, and a wallet pass on that attendee that has not been removed at the provider | Required |
| Push updates | Wallet configured for the event, and a wallet pass on that attendee | Required |
| Refresh status | Credentials only, and an active wallet pass on that attendee | Not required |
| Delete | Credentials only, and a wallet pass on that attendee | Required. It warns that the action is permanent and that it also erases the pass's Reports history. It also warns that Apple and Google Wallet give no way to remove a pass from someone's phone, so only the attendee can do that |
| Remove from provider | Credentials only, and a voided or expired wallet pass on that attendee | Required. It warns that the action is permanent at the provider. Unlike Delete, the local record and its Reports history are kept |
| Remove inactive passes (whole event) | Credentials only. No attendee or pass selection needed | Required, then runs in the background |

If a requirement isn't met, the action gives a specific reason:

- "This attendee has no wallet pass to act on."
- "Wallet isn't configured for this event."
- Refresh status on a pass that is no longer active: "This wallet pass is no longer active, so there is nothing to refresh."
- Remove from provider on an active pass: "This wallet pass isn't voided or expired, so it can't be removed from the provider."

More rules:

- A rejection from the provider (PassCreator) is always translated into a specific reason, never a bare error: a wrong API key, a pass that was not found, PassCreator rate-limiting the instance, or a timeout.
- Revoking or restoring an attendee's admission status automatically voids or restores their wallet pass to match. This is best effort: if the sync fails, the attendee save still goes through.
- Single-attendee wallet actions are limited to 10 per minute per admin and event.
- Bulk wallet actions take up to 100 attendees per request, and only one bulk action runs at a time per admin and event. Anyone who has no pass, or is already in the target state, is skipped without an error. The result reports them as a count, for example "3 had no pass, or it was already voided."

## Organisation settings (Superadmin)

### Mail transport

The active provider (Microsoft 365 Graph, SMTP or Power Automate) decides which fields are required. For example, SMTP needs a host and a port, and Graph needs a tenant and a client ID. These rules apply to all providers:

| Rule | What you'll see |
|---|---|
| A from, reply-to or envelope address, when set, must be a real-looking email at a real top-level domain | "From address must be a valid email." |
| An SMTP host or Power Automate URL can't point at a private, internal or loopback address. This is checked when you save and again right before Admitto connects | "The mail destination host resolves to a private address..." |
| A Power Automate URL must use HTTPS | "url must use HTTPS" |
| The SMTP port must be between 1 and 65535 | "SMTP port must be between 1 and 65535." |
| Advanced SMTP tuning (connection limits, timeouts, rate limit) must be positive whole numbers when set | "{Field} must be a positive whole number." |
| An "allowed sender domain", if configured, must exactly match the domain actually used to send | "{Field} must use the allowed domain (...)." |
| A field that an environment variable sets can't be edited here at all | "This setting is controlled by an environment variable and can't be changed here." |
| Saving is rejected up front if the resulting configuration would be incomplete for sending mail, instead of failing only on the next real send | "Fill in all required fields for this mail transport before saving." |

### Branding

| Field | Requirement |
|---|---|
| Theme colour | A 6-digit hex colour (for example `#066fd1`) |
| Font family name | Letters, numbers, spaces, hyphens, underscores or periods only, up to 128 characters |
| Logo / header image upload | PNG, JPG or WebP, up to 2 MB, verified by its actual file content, not just the filename |
| Custom font upload | WOFF, WOFF2, TTF or OTF, up to 5 MB. Known display bug: the error message for a rejected font file says "2 MB", but the real limit is 5 MB |

### External services (Weather and Maps)

- Every base URL you configure (Open-Meteo, Nominatim, a custom map tile server) is checked the same way as mail server hosts. It must be a real, publicly resolvable address, not a private or internal one.
- An Open-Meteo API key is needed only for their paid customer API. The free tier needs none.
- Both the weather provider (MET Norway) and the geocoding provider (Nominatim) need a **Support contact email** under General settings before they work. Without one, you see a banner that says so.

### General / Instance URL

- The Instance URL must be a real `https://` address with no trailing slash, no query string and no embedded credentials.
- If the `BASE_URL` environment variable sets it, the field is read-only in the UI.
- Outside development, the app also accepts a value that is set only in Settings, for ticket links and sign-in. The Setup checklist is stricter: its Instance URL check also wants `BASE_URL` set, and stays red without it, even though the app already works.
- If neither the environment variable nor this setting is set, anything that needs an absolute link, such as a ticket email, fails outright outside development instead of guessing one: "Set the Instance URL in Settings → General before sending ticket emails."
- Only in development does Admitto fall back to `http://localhost:3000`.

## Related pages

- [Import File Reference](Import-File-Reference) - attendee import columns and rejection reasons
- [Notifications and Messages Reference](Notifications-and-Messages-Reference)
- [Email Delivery Statuses](Email-Delivery-Statuses)
- [Scanning Tickets and Results](Scanning-Tickets-and-Results) - check-in scan outcomes
- [Help and Troubleshooting](Help-and-Troubleshooting)
