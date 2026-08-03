# Identity and SSO

> **Audience:** Superadmins
> **Required role:** Superadmin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.12

## What this page helps you do

Configure supported OIDC sign-in and Cloudflare Access from the administration UI.

## Before you start

Have a separate working Superadmin session, an approved test account, and the identity provider values supplied through a secure channel.

> [!CAUTION]
> Keep the separate Superadmin session open while testing identity or Cloudflare Access changes. An incorrect configuration can block staff access.

## Steps

1. Open **Organisation settings**, then **Identity**.
2. Add or open an OIDC provider.
3. Enter the display name, issuer, client details, endpoints, and claims required by the form.
4. Use discovery or the test action when available before saving.
5. Configure group-to-role mappings only after confirming the provider's group claim.
6. Save the provider and test sign-in with a non-critical account.
7. Open **Cloudflare Access** only when the instance uses it; enter the team URL, audience values, and protected paths, then test before enabling enforcement.

## Expected result

The test account can sign in through the configured provider and receives only the roles produced by approved mappings. Cloudflare Access protects only the configured paths when enabled.

## Important decisions

- OIDC and local sign-in are separate authentication methods.
- A group mapping can add or remove scoped roles on later sign-ins. Manual assignments are not treated as provider-owned grants.
- The system prevents removal of the last active instance Superadmin assignment.
- Enabling Cloudflare Access with incorrect audience or path values can block staff access.
- Secrets are never displayed again after saving.

## What changes after this action

Enabled providers appear in the staff sign-in flow. Updated mappings apply when affected users sign in again. Access enforcement applies to configured paths after it is enabled.

## Common problems

- **Discovery fails:** verify the HTTPS issuer and provider availability.
- **Sign-in works but the role is wrong:** check the groups claim and every mapping.
- **Cloudflare test fails:** check the team URL and audience without copying tokens into support messages.
- **The change risks lockout:** stop and use the separate Superadmin session to restore the last known working configuration.

## Related pages

- [Users and Roles Administration](Users-and-Roles-Administration)
- [Organisation Settings](Organisation-Settings)
- [Logs and Audit](Logs-and-Audit)
- [Technical Documentation](Technical-Documentation)
