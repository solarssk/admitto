# My Account

| Field | Value |
|---|---|
| **Audience** | All staff (Operators, Organisation Admins, Superadmins) |
| **Required role** | Any signed-in staff account |
| **Feature status** | Available |
| **Last verified** | Admitto 0.5.1 |

## What this page helps you do

Update your own profile (display name, regional date format, time format, and internal contact phone number), understand what your Sign-in and Role fields mean, connect or unlink a single sign-on (SSO) identity provider, change your password, manage two-factor authentication (an authenticator app, passkeys, security keys, and backup codes), and review your active sessions, all from **My account**.

## Before you start

Sign in and open **My account** from the top-right account menu. No special permission is needed; every signed-in staff account can manage its own profile, password, and 2FA.

## Steps

1. **Display name**: the name shown to other staff (in role assignments, audit logs, and delivery history). Edit the field and click **Save**.
2. **Regional format**: controls how dates are displayed to you (for example `28 Jun 2026` vs `06/28/2026`). The interface language stays English, even when the regional format is changed.
3. **Time format**: independently selects 24-hour time or 12-hour time with AM/PM. Choose **System default (browser)** to use your browser's setting; this does not change the date format above.
4. **Language**: read-only for now, fixed to **English (US)**. Admitto's interface is English-only; this field previews where a language choice will live once more are available, and is disabled with a "More languages are coming soon" note until then.
5. **Email**: shown for reference only; it cannot be changed from this page. Contact your administrator if it needs to change.
6. **Phone number**: optional, for internal staff contact only. Pick the country code, then enter the number. It is never shown on tickets or to attendees.
7. **Role**: read-only. Shows your current role (Operator, Organisation Admin, or Superadmin) and, for Operator/Organisation Admin, the specific events or organisations it applies to. Only your administrator can change this; see [Roles and Permissions](Roles-and-Permissions).
8. **Account type**: read-only. Shows **Local account** if you sign in with a password you set yourself, or **Managed by \<provider name\>** if your sign-in is linked to an organisation identity provider (SSO, short for single sign-on). An account can be both at once: a local password kept as a fallback alongside a linked provider.
9. **SSO** (Profile card header, next to the card title): a menu for managing your own linked identity providers. Only appears when there's something to connect or unlink. It offers two kinds of action, and both can be available at once if more than one provider is configured:
   - **Connect \<provider name\>**: link an additional identity provider to your account. One item appears per enabled provider you are not already linked to. Selecting it takes you to that provider's sign-in page, where you confirm your identity with your current local password (plus a two-factor code, if your account requires one) before the new provider is linked. This option needs a local password to work, so it only appears once your account has one: set it under **Password** on this page, or ask your administrator to set it for you.
   - **Unlink SSO**: remove every identity provider currently linked to your account and fall back to (or set) a local password. See the dedicated steps below.
9. To **unlink SSO**: open the **SSO** menu and choose **Unlink SSO**. Set the new local password you'll sign in with, then confirm:
   - If your account already has a confirmed authenticator app (TOTP), you're asked for a code from it (or a backup code) instead of a password. This is checked regardless of your role.
   - Otherwise, if your account has a local password, you're asked to enter it to confirm it's really you.
   - If your account has neither a confirmed authenticator app nor a local password (a brand-new SSO-only account that's never touched either setting), self-service unlink isn't possible. Ask your administrator to unlink it for you instead.
   - If any of your roles were assigned automatically by an identity provider group (shown with a small cloud icon next to the role's scope on this page), unlinking is blocked until your administrator removes that role or you leave the underlying group. This stops SSO group-managed access from being silently converted into access you control yourself.
   - Unlinking ends your other active sessions immediately; the session you're using stays signed in.
10. Click **Save** once you're done editing the profile fields above (Save is disabled until something has actually changed).
11. **Password**: enter your current password plus a new one (at least 12 characters) to change it. This ends your other active sessions; the session you're using stays signed in. Not available on an account with no local password (SSO-only).
12. **Two-factor authentication**: click **Set up** to add an authenticator app (TOTP) as a second sign-in factor; this opens in a popup with a QR code to scan and a digit code to confirm. Save the 10 backup codes shown once during setup; they're your fallback if you lose access to the app. Once set up, the button becomes **Manage**, opening a popup with a single **Remove** action that takes out only the authenticator app; your passkeys, security keys, and backup codes are left in place.

    To clear every two-factor method at once instead, use the options menu (the three-dot icon) in the **Two-factor authentication** card's own header and choose **Reset everything**; see the dedicated bullet under Important decisions below.

    If your role requires two-factor authentication and you have a confirmed method, both **Remove** and the full reset ask for a code from your authenticator app (or a backup code) first.
13. **Passkeys and security keys**: register one or more passkeys or security keys as extra two-factor methods, alongside an authenticator app. Signing in with them directly isn't available yet; see What changes after this action below:

    | Type | What it is | Typical example |
    |------|------------|------------------|
    | Passkey | Built into your device, unlocked with the device's own screen lock | Face ID, Touch ID, Windows Hello |
    | Security key | A separate physical device you plug in or tap | YubiKey or similar |

    Click **Add passkey** or **Add security key**, give it a name in the popup (required: this is how you'll tell multiple keys apart later, for example "Work laptop" vs "Phone"), then follow your browser or device's prompt to complete it. There's no limit on how many passkeys or security keys you can register. If this is your first-ever confirmed two-factor method, the popup shows your 10 backup codes once, the same as setting up an authenticator app. Save them before closing.
14. To **remove** a passkey or security key: find it in its list under **Two-factor authentication** and click **Remove**.
    - If your role requires two-factor authentication and you have a confirmed method, you're asked for a code from your authenticator app (or a backup code) to confirm it's really you.
    - If the one you're removing is your last remaining two-factor method, you'll need to set one up again the next time you sign in.
15. **Backup codes**: appears once you have at least one confirmed two-factor method (an authenticator app, a passkey, or a security key). Shows how many of your 10 codes are still unused, for example "7 of 10 remaining", or **None generated yet** if none have been created for your account. Backup codes are an account-wide fallback: they aren't tied to any single authenticator app, passkey, or security key, and work as a second factor no matter which method you normally sign in with. Click **Manage**, then **Regenerate** to invalidate your current codes and get a fresh set of 10, shown once as plain text. Save them somewhere safe, since they can't be viewed again after you close the popup. Backup codes can't be removed individually; regenerating is the only way to invalidate old ones. If your role requires two-factor authentication and you have a confirmed method, regenerating asks for a code from your authenticator app (or another backup code) first.
16. **Active sessions**: review where your account is currently signed in (device, IP, sign-in method, last active) and revoke any session that isn't yours, or all other sessions at once.

## Expected result

Profile changes take effect immediately and are visible to administrators viewing your account (for example in Users & roles). A password change or session revoke signs out every other active session immediately; the device you're using stays signed in.

## Important decisions

- Role is informational only on this page and can't be changed here. Ask your administrator for role changes.
- Account type updates itself automatically as you connect or unlink identity providers; there's nothing to save separately.
- Phone number is internal-contact-only by design: it's never surfaced on attendee-facing tickets or pages.
- Regional format changes how dates are displayed to you specifically; it does not affect what other staff see, and it doesn't change the interface language.
- Language is a preview of a future setting, not a working control yet. Admitto's interface is English-only today, so it's shown disabled with a single fixed option.
- Time format changes only how time fields are displayed to you. It can use 12-hour time with AM/PM or 24-hour time regardless of the selected regional date format.
- An account that requires two-factor authentication (per its role) is asked for a TOTP or backup code before a password change, removing the authenticator app, a full 2FA reset, removing a passkey or security key, or regenerating backup codes can complete.
- Removing the authenticator app has two levels: **Remove**, in the Manage popup, takes out only the app itself and leaves your passkeys, security keys, and backup codes untouched; **Reset everything**, in the Two-factor authentication card's own options menu, clears all of them together in one step. Pick Remove when you just want to swap or drop the app, and Reset everything only when you want a completely clean slate.
- Backup codes are an account-wide fallback, not tied to any specific authenticator app, passkey, or security key. They work as a second factor regardless of which method you use day to day. They can only be regenerated, never deleted individually or viewed again once the popup is closed; regenerating immediately invalidates every code from the previous batch.
- Passkeys and security keys are additional second-factor options alongside the authenticator app, not a replacement for it. You can register any number of each, and every one needs a name so you can tell multiple keys apart later.
- An administrator can turn passkeys and security keys off for the whole instance. There's no toggle for this in Settings yet. It's set in server configuration. When it's off, the Add buttons don't appear and a note explains why; the authenticator app is unaffected.
- Unlinking SSO always demands one proof of identity beyond just being signed in (a TOTP/backup code if you have one confirmed, otherwise your current local password), precisely because it replaces the credential that gets you into the account. An account with neither has nothing to unlink with self-service; that's an intentional dead end, not a bug.
- A role granted to you by an identity provider group can't be converted into a role you control yourself just by unlinking SSO. Your administrator has to remove the grant (or you leave the group) first.

## What changes after this action

A changed display name appears wherever your name is shown to other staff (role assignments, audit/security logs, delivery history). A changed password or a session revoke ends every other active session; you'll need to sign in again on those devices. After unlinking SSO, Account type switches to **Local account** and sign-in via the removed provider(s) stops working immediately. Use the new local password you set instead. After connecting a provider, Account type reflects the new link and you can sign in with either method going forward. A newly added passkey or security key is registered immediately, but sign-in with it isn't available yet. For now it only counts toward "at least one confirmed two-factor method" for things like the Backup codes row; use your authenticator app or a backup code to sign in and step up in the meantime. Removing your last remaining two-factor method (whether that's the authenticator app via Remove, a passkey, or a security key) means you'll be asked to set one up again the next time you sign in, if your role requires two-factor authentication. Regenerating backup codes immediately invalidates every code from the previous batch; only the new set shown at that moment is valid.

## Common problems

- **Save stays disabled:** nothing has changed yet. Save only activates once a field differs from its saved value.
- **Can't change email:** email isn't editable from this page by design; ask your administrator.
- **Password section is missing:** the account is SSO-only (no local password). Sign-in and password are managed by the linked identity provider instead.
- **Lost access to the authenticator app:** use a saved backup code to sign in, then reset 2FA and set it up again from this page.
- **The authenticator app now shows "Manage" instead of "Reset":** that's expected. Manage opens a popup with just **Remove** (authenticator app only). To also clear passkeys, security keys, and backup codes, use **Reset everything** in the Two-factor authentication card's own options menu (the three-dot icon) instead. Nothing is missing, it's just relabelled and split into two separate places.
- **No "Backup codes" row:** it only appears once you have at least one confirmed two-factor method. Set up an authenticator app, a passkey, or a security key first.
- **Regenerating backup codes asks for a code:** that's the required step-up check for accounts whose role requires two-factor authentication, not an error. Enter a code from your authenticator app or a saved backup code.
- **A saved backup code stopped working:** each **Regenerate** invalidates every code from the previous batch immediately; only the newest set, shown once at regenerate time, is valid.
- **"Add passkey" or "Add security key" doesn't appear:** either your account has no local password yet (set one under Password first, or ask an administrator to set one for you), or an administrator has turned passkeys and security keys off for this instance; a note explains which.
- **Removing a passkey or security key asks for a code:** that's the required step-up check for accounts whose role requires two-factor authentication, not an error. Enter a code from your authenticator app or a saved backup code.
- **A correct backup code didn't sign you in:** if your sign-in session had just expired or been signed out from another device at that exact moment, the code is not consumed and stays valid, so entering it again completes sign-in normally. Only a wrong or already-used code is rejected outright.
- **No "SSO" menu on the Profile card:** nothing is linked and no identity provider is currently configured for the instance. There's nothing to connect or unlink.
- **"Connect" is missing for a provider:** either you're already linked to it, or your account has no local password yet. Set one under Password first (or ask your administrator to set one for you).
- **Unlink SSO asks for a password or authenticator code you don't recognize:** that's the required proof of identity, not an error. Enter your current local password, or a code from your authenticator app / a saved backup code, whichever the dialog is asking for.
- **Unlink SSO says some roles are managed by your identity provider:** your administrator needs to remove that role assignment (or you need to leave the underlying provider group) before self-service unlink is available.
- **Unlink SSO isn't available and there's no password or authenticator prompt:** the account has neither a local password nor a confirmed authenticator app to verify with. Ask your administrator to unlink it for you.

## Related pages

- [Roles and Permissions](Roles-and-Permissions)
- [Identity and SSO](Identity-and-SSO)
- [Users and Roles Administration](Users-and-Roles-Administration)
