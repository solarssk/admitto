# My Account

> **Audience:** All staff (Operators, Organisation Admins, Superadmins)
> **Required role:** Any signed-in staff account
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Update your own profile (display name, regional date format, and internal contact phone number), understand what your Sign-in and Role fields mean, change your password, manage two-factor authentication, and review your active sessions — all from **My account**.

## Before you start

Sign in and open **My account** from the top-right account menu. No special permission is needed; every signed-in staff account can manage its own profile, password, and 2FA.

## Steps

1. **Display name** — the name shown to other staff (in role assignments, audit logs, and delivery history). Edit the field and click **Save**.
2. **Regional format** — controls how dates are displayed to you (for example `28 Jun 2026` vs `06/28/2026`). The interface language itself stays English regardless of this setting.
3. **Email** — shown for reference only; it cannot be changed from this page. Contact an administrator if it needs to change.
4. **Phone number** — optional, for internal staff contact only. Pick the country code, then enter the number. It is never shown on tickets or to attendees.
5. **Role** — read-only. Shows your current role (Operator, Organisation Admin, or Superadmin) and, for Operator/Organisation Admin, the specific events or organisations it applies to. Only an administrator can change this; see [Roles and Permissions](Roles-and-Permissions).
6. **Account type** — read-only. Shows **Local account** if you sign in with a password you set yourself, or **Managed by \<provider name\>** if your sign-in is linked to an organisation identity provider (SSO). An account can be both at once — a local password kept as a fallback alongside a linked provider.
7. Click **Save** once you're done editing the fields above (Save is disabled until something has actually changed).
8. **Password** — enter your current password plus a new one (at least 12 characters) to change it. This ends your other active sessions; the session you're using stays signed in. Not available on an account with no local password (SSO-only).
9. **Two-factor authentication** — set up an authenticator app (TOTP) for a second sign-in factor. Save the 10 backup codes shown once during setup; they're your fallback if you lose access to the app.
10. **Active sessions** — review where your account is currently signed in (device, IP, sign-in method, last active) and revoke any session that isn't yours, or all other sessions at once.

## Expected result

Profile changes take effect immediately and are visible to administrators viewing your account (for example in Users & roles). A password change or session revoke signs out every other active session immediately; the device you're using stays signed in.

## Important decisions

- Role and Account type are informational only on this page — neither can be changed here. Ask an administrator for role changes; identity provider linking is managed separately.
- Phone number is internal-contact-only by design: it's never surfaced on attendee-facing tickets or pages.
- Regional format changes how dates are displayed to you specifically; it does not affect what other staff see, and it doesn't change the interface language.
- An account that requires two-factor authentication (per its role) is asked for a TOTP or backup code before a password change or 2FA reset can complete.

## What changes after this action

A changed display name appears wherever your name is shown to other staff (role assignments, audit/security logs, delivery history). A changed password or a session revoke ends every other active session; you'll need to sign in again on those devices.

## Common problems

- **Save stays disabled:** nothing has changed yet — Save only activates once a field differs from its saved value.
- **Can't change email:** email isn't editable from this page by design; ask an administrator.
- **Password section is missing:** the account is SSO-only (no local password) — sign-in and password are managed by the linked identity provider instead.
- **Lost access to the authenticator app:** use a saved backup code to sign in, then reset 2FA and set it up again from this page.

## Related pages

- [Roles and Permissions](Roles-and-Permissions)
- [Identity and SSO](Identity-and-SSO)
- [Users and Roles Administration](Users-and-Roles-Administration)
