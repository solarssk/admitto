# Identity and SSO

| Field | Value |
|---|---|
| **Audience** | Superadmins |
| **Required role** | Superadmin |
| **Feature status** | Available |
| **Last verified** | Admitto 0.5.0 |

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
  top of signing in to Admitto itself. It is a separate layer in front of sign-in, not a
  replacement for it - see [Cloudflare Access - Identity Linking](Cloudflare-Access-Identity-Linking)
  for why both are needed.

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

- You need a separate Superadmin session available (another browser profile or a break-glass
  local account) so you can undo a bad mapping without locking yourself out.
- Know your public **Instance URL** (Organisation settings → General, or `BASE_URL`). The OIDC
  Redirect URI is derived from it after the first provider save.
- If the identity provider is only reachable on a private LAN address (or a hostname that
  resolves there), set `SSO_PRIVATE_DESTINATION_ALLOWLIST` on the **app** container to that exact
  hostname or IP before Discover / Test / sign-in will succeed in production. One allowlist covers
  every SSO provider that uses those hosts (OIDC today; the same variable is intended for future
  SAML). HTTPS is still required.
- Have an approved test account and the identity provider values supplied through a secure channel.

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
   | Issuer URL | Your identity provider's base URL, **not** the `/.well-known/openid-configuration` discovery document some providers show you; pasting that full URL is a common mistake. Admitto accepts and corrects it automatically, but the bare URL is what's actually stored | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
   | Client ID | The application/client ID your identity provider assigned when you registered Admitto there | `1a2b3c4d-...` |
   | Client secret | The client secret your identity provider generated for that same registration | *(paste once; never shown again)* |
   | Authorization / Token / JWKS / UserInfo endpoints | Usually filled automatically by **Discover** (step 5) from the Issuer URL. Fill by hand only if your provider doesn't support discovery | |
   | Email / Name / Given name / Family name / Phone / Groups claims | Which field in the token holds each piece of information. Most providers use sensible defaults; adjust only if your provider names them differently | `email`, `name`, `groups` |

   Given name/family name are only used if the provider doesn't send one combined name field; the
   phone claim is optional and only takes effect if your provider actually sends one.

4. **Save once** so Admitto assigns a provider id. On the edit form, copy the read-only **Redirect URI**
   from the Basics card (the same URL Admitto sends to the identity provider) and register that exact
   value at your identity provider (Entra App registration, Okta or Authentik Application). The URI is
   not shown until after the first save. Pattern:

   ```
   https://<your-instance-url>/api/auth/oidc/<provider-id>/callback
   ```

   If Redirect URI is missing in the editor, set **Instance URL** under Organisation settings → General
   (or `BASE_URL` in the environment) first. You can save with a placeholder Client ID/secret, register
   the callback, then paste the real credentials.

   If your identity provider validates post-logout redirect targets (most do), also register
   `https://<your-instance-url>/login` there, alongside the callback URI. Admitto's **Log out**
   redirects through the identity provider's own logout when it advertises one via discovery, then
   back to that address; without this registered, the provider will refuse the redirect and the
   user lands on a provider-side error instead of back at Admitto.
5. Use **Discover** (fills the endpoint fields automatically from the Issuer URL) and **Test
   connection** before finishing configuration.
6. Configure group-to-role mappings only after confirming the provider's group claim. This is
   what turns "member of the `IT-Admins` group in Entra ID" into "Superadmin in Admitto." Each
   role always applies at one fixed level, shown next to it and not separately chosen: Superadmin
   is instance-wide, Admin picks an Organization, Operator picks an Event, both from a searchable
   list rather than a typed ID.
7. Save the provider and test sign-in with a non-critical account, in the separate Superadmin
   session mentioned above, not the one you're using to configure this.

### Setting up Cloudflare Access (ZTNA)

Do this in Cloudflare's own dashboard first, then in Admitto:

1. First configure and enable the direct OIDC provider in Admitto. It remains the authoritative
   identity and role source; Cloudflare Access is the edge gate, not a second staff directory.
2. In **Cloudflare Zero Trust**, create an **Access application** that protects your Admitto staff
   URLs (for example `admin.example.com/*`) and set the policy for who's allowed through (by email
   domain, group, or identity provider). Copy that application's **team domain** (looks like
   `https://yourteam.cloudflareaccess.com`) and **Application Audience (AUD) tag**, a long hex
   string Cloudflare shows on the application's Overview tab.
3. Bind Cloudflare sign-ins to the direct provider account from step 1, instead of a second,
   untrusted identity: see [Cloudflare Access - Identity Linking](Cloudflare-Access-Identity-Linking)
   for the exact custom claim Cloudflare must forward, the identity-provider-side mapping and
   stable-identifier requirement, and a full troubleshooting list. This is required, not optional -
   the **Direct identity provider** field in step 4 below has no effect until this is done, and
   every staff account that will sign in through Cloudflare must also sign in through the direct
   provider once first, which is what actually creates the link Admitto trusts later.
4. In Admitto, open **Organisation settings → Identity → Cloudflare Access** and fill in:

   | Field in Admitto | What it is | Example |
   |---|---|---|
   | Cloudflare team URL | Your Zero Trust team domain | `https://yourteam.cloudflareaccess.com` |
   | Application token (AUD) | The Application Audience tag from Cloudflare | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
   | Protected URL paths | Which paths this rule applies to, comma-separated | `/admin, /api/admin, /api/checkin` |
   | Direct identity provider | The enabled direct OIDC provider from step 1, linked per step 3 | `Corporate OIDC` |

5. Use **Test connection**, confirm it succeeds, and only then enable enforcement. Test in a
   private browser window: after Cloudflare has authenticated the staff member, Admitto should
   enter as the already linked direct-provider account without showing a second Admitto sign-in
   screen.

## Expected result

The test account can sign in through the configured provider and receives only the roles produced by approved mappings. Cloudflare Access protects only the configured paths when enabled. Its verified edge sign-ins bind to the same pre-linked direct-provider account and reconcile that provider's managed group roles on every sign-in.

## Important decisions

- OIDC and local sign-in are separate authentication methods.
- An account created automatically on someone's first OIDC sign-in has no local password at all,
  so unlinking SSO from **My account** requires proving identity first (TOTP, or an existing
  password). An account with neither cannot self-service unlink; it is directed to ask a
  superadmin, who can set a new password for it from Users and roles → the account's **Unlink
  identity provider** action.
- Signing out ends the session at the identity provider too, when it advertised a logout endpoint
  during **Discover**. If it didn't (or the provider was configured before this existed, re-run
  **Discover** to pick it up), signing out only ends the local Admitto session, same as before.
- A group mapping can add or remove scoped roles on later sign-ins. Manual assignments are not treated as provider-owned grants.
- Cloudflare Access verifies the edge session; the selected direct OIDC provider remains the source
  of account identity and group-based authorization. Changing or removing a group there takes
  effect at the next Cloudflare Access sign-in.
- A signed-in user's display name and phone number re-sync from the provider on every sign-in. A superadmin's own manual edit to either field in Users and Roles Administration takes priority and is not overwritten by a later sign-in.
- The system prevents removal of the last active instance Superadmin assignment.
- Enabling Cloudflare Access with incorrect audience or path values can block staff access.
- Secrets are never displayed again after saving.

## What changes after this action

Enabled providers appear in the staff sign-in flow. Updated mappings apply when affected users sign in again. Display name and phone number changes made at the identity provider also apply the next time the affected user signs in. Access enforcement applies to configured paths after it is enabled.

## Common problems

- **Discovery fails:** verify the HTTPS issuer and provider availability. For a LAN IdP, confirm
  the hostname or IP literal is on `SSO_PRIVATE_DESTINATION_ALLOWLIST` (app). When using a
  hostname, also confirm that Docker DNS resolves it.
- **Sign-in works but the role is wrong:** check the groups claim and every mapping.
- **Sign-in redirects to an error at the identity provider ("redirect URI mismatch" or similar):** the callback registered at the provider must exactly match the **Redirect URI** shown in the provider editor (Instance URL + `/api/auth/oidc/<provider-id>/callback`). Check for a trailing slash, `http` vs `https`, or the wrong provider id. If Redirect URI is missing in the editor, set Instance URL under Organisation settings → General first. On the Add provider form, the URI appears only after the first save (the pattern is shown as a hint before then).
- **Issuer rejected as private / link-local:** production blocks private destinations unless the exact hostname or IP literal is listed in `SSO_PRIVATE_DESTINATION_ALLOWLIST`. This is separate from the mail allowlist.
- **Cloudflare test fails:** check the team URL and audience without copying tokens into support messages.
- **Cloudflare sign-in fails with "Forbidden," or lands a staff member on Admitto's own sign-in screen instead of straight into the panel:** see [Cloudflare Access - Identity Linking](Cloudflare-Access-Identity-Linking)'s Common problems list, which maps each specific denial reason from System logs to its cause.
- **The change risks lockout:** stop and use the separate Superadmin session to restore the last known working configuration.

## Related pages

- [Cloudflare Access - Identity Linking](Cloudflare-Access-Identity-Linking) - the identity-linking layer in full detail, with troubleshooting
- [Users and Roles Administration](Users-and-Roles-Administration)
- [Organisation Settings](Organisation-Settings)
- [Logs and Audit](Logs-and-Audit)
- [Technical Documentation](Technical-Documentation)
- [My Account](My-Account) — staff self-service: once a provider is enabled here, each account connects or unlinks it for themselves from **My account**, without needing this page.
