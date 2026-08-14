# My Account

| | |
|---|---|
| **Audience** | All staff (Operators, Organisation Admins, Superadmins) |
| **Required role** | Any signed-in staff account |
| **Feature status** | Available |
| **Last verified** | Admitto 0.5.0 |

## What this page helps you do

Update your own profile (display name, regional date format, time format, and internal contact phone number), understand what your Sign-in and Role fields mean, connect or unlink a single sign-on (SSO) identity provider, change your password, manage two-factor authentication, and review your active sessions — all from **My account**.

## Before you start

Sign in and open **My account** from the top-right account menu. No special permission is needed; every signed-in staff account can manage its own profile, password, and 2FA.

## Steps

1. **Display name** — the name shown to other staff (in role assignments, audit logs, and delivery history). Edit the field and click **Save**.
2. **Regional format** — controls how dates are displayed to you (for example `28 Jun 2026` vs `06/28/2026`). The interface language itself stays English regardless of this setting.
3. **Time format** — independently selects 24-hour time or 12-hour time with AM/PM. Choose **System default (browser)** to use your browser's setting; this does not change the date format above.
4. **Email** — shown for reference only; it cannot be changed from this page. Contact an administrator if it needs to change.
5. **Phone number** — optional, for internal staff contact only. Pick the country code, then enter the number. It is never shown on tickets or to attendees.
6. **Role** — read-only. Shows your current role (Operator, Organisation Admin, or Superadmin) and, for Operator/Organisation Admin, the specific events or organisations it applies to. Only an administrator can change this; see [Roles and Permissions](Roles-and-Permissions).
7. **Account type** — read-only. Shows **Local account** if you sign in with a password you set yourself, or **Managed by \<provider name\>** if your sign-in is linked to an organisation identity provider (SSO). An account can be both at once — a local password kept as a fallback alongside a linked provider.
8. **SSO** (Profile card header, next to the card title) — a menu for managing your own linked identity providers. Only appears when there's something to connect or unlink. It offers two kinds of action, and both can be available at once if more than one provider is configured:
   - **Connect \<provider name\>** — link an additional identity provider to your account, one item per enabled provider you're not already linked to. Takes you to that provider's sign-in page; you re-authenticate with your current local password (and a code, if your account requires two-factor) before the new provider is linked. Only offered when your account already has a local password — an SSO-only account has no password to re-authenticate with, so this item doesn't appear until one is set (change your password from this page, or ask an administrator to set one).
   - **Unlink SSO** — remove every identity provider currently linked to your account and fall back to (or set) a local password. See the dedicated steps below.
9. To **unlink SSO**: open the **SSO** menu and choose **Unlink SSO**. Set the new local password you'll sign in with, then confirm:
   - If your account already has a confirmed authenticator app (TOTP), you're asked for a code from it (or a backup code) instead of a password — this is checked regardless of your role.
   - Otherwise, if your account has a local password, you're asked to enter it to confirm it's really you.
   - If your account has neither a confirmed authenticator app nor a local password (a brand-new SSO-only account that's never touched either setting), self-service unlink isn't possible — ask an administrator to unlink it for you instead.
   - If any of your roles were assigned automatically by an identity provider group (shown with a small cloud icon next to the role's scope on this page), unlinking is blocked until an administrator removes that role or you leave the underlying group — this stops SSO group-managed access from being silently converted into access you control yourself.
   - Unlinking ends your other active sessions immediately; the session you're using stays signed in.
10. Click **Save** once you're done editing the profile fields above (Save is disabled until something has actually changed).
11. **Password** — enter your current password plus a new one (at least 12 characters) to change it. This ends your other active sessions; the session you're using stays signed in. Not available on an account with no local password (SSO-only).
12. **Two-factor authentication** — set up an authenticator app (TOTP) for a second sign-in factor. Save the 10 backup codes shown once during setup; they're your fallback if you lose access to the app.
13. **Active sessions** — review where your account is currently signed in (device, IP, sign-in method, last active) and revoke any session that isn't yours, or all other sessions at once.

## Expected result

Profile changes take effect immediately and are visible to administrators viewing your account (for example in Users & roles). A password change or session revoke signs out every other active session immediately; the device you're using stays signed in.

## Important decisions

- Role is informational only on this page and can't be changed here — ask an administrator for role changes.
- Account type updates itself automatically as you connect or unlink identity providers; there's nothing to save separately.
- Phone number is internal-contact-only by design: it's never surfaced on attendee-facing tickets or pages.
- Regional format changes how dates are displayed to you specifically; it does not affect what other staff see, and it doesn't change the interface language.
- Time format changes only how time fields are displayed to you. It can use 12-hour time with AM/PM or 24-hour time regardless of the selected regional date format.
- An account that requires two-factor authentication (per its role) is asked for a TOTP or backup code before a password change or 2FA reset can complete.
- Unlinking SSO always demands one proof of identity beyond just being signed in — a TOTP/backup code if you have one confirmed, otherwise your current local password — precisely because it replaces the credential that gets you into the account. An account with neither has nothing to unlink with self-service; that's an intentional dead end, not a bug.
- A role granted to you by an identity provider group can't be converted into a role you control yourself just by unlinking SSO. An administrator has to remove the grant (or you leave the group) first.

## What changes after this action

A changed display name appears wherever your name is shown to other staff (role assignments, audit/security logs, delivery history). A changed password or a session revoke ends every other active session; you'll need to sign in again on those devices. After unlinking SSO, Account type switches to **Local account** and sign-in via the removed provider(s) stops working immediately — use the new local password you set instead. After connecting a provider, Account type reflects the new link and you can sign in with either method going forward.

## Common problems

- **Save stays disabled:** nothing has changed yet — Save only activates once a field differs from its saved value.
- **Can't change email:** email isn't editable from this page by design; ask an administrator.
- **Password section is missing:** the account is SSO-only (no local password) — sign-in and password are managed by the linked identity provider instead.
- **Lost access to the authenticator app:** use a saved backup code to sign in, then reset 2FA and set it up again from this page.
- **No "SSO" menu on the Profile card:** nothing is linked and no identity provider is currently configured for the instance — there's nothing to connect or unlink.
- **"Connect" is missing for a provider:** either you're already linked to it, or your account has no local password yet — set one under Password first (or ask an administrator to set one for you).
- **Unlink SSO asks for a password or authenticator code you don't recognize:** that's the required proof of identity, not an error — enter your current local password, or a code from your authenticator app / a saved backup code, whichever the dialog is asking for.
- **Unlink SSO says some roles are managed by your identity provider:** an administrator needs to remove that role assignment (or you need to leave the underlying provider group) before self-service unlink is available.
- **Unlink SSO isn't available and there's no password or authenticator prompt:** the account has neither a local password nor a confirmed authenticator app to verify with — ask an administrator to unlink it for you.

## Related pages

- [Roles and Permissions](Roles-and-Permissions)
- [Identity and SSO](Identity-and-SSO)
- [Users and Roles Administration](Users-and-Roles-Administration)
