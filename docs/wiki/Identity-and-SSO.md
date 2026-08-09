# Identity and SSO

> **Audience:** Superadmins
> **Required role:** Superadmin
> **Feature status:** Available
> **Last verified:** Admitto 0.4.13

## What this page helps you do

Configure supported OIDC sign-in and Cloudflare Access from the administration UI.

This page covers two independent, optional layers:

- **OIDC single sign-on (SSO)** connects Admitto to your organisation's identity provider (for
  example Microsoft Entra ID, Okta, or Authentik) so staff sign in with their existing corporate
  account instead of a separate Admitto password. The provider's group membership can be mapped to
  Admitto roles, so adding or removing someone from a group in the identity provider changes what
  they can do here too.
- **Cloudflare Access** is a zero-trust network access (ZTNA) gateway: it checks a staff member's
  identity and, optionally, their device before their request is even allowed to reach Admitto —
  a perimeter control, not a replacement for Admitto's own roles. Enable it if your organisation
  wants staff URLs unreachable to anyone who hasn't already authenticated at the network edge, on
  top of signing in to Admitto itself.

Both are optional; a deployment can use local passwords only, OIDC only, Cloudflare Access only,
or any combination. See [Glossary](Glossary) for short definitions of SSO, OIDC, and ZTNA.

### Login methods at a glance

| Method | What the staff member sees | What you need to set up | Where it's configured |
|---|---|---|---|
| **Local password** | Email + password, plus an authenticator app code (MFA) for roles that require it | Nothing extra — this always works, even if the two options below are also enabled | Built in; no setup |
| **OIDC single sign-on** | A "Sign in with `<your provider>`" button that sends them to your identity provider's own login page | Values from your identity provider (see the table below) | **Organisation settings → Identity → OIDC providers** |
| **Cloudflare Access (ZTNA)** | A Cloudflare login/device-check screen *before* they ever see Admitto's own login page | A Cloudflare Zero Trust team and an Access application in front of Admitto's staff URLs | **Organisation settings → Identity → Cloudflare Access**, plus the Cloudflare dashboard |

A local password always keeps working as a fallback (unless the account has no local password set — see
**Important decisions**), so enabling OIDC or Cloudflare Access is never an all-or-nothing switch.

## Before you start

Have a separate working Superadmin session, an approved test account, and the identity provider values supplied through a secure channel.

> [!CAUTION]
> Keep the separate Superadmin session open while testing identity or Cloudflare Access changes. An incorrect configuration can block staff access.

## Steps

### Setting up OIDC (SSO)

1. Open **Organisation settings**, then **Identity**.
2. Add a new OIDC provider.
3. Fill in the form. Every field here is something you copy from your identity provider's own admin
   console (Entra ID calls it an "App registration"; Okta and Authentik call it an "Application"):

   | Field in Admitto | What it is | Example |
   |---|---|---|
   | Display name | The name shown on the "Sign in with…" button | `Contoso SSO` |
   | Issuer URL | Your identity provider's base URL | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
   | Client ID | The application/client ID your identity provider assigned when you registered Admitto there | `1a2b3c4d-...` |
   | Client secret | The client secret your identity provider generated for that same registration | *(paste once; never shown again)* |
   | Authorization / Token / JWKS / UserInfo endpoints | Usually filled automatically by **Discover** (step 5) from the Issuer URL. Fill by hand only if your provider doesn't support discovery | |
   | Email / Name / Given name / Family name / Phone / Groups claims | Which field in the token holds each piece of information. Most providers use sensible defaults; adjust only if your provider names them differently | `email`, `name`, `groups` |

   Given name/family name are only used if the provider doesn't send one combined name field; the
   phone claim is optional and only takes effect if your provider actually sends one.

4. **Save once** so Admitto assigns a provider id. On the edit form, copy the read-only **Redirect URI**
   from the Basics card and register that exact URL at your identity provider (Entra App registration,
   Okta or Authentik Application). The URI is not shown until after the first save. Pattern:

   ```
   https://<your-instance-url>/api/auth/oidc/<provider-id>/callback
   ```

   If Redirect URI is missing in the editor, set **Instance URL** under Organisation settings → General
   first. You can save with a placeholder Client ID/secret, register the callback, then paste the real
   credentials.
5. Use **Discover** (fills the endpoint fields automatically from the Issuer URL) and **Test
   connection** before finishing configuration.
6. Configure group-to-role mappings only after confirming the provider's group claim. This is
   what turns "member of the `IT-Admins` group in Entra ID" into "Superadmin in Admitto."
7. Save the provider and test sign-in with a non-critical account, in the separate Superadmin
   session mentioned above, not the one you're using to configure this.

### Setting up Cloudflare Access (ZTNA)

Do this in Cloudflare's own dashboard first, then in Admitto:

1. In **Cloudflare Zero Trust**, create an **Access application** that protects your Admitto staff
   URLs (for example `admin.example.com/*`) and set the policy for who's allowed through (by email
   domain, group, or identity provider).
2. From that Access application, copy the **team domain** (looks like
   `https://yourteam.cloudflareaccess.com`) and the **Application Audience (AUD) tag**, a long
   hex string Cloudflare shows on the application's Overview tab.
3. In Admitto, open **Organisation settings → Identity → Cloudflare Access** and fill in:

   | Field in Admitto | What it is | Example |
   |---|---|---|
   | Cloudflare team URL | Your Zero Trust team domain | `https://yourteam.cloudflareaccess.com` |
   | Application token (AUD) | The Application Audience tag from Cloudflare | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
   | Protected URL paths | Which paths this rule applies to, comma-separated | `/admin, /api/admin` |

4. Use **Test connection**, confirm it succeeds, and only then enable enforcement.

## Expected result

The test account can sign in through the configured provider and receives only the roles produced by approved mappings. Cloudflare Access protects only the configured paths when enabled.

## Important decisions

- OIDC and local sign-in are separate authentication methods.
- An account created automatically on someone's first OIDC sign-in gets a random password nobody
  knows — for that account, OIDC is not just an alternative to the local password, it is the only
  way in until an admin sets a real password for them (or they set one themselves, e.g. when
  unlinking SSO from **My account**).
- A group mapping can add or remove scoped roles on later sign-ins. Manual assignments are not treated as provider-owned grants.
- A signed-in user's display name and phone number re-sync from the provider on every sign-in. A superadmin's own manual edit to either field in Users and Roles Administration takes priority and is not overwritten by a later sign-in.
- The system prevents removal of the last active instance Superadmin assignment.
- Enabling Cloudflare Access with incorrect audience or path values can block staff access.
- Secrets are never displayed again after saving.

## What changes after this action

Enabled providers appear in the staff sign-in flow. Updated mappings apply when affected users sign in again. Display name and phone number changes made at the identity provider also apply the next time the affected user signs in. Access enforcement applies to configured paths after it is enabled.

## Common problems

- **Discovery fails:** verify the HTTPS issuer and provider availability.
- **Sign-in works but the role is wrong:** check the groups claim and every mapping.
- **Sign-in redirects to an error at the identity provider ("redirect URI mismatch" or similar):** the callback registered at the provider must exactly match the **Redirect URI** shown in the provider editor (Instance URL + `/api/auth/oidc/<provider-id>/callback`). Check for a trailing slash, `http` vs `https`, or the wrong provider id. If Redirect URI is missing in the editor, set Instance URL under Organisation settings → General first.
- **Cloudflare test fails:** check the team URL and audience without copying tokens into support messages.
- **The change risks lockout:** stop and use the separate Superadmin session to restore the last known working configuration.

## Related pages

- [Users and Roles Administration](Users-and-Roles-Administration)
- [Organisation Settings](Organisation-Settings)
- [Logs and Audit](Logs-and-Audit)
- [Technical Documentation](Technical-Documentation)
- [My Account](My-Account) — staff self-service: once a provider is enabled here, each account connects or unlinks it for themselves from **My account**, without needing this page.
