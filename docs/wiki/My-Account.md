# My Account

**Audience:** All staff (Operators, Organisation Admins, Superadmins) · **Required role:** Any signed-in staff account · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.8

## What this page helps you do

Manage your own account from **My account**:

- your profile (display name, regional date format, time format, internal contact phone number)
- what the Sign-in and Role fields mean
- a connection to a single sign-on (SSO) identity provider
- your password
- two-factor authentication (an authenticator app, passkeys, security keys and backup codes)
- your active sessions
- your own notification preferences

## Before you start

Sign in and open **My account** from the top-right account menu. No special permission is needed. Every signed-in staff account can manage its own profile, password and two-factor authentication.

**My account** has four tabs. The active tab is part of the page's URL, so a reload or a bookmarked link returns to the same tab.

| Tab | What is there |
|-----|---------------|
| **Profile** | Display name, regional format, time format, language, phone number, Role, Account type, and the SSO connect and unlink menu |
| **Password** | Change password, and everything under Two-factor authentication: authenticator app, passkeys, security keys and backup codes |
| **Sessions** | Active sessions and revoke actions |
| **Notifications** | Your personal grid of alert types, with an Email and an In-app switch each |

## Steps

### Profile tab

Edit the fields, then click **Save**. Save stays disabled until something has changed.

| Field | What it does |
|-------|--------------|
| **Display name** | The name other staff see: in role assignments, audit logs and delivery history |
| **Regional format** | How dates are shown to you, for example `28 Jun 2026` or `06/28/2026`. The interface language stays English |
| **Time format** | 24-hour time, or 12-hour time with AM/PM. **System default (browser)** uses your browser's setting. It does not change the date format |
| **Language** | Read-only for now: **English (US)**. Admitto is English-only today. The field is disabled, with a "More languages are coming soon" note, to show where a language choice will live |
| **Email** | For reference only. You cannot change it here. Ask your administrator |
| **Phone number** | Optional, for internal staff contact only. Pick the country code, then enter the number. It is never shown on tickets or to attendees |
| **Role** | Read-only. Your current role (Operator, Organisation Admin or Superadmin) and, for Operator and Organisation Admin, the events or organisations it applies to. Only your administrator can change it. See [Roles and Permissions](Roles-and-Permissions) |
| **Account type** | Read-only. **Local account** if you sign in with a password you set yourself. **Managed by \<provider name\>** if your sign-in is linked to an organisation identity provider (SSO, short for single sign-on). An account can be both: a local password kept as a fallback next to a linked provider |

#### The SSO menu

The **SSO** menu is in the Profile card header, next to the card title. It appears only when there is something to connect or unlink. If more than one provider is configured, both kinds of action can be available at once.

**Connect \<provider name\>** links an additional identity provider to your account. One item appears for each enabled provider you are not yet linked to.

1. Select the item. You go to that provider's sign-in page.
2. Confirm your identity there with your current local password, plus a two-factor code if your account requires one.
3. The new provider is linked.

This needs a local password, so the item appears only once your account has one. Set it under **Password**, or ask your administrator to set it for you.

**Unlink SSO** removes every identity provider currently linked to your account. You fall back to a local password (or set one). It also removes a linked Cloudflare Access identity, if you have one, because unlinking one credential and leaving the other would break a later Cloudflare Access sign-in. See [Cloudflare Access - Identity Linking](Cloudflare-Access-Identity-Linking).

To unlink SSO:

1. Open the **SSO** menu and choose **Unlink SSO**.
2. Set the new local password you will sign in with.
3. Confirm who you are. What you are asked for depends on your account:
   - You have a confirmed authenticator app, passkey or security key: confirm with a code from it, a backup code, or the passkey or security key itself, instead of a password. This applies whatever your role.
   - Otherwise, you have a local password: enter it.
   - You have neither (a brand-new SSO-only account that has never used either): you cannot unlink yourself. Ask your administrator to unlink it for you.
4. Unlinking ends your other active sessions at once. The session you are using stays signed in.

If any of your roles was assigned automatically by an identity provider group (a small cloud icon sits next to the role's scope on this page), unlinking is blocked. Your administrator must remove that role first, or you must leave the group. This stops access managed by an SSO group from being quietly turned into access you control yourself.

### Password tab

#### Change your password

Enter your current password and a new one (at least 12 characters).

- It ends your other active sessions, and every "Remember this device" trust on this account. You are asked for a two-factor code again on those devices.
- The session you are using stays signed in.
- It is not available on an account with no local password (SSO-only).

#### Two-factor authentication

**Authenticator app (TOTP)**

1. Click **Set up**. A popup opens with a QR code to scan and a field for the digit code.
2. Save the 10 backup codes shown once during setup. They are your fallback if you lose access to the app.
3. Once it is set up, the button becomes **Manage**. It opens a popup with one action, **Remove**. Remove takes out only the authenticator app. Passkeys, security keys and backup codes stay.

**The options menu** (three-dot icon in the card's header) has two more actions:

- **Reset everything:** clears every confirmed two-factor method at once. See [Important decisions](#important-decisions).
- **Forget all trusted devices:** ends every "Remember this device" trust for this account at once, without waiting for each to expire. It is available whenever you have a confirmed two-factor method, even without a local password (unlike Reset everything). It is disabled when there is nothing to forget.

If your role requires two-factor authentication and you have a confirmed method, both **Remove** and the full reset ask you to confirm first. Use a code from your authenticator app, a backup code, or a passkey or security key.

**Passkeys and security keys**

Register one or more as extra two-factor methods, next to the authenticator app. A registered passkey or security key works like a code from your app:

- at the two-factor step after your password (a "Use a passkey or security key" option appears)
- to confirm sensitive account actions

| Type | What it is | Typical example |
|------|------------|-----------------|
| Passkey | Built into your device, unlocked with the device's own screen lock | Face ID, Touch ID, Windows Hello |
| Security key | A separate physical device you plug in or tap | YubiKey or similar |

To add one:

1. Click **Add passkey** or **Add security key**.
2. Give it a name in the popup. The name is required. It is how you tell several keys apart later, for example "Work laptop" and "Phone".
3. Follow your browser's or device's prompt.

Good to know:

- There is no limit on how many you can register.
- If this is your first confirmed two-factor method, the popup shows your 10 backup codes once, the same as when you set up an authenticator app. Save them before you close it.
- If an administrator has turned on passkey sign-in for this instance (Settings → Security), a registered passkey also appears as **Sign in with a passkey** on the sign-in screen. You can then skip typing your password. The passkey itself already satisfies your two-factor requirement, so there is no separate code step afterwards.

To remove one, find it in its list under **Two-factor authentication** and click **Remove**.

- If your role requires two-factor authentication and you have a confirmed method, you confirm first with a code from your authenticator app, a backup code, or a passkey or security key.
- If it was your last two-factor method, you set one up again the next time you sign in.

**Backup codes**

The row appears once you have at least one confirmed two-factor method: an authenticator app, a passkey or a security key.

- **What it shows:** how many of your 10 codes are still unused, for example "7 of 10 remaining", or **None generated yet**.
- **Account-wide:** backup codes are not tied to one authenticator app, passkey or security key. They work as a second factor whichever method you normally use.
- **To regenerate:** click **Manage**, then **Regenerate**. Your current codes stop working and you get a fresh set of 10, shown once as plain text. Save them somewhere safe. You cannot view them again after you close the popup.
- **No single delete:** backup codes cannot be removed one by one. Regenerating is the only way to invalidate old ones.
- **Step-up:** if your role requires two-factor authentication and you have a confirmed method, regenerating asks you to confirm first. Use a code from your authenticator app, another backup code, or a passkey or security key.

### Sessions tab

See where your account is signed in: device, IP, sign-in method and last activity. Revoke any session that is not yours, or all other sessions at once.

- The list is paginated: 10 per page by default, or choose 25 or 50.
- On a phone-width screen it shows as a stack of cards, one per session, instead of a table.

### Notifications tab

A grid of the security alert types your role can receive:

- repeated failed logins
- emergency two-factor bypass use
- login or security settings changed
- sign-in from a new country
- admin or superadmin role granted

Each has its own **Email** and **In-app** switch.

- Turning a switch on or off saves at once. There is no Save button here.
- The grid controls channels for your own account only. The shared team webhook (if your organisation has one) is managed separately by a superadmin in Organisation Settings → Notifications.

**The bell icon** (top right of every page)

- It shows how many in-app alerts are unread, and opens a short list of the most recent ones. Each is labelled with its organisation, if you have access to more than one.
- The list shows only the first two lines of each alert. Click one to open a window with the full message, the organisation, and the exact time it arrived (in UTC and in your local time). Opening an unread alert marks it read.
- The double-checkmark icon is **Mark all as read**.
- The trash icon is **Clear all**. It asks for confirmation, then permanently deletes your own notification history. It removes only the in-app copy, not your organisation's security audit trail, and future alerts still arrive.
- Anything you never clear yourself is deleted automatically after 30 days.

**Alerts you cannot configure**

- **Changes to your own account.** Every account, Operators included, always gets one more alert whenever its own password, two-factor method, passkey or single sign-on connection changes. This is true whether you made the change or another admin made it for you. The alert is not a row in the grid and cannot be turned off, by design. It is the one alert meant to catch an unauthorized change to your account, so an attacker who already has access cannot silence it.
- **Sign-in from a new country.** Admins and Superadmins also get a personal alert when their own account signs in from a country not seen among its recent successful logins. They learn whether their own credentials might be in someone else's hands, not just the rest of the admin team.
- **A reused code.** Anyone with an authenticator app gets a third personal alert if a code from that app is submitted again after it was already used to sign in. This suggests someone else may have seen the code, since a genuine authenticator app never produces the same code twice.

**Operators** see the same grid and bell. They never receive the five alert types in the grid, because those are aimed at organisation admins and superadmins, so the switches stay unused for that role.

## Expected result

Profile changes take effect immediately and are visible to administrators who view your account (for example in Users & roles). A password change or a session revoke signs out every other active session immediately. The device you are using stays signed in.

## Important decisions

**Your profile**

- Role is informational on this page. Ask your administrator for role changes.
- Account type updates itself as you connect or unlink identity providers. There is nothing to save separately.
- Phone number is for internal contact only, by design. It is never shown on attendee-facing tickets or pages.
- Regional format changes how dates look to you only. It does not affect what other staff see, and it does not change the interface language.
- Time format changes how time fields look to you only. It can be 12-hour time with AM/PM or 24-hour time, whatever the regional date format is.
- Language is a preview of a future setting. Admitto is English-only today, so the field is disabled, with one fixed option.

**Two-factor authentication**

- If your role requires two-factor authentication, you confirm with a TOTP code, a backup code or a registered passkey or security key before any of these can complete: a password change, removing the authenticator app, a full 2FA reset, removing a passkey or security key, and regenerating backup codes.
- **Adding a method needs a confirmation too.** If your account already has a confirmed authenticator app, passkey or security key, adding another one (a passkey, a security key or an authenticator app) asks you to confirm with a code from an existing method, a backup code, or a passkey or security key you already registered, whatever your role. This stops someone who only has your open browser session from attaching their own device to your account. Your very first method needs no confirmation, because there is nothing yet to confirm with.
- **Remove or Reset everything?** **Remove**, in the Manage popup, takes out only the authenticator app and leaves your passkeys, security keys and backup codes untouched. **Reset everything**, in the card's options menu, clears all of them together in one step. Choose Remove when you want to swap or drop the app. Choose Reset everything only when you want a completely clean slate.
- **Backup codes** are an account-wide fallback. They work as a second factor whichever method you use day to day. They can only be regenerated. You cannot delete them one by one or view them again once the popup is closed. Regenerating immediately invalidates every code from the previous batch.
- **Remember this device** is offered only right after you pass the two-factor step in that same sign-in, and for a few minutes at most. A session that did not pass two-factor itself (for example one that came from single sign-on or a passkey sign-in) cannot mark a device as trusted. Removing an authenticator app, a passkey or a security key also forgets every remembered device on the account, so you are asked for a two-factor code again on each of them.
- Passkeys and security keys are extra second-factor options next to the authenticator app, not a replacement for it. Your password (or SSO) plus one of these is still how you sign in. The separate "Sign in with a passkey" option on the sign-in screen, when an administrator turns it on, is the only way a passkey replaces typing your password. A security key cannot be used there: it works only for the two-factor step and for confirming sensitive actions. You can register any number of passkeys or security keys, and every one needs a name so you can tell them apart.
- An administrator controls passkeys and security keys from Settings → Security with two switches:
  - **Turn passkeys and security keys off for the whole instance:** a full kill switch. The Add buttons stay visible but disabled (a note above them explains why). Already registered passkeys and security keys stop working too, both for signing in and for confirming sensitive actions. A user whose only confirmed method is a passkey falls back to a backup code in the meantime.
  - **Turn the sign-in-screen passkey option on or off**, separately from the switch above.
  - The authenticator app is unaffected either way.

**Unlinking SSO**

- Unlinking SSO always demands one proof of identity beyond being signed in: a TOTP code, a backup code or a passkey or security key if you have one confirmed, otherwise your current local password. The proof is required because unlinking replaces the credential that gets you into the account.
- An account with neither has nothing to unlink with self-service. That is an intentional dead end, not a bug.
- A role granted to you by an identity provider group cannot be turned into a role you control just by unlinking SSO. Your administrator has to remove the grant first, or you leave the group.

## What changes after this action

- A changed display name appears wherever your name is shown to other staff: role assignments, audit and security logs, delivery history.
- A changed password or a session revoke ends every other active session. You need to sign in again on those devices.
- After you unlink SSO, Account type switches to **Local account**, and signing in through the removed provider stops working immediately. Use the new local password you set.
- After you connect a provider, Account type shows the new link and you can sign in with either method.
- A newly added passkey or security key is registered immediately and works right away: at the two-factor step, to confirm sensitive account actions, and (a passkey only, when an administrator has turned it on) directly from the sign-in screen. If an administrator turns passkeys and security keys off for the whole instance (see Important decisions above), only your authenticator app or a backup code work until they are turned back on.
- If you remove your last two-factor method (the authenticator app via Remove, a passkey, or a security key) and your role requires two-factor authentication, you are asked to set one up again the next time you sign in.
- Regenerating backup codes immediately invalidates every code from the previous batch. Only the new set shown at that moment is valid.

## Common problems

**Profile and loading**

| Problem | What it means and what to do |
|---------|------------------------------|
| **Save stays disabled** | Nothing has changed yet. Save becomes active once a field differs from its saved value |
| **The page shows grey boxes, or says "Taking longer than usual"** | The page is waiting for the server. Wait a moment and check your connection. After 30 seconds it stops waiting and shows "The server did not answer in time" with a **Retry** button. The Sessions and Notifications cards show their own message and **Retry**, so a problem in one card does not hide the rest of the page |
| **A warning says "Could not refresh this page, so it may show older details"** | What you saved was saved, but loading the page again afterwards failed, so some details on screen may be out of date. Press **Retry** in the warning to load the current details. Nothing you typed or opened is lost |
| **Can't change email** | By design, email is not editable here. Ask your administrator |
| **The Password section is missing** | The account is SSO-only (no local password). Sign-in and password are managed by the linked identity provider |

**Two-factor authentication**

| Problem | What it means and what to do |
|---------|------------------------------|
| **You lost access to the authenticator app** | Use a saved backup code to sign in, then reset 2FA and set it up again from this page |
| **The authenticator app now shows "Manage" instead of "Reset"** | That is expected. Manage opens a popup with just **Remove** (authenticator app only). To also clear passkeys, security keys and backup codes, use **Reset everything** in the card's options menu (the three-dot icon). Nothing is missing. It is relabelled and split into two places |
| **No "Backup codes" row** | It appears only once you have at least one confirmed two-factor method. Set up an authenticator app, a passkey or a security key first |
| **Regenerating backup codes asks for a code** | That is the required step-up check for accounts whose role requires two-factor authentication. It is not an error. Enter a code from your authenticator app, a saved backup code, or use a registered passkey or security key |
| **A saved backup code stopped working** | Each **Regenerate** invalidates every code from the previous batch immediately. Only the newest set, shown once when you regenerated, is valid |
| **A correct backup code did not sign you in** | If your sign-in session had just expired, or been signed out from another device at that exact moment, the code is not consumed and stays valid. Enter it again to complete sign-in. Only a wrong or already-used code is rejected outright |

**Passkeys and security keys**

| Problem | What it means and what to do |
|---------|------------------------------|
| **"Add passkey" or "Add security key" does not appear at all** | Your account has no local password yet. Set one under Password first, or ask an administrator to set one for you |
| **"Add passkey" or "Add security key" is greyed out** | An administrator has turned passkeys and security keys off for this instance. The note above the buttons explains this and who to ask |
| **Removing a passkey or security key asks for a code** | That is the required step-up check for accounts whose role requires two-factor authentication. It is not an error. Enter a code from your authenticator app, a saved backup code, or confirm with another registered passkey or security key |

**Single sign-on**

| Problem | What it means and what to do |
|---------|------------------------------|
| **No "SSO" menu on the Profile card** | Nothing is linked, and no identity provider is configured for the instance. There is nothing to connect or unlink |
| **"Connect" is missing for a provider** | Either you are already linked to it, or your account has no local password yet. Set one under Password first, or ask your administrator to set one for you |
| **Unlink SSO asks for a password or authenticator code you do not recognize** | That is the required proof of identity, not an error. Enter your current local password, or confirm with a code from your authenticator app, a saved backup code, or a passkey or security key, whichever the dialog asks for |
| **Unlink SSO says some roles are managed by your identity provider** | Your administrator must remove that role assignment, or you must leave the underlying provider group, before self-service unlink is available |
| **Unlink SSO is not available, and there is no password or authenticator prompt** | The account has neither a local password nor a confirmed authenticator app to verify with. Ask your administrator to unlink it for you |

**Notifications**

| Problem | What it means and what to do |
|---------|------------------------------|
| **The bell never shows an unread count for an Operator account** | The five alert types in the grid are aimed at organisation admins and superadmins, so an Operator is never sent one of them, even with every switch turned on. An Operator's bell still shows an unread count whenever their own password, two-factor method, passkey or SSO connection changes. That alert applies to every role and cannot be turned off |

## Related pages

- [Roles and Permissions](Roles-and-Permissions)
- [Identity and SSO](Identity-and-SSO)
- [Users and Roles Administration](Users-and-Roles-Administration)
