# Users and Roles Administration

**Audience:** Organisation Admins and Superadmins · **Required role:** Administrator for assignments; Superadmin for staff accounts · **Feature status:** ✅ Available · **Last verified:** Admitto 0.5.1

## What this page helps you do

Manage staff accounts and assign access at the correct scope.

## Before you start

Decide what the person must do, which organisation or event they need, and when the access should end.

## Steps

1. Open **Users & roles**. KPI tiles above the tabs summarise **Staff users**, **Via SSO**, **MFA coverage**, and **Active sessions**.
2. Superadmins can use **Staff users** to invite, search, edit, enable, or disable staff accounts.
3. When inviting or editing a user, choose exactly one role type: **Superadmin**, **Administrator**, or **Operator**. Organisation and event scopes still stack within that role type.
4. Optionally enter an internal staff **phone** (country code + number). It is never shown on tickets.
5. Open **Role assignments** to add or review scoped roles. Superadmins and admins can filter assignments by event. **Granted** shows UTC and your local time.
6. Superadmins can open **Active sessions** to see every signed-in staff session (device, IP with country when known, sign-in time, last activity), **Edit** a session's device label, end one session, or end every operator session for one event at once.
7. In **Edit user**, profile fields (including email) save with **Save profile**. Role and scope changes save immediately from **Role & access**. **More actions** / Danger zone lets a Superadmin **Delete** the account or unlink SSO when applicable. Under **Sign-in security**, a Superadmin can also **Reset two-factor** or **Reset password** for a staff account that lost access, which revokes that account's sessions.
8. Use instance scope only for a Superadmin.
9. Use organisation scope for an Admin.
10. Use event scope for an Operator.
11. Confirm the assignment by signing in with a synthetic test account or asking the user to verify their visible events.

## Expected result

The user sees only the administration or check-in surfaces allowed by their current role type and scopes.

## Important decisions

- A person holds **exactly one role type** at a time. Switching role type applies after confirmation and cannot be mixed with unsaved scope edits for the previous type.
- Within the current role type, more than one organisation or event scope can be active. Effective access is the combination of those scopes.
- In the Edit user dialog, adding or removing a scope for the user's current role type is staged locally and only takes effect when you save Role & access changes as the UI describes.
- Disabling a user blocks the account; removing one assignment only removes that scope.
- Do not remove or disable the last active Superadmin.
- Local Admin and Superadmin accounts must follow the configured MFA policy. OIDC sessions follow the identity provider flow.
- Resetting another Superadmin's two-factor or password requires the acting Superadmin to confirm their own authenticator app or backup code first. This protects against a single compromised Superadmin session being used to silently take over another Superadmin account. Resetting your own account never requires this. If you signed in through single sign-on and have no local password, you cannot set up an authenticator app yourself to satisfy this - ask another Superadmin who already has one confirmed to perform the reset instead.
- Deleting a staff account is permanent. Prefer disable when you only need to stop access.

## What changes after this action

New sessions use the updated assignments. Use **Active sessions** when access must end immediately.

## Common problems

- **The user cannot sign in:** check account status, sign-in method, and MFA requirements.
- **The user sees the wrong events:** inspect every scope for their role type, not only the newest one.
- **A role option is unavailable:** your own role may not manage that scope.
- **No role assigned after sign-in:** the account lands on My account with a notice until a Superadmin grants a usable assignment.
- **"You need a confirmed authenticator app..." when resetting another Superadmin:** set up two-factor authentication on your own account first, then retry the reset. If you have no local password (single sign-on only), you cannot do this yourself - ask another Superadmin with a confirmed authenticator app to perform the reset instead.

## Related pages

- [Roles and Permissions](Roles-and-Permissions)
- [Organisation Administration](Organisation-Administration)
- [Identity and SSO](Identity-and-SSO)
- [Organisation Settings](Organisation-Settings)
- [My Account](My-Account)
