# Users and Roles Administration

> **Audience:** Organisation Admins and Superadmins
> **Required role:** Organisation Admin for assignments; Superadmin for staff accounts
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Manage staff accounts and assign access at the correct scope.

## Before you start

Decide what the person must do, which organisation or event they need, and when the access should end.

## Steps

1. Open **Users & roles**.
2. Superadmins can use **Staff users** to invite, search, edit, enable, or disable staff accounts.
3. Open **Role assignments** to add or review scoped roles.
4. Superadmins can open **Active sessions** to see every signed-in staff session (device, IP address, sign-in time, last activity), end one specific session, or end every operator session for one event at once.
5. Use instance scope only for a Superadmin.
6. Use organisation scope for an Admin.
7. Use event scope for an Operator.
8. Confirm the assignment by signing in with a synthetic test account or asking the user to verify their visible events.

## Expected result

The user sees only the administration or check-in surfaces allowed by the new assignment.

## Important decisions

- One user can have more than one assignment. Effective access is the combination of active assignments.
- Disabling a user blocks the account; removing one assignment only removes that scope.
- Do not remove or disable the last active Superadmin.
- Local Admin and Superadmin accounts must follow the configured MFA policy. OIDC sessions follow the identity provider flow.

## What changes after this action

New sessions use the updated assignments. Use **Active sessions** when access must end immediately.

## Common problems

- **The user cannot sign in:** check account status, sign-in method, and MFA requirements.
- **The user sees the wrong events:** inspect every assignment, not only the newest one.
- **A role option is unavailable:** your own role may not manage that scope.

## Related pages

- [Roles and Permissions](Roles-and-Permissions)
- [Organisation Administration](Organisation-Administration)
- [Identity and SSO](Identity-and-SSO)
- [Instance Settings](Instance-Settings)
