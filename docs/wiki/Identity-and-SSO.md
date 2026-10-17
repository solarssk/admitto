# Identity and SSO

**Audience:** Superadmins · **Required role:** Superadmin · **Feature status:** ✅ Available · **Last verified:** Admitto 0.5.2

- [What this page helps you do](#what-this-page-helps-you-do)
  - [Login methods at a glance](#login-methods-at-a-glance)
- [Before you start](#before-you-start)
- [Steps](#steps)
  - [Setting up OIDC (SSO)](#setting-up-oidc-sso)
  - [Setting up Cloudflare Access (ZTNA)](#setting-up-cloudflare-access-ztna)
- [Expected result](#expected-result)
- [Important decisions](#important-decisions)
- [What changes after this action](#what-changes-after-this-action)
- [Common problems](#common-problems)
  - [Provider setup](#provider-setup)
  - [SSO sign-in](#sso-sign-in)
  - [Cloudflare Access](#cloudflare-access)
  - [The Identity tab and its editors](#the-identity-tab-and-its-editors)
- [Related pages](#related-pages)

## What this page helps you do

Configure supported OIDC sign-in and Cloudflare Access from the administration UI.

This page covers two independent, optional layers:

- **OIDC single sign-on (SSO)** connects Admitto to your organisation's identity provider (for example Microsoft Entra ID, Okta, or Authentik). Staff sign in with their existing corporate account instead of a separate Admitto password.
  - The provider's group membership can be mapped to Admitto roles.
  - So adding or removing someone from a group in the identity provider changes what they can do here too.
- **Cloudflare Access** is a zero-trust network access (ZTNA) gateway. It checks a staff member's identity and, optionally, their device before their request is even allowed to reach Admitto.
  - It is a perimeter control, not a replacement for Admitto's own roles.
  - It is a separate layer in front of sign-in, not a replacement for it. See [Cloudflare Access - Identity Linking](Cloudflare-Access-Identity-Linking) for why both are needed.
  - Enable it if your organisation wants staff URLs to be unreachable to anyone who has not already authenticated at the network edge, on top of signing in to Admitto itself.

Both are optional. A deployment can use local passwords only, OIDC only, Cloudflare Access only, or any combination. See [Glossary](Glossary) for short definitions of SSO, OIDC, and ZTNA.

### Login methods at a glance

| Method | What the staff member sees | What you need to set up | Where it's configured |
|---|---|---|---|
| **Local password** | Email + password, plus an authenticator app code (MFA) for roles that require it | Nothing extra. It always works, even if the two options below are also enabled | Built in; no setup |
| **OIDC single sign-on** | A "Sign in with `<your provider>`" button that sends them to your identity provider's own login page | Values from your identity provider (see the field table in step 3 of Setting up OIDC) | **Organisation settings → Identity → OIDC providers** |
| **Cloudflare Access (ZTNA)** | A Cloudflare login/device-check screen *before* they ever see Admitto's own login page | A Cloudflare Zero Trust team and an Access application in front of Admitto's staff URLs | **Organisation settings → Identity → Cloudflare Access**, plus the Cloudflare dashboard |

A local password always keeps working as a fallback, unless the account has no local password set (see **Important decisions**). So enabling OIDC or Cloudflare Access is never an all-or-nothing switch.

## Before you start

- You need a separate Superadmin session available (another browser profile or a break-glass local account), so you can undo a bad mapping without locking yourself out.
- Know your public **Instance URL** (Organisation settings → General, or `BASE_URL`). The OIDC Redirect URI is derived from it after the first provider save.
- If the identity provider is only reachable on a private LAN address (or a hostname that resolves there), allow it first:
  - Set `SSO_PRIVATE_DESTINATION_ALLOWLIST` on the **app** container to that exact hostname or IP.
  - Do this before **Discover**, **Test** and sign-in can succeed in production.
  - One allowlist covers every SSO provider that uses those hosts (OIDC today; the same variable is intended for future SAML).
  - HTTPS is still required.
- Have an approved test account and the identity provider values, supplied through a secure channel.

> [!CAUTION]
> Keep the separate Superadmin session open while testing identity or Cloudflare Access changes. An incorrect configuration can block staff access.

## Steps

### Setting up OIDC (SSO)

1. Open **Organisation settings**, then **Identity**.
2. Add a new OIDC provider.
3. Fill in the form. Every field is something you copy from your identity provider's own admin console (Entra ID calls it an "App registration"; Okta and Authentik call it an "Application"):

   | Field in Admitto | What it is | Example |
   |---|---|---|
   | Display name | The name shown on the "Sign in with…" button | `Contoso SSO` |
   | Issuer URL | Your identity provider's base URL (see the first note under this table) | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
   | Client ID | The application/client ID your identity provider assigned when you registered Admitto there | `1a2b3c4d-...` |
   | Client secret | The client secret your identity provider generated for that same registration | *(paste once; never shown again)* |
   | Authorization / Token / JWKS / UserInfo endpoints | Usually filled automatically by **Discover** (step 7) from the Issuer URL. Fill by hand only if your provider doesn't support discovery | |
   | Email / Name / Given name / Family name / Phone / Groups claims | Which field in the token holds each piece of information. Most providers use sensible defaults; adjust only if your provider names them differently | `email`, `name`, `groups` |

   - **Issuer URL:** use the base URL, **not** the `/.well-known/openid-configuration` discovery document that some providers show you. Pasting that full URL is a common mistake. Admitto accepts and corrects it automatically, but the bare URL is what's actually stored.
   - **Given name and Family name** are only used if the provider doesn't send one combined name field.
   - **Phone** is optional and only takes effect if your provider actually sends one.

4. **Save once**, so Admitto assigns a provider id. The Redirect URI is not shown until after this first save.
5. On the edit form, copy the read-only **Redirect URI** from the Basics card. Register that exact value at your identity provider (Entra App registration, Okta or Authentik Application). It is the same URL Admitto sends to the identity provider. The pattern is:

   ```
   https://<your-instance-url>/api/auth/oidc/<provider-id>/callback
   ```

   - If the Redirect URI is missing in the editor, set **Instance URL** under Organisation settings → General (or `BASE_URL` in the environment) first.
   - You can save with a placeholder Client ID and secret, register the callback, then paste the real credentials.

6. If your identity provider validates post-logout redirect targets (most do), also register `https://<your-instance-url>/login` there, alongside the callback URI.
   - Admitto's **Log out** redirects through the identity provider's own logout when it advertises one via discovery, then back to that address.
   - Without this registration, the provider refuses the redirect, and the user lands on a provider-side error instead of back at Admitto.
7. Use **Discover** (fills the endpoint fields automatically from the Issuer URL) and **Test connection** before finishing configuration.
8. Configure group-to-role mappings, but only after confirming the provider's group claim. This is what turns "member of the `IT-Admins` group in Entra ID" into "Superadmin in Admitto".

   Each role always applies at one fixed level, shown next to it and not separately chosen:

   - **Superadmin** is instance-wide.
   - **Admin** picks an Organisation.
   - **Operator** picks an Event.

   Organisations and Events are chosen from a searchable list rather than a typed ID.

9. Save the provider and test sign-in with a non-critical account. Use the separate Superadmin session mentioned above for this, not the one you are using to configure the provider.

### Setting up Cloudflare Access (ZTNA)

Do this in Cloudflare's own dashboard first, then in Admitto:

1. First configure and enable the direct OIDC provider in Admitto. It remains the authoritative identity and role source. Cloudflare Access is the edge gate, not a second staff directory.
2. In **Cloudflare Zero Trust**, create an **Access application** that protects your Admitto staff URLs (for example `admin.example.com/*`).
   - Set the policy for who's allowed through (by email domain, group, or identity provider).
   - Copy the application's **team domain** (looks like `https://yourteam.cloudflareaccess.com`).
   - Copy the **Application Audience (AUD) tag**, a long hex string Cloudflare shows on the application's Overview tab.
3. Bind Cloudflare sign-ins to the direct provider account from step 1, instead of a second, untrusted identity. This is required, not optional.
   - See [Cloudflare Access - Identity Linking](Cloudflare-Access-Identity-Linking) for the exact custom claim Cloudflare must forward, the identity-provider-side mapping and stable-identifier requirement, and a full troubleshooting list.
   - The **Direct identity provider** field in step 4 below has no effect until this is done.
   - Every staff account that will sign in through Cloudflare must also sign in through the direct provider once first. That first sign-in creates the link Admitto trusts later.
4. In Admitto, open **Organisation settings → Identity → Cloudflare Access** and fill in:

   | Field in Admitto | What it is | Example |
   |---|---|---|
   | Cloudflare team URL | Your Zero Trust team domain | `https://yourteam.cloudflareaccess.com` |
   | Application token (AUD) | The Application Audience tag from Cloudflare | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
   | Protected URL paths | Which paths this rule applies to, comma-separated | `/admin, /api/admin, /api/checkin` |
   | Direct identity provider | The enabled direct OIDC provider from step 1, linked per step 3 | `Corporate OIDC` |

5. Use **Test connection** and confirm it succeeds. Only then enable enforcement.
   - Test in a private browser window.
   - After Cloudflare has authenticated the staff member, Admitto should enter as the already linked direct-provider account, without showing a second Admitto sign-in screen.

## Expected result

- The test account can sign in through the configured provider and receives only the roles produced by approved mappings.
- When enabled, Cloudflare Access protects only the configured paths.
- Its verified edge sign-ins bind to the same pre-linked direct-provider account and reconcile that provider's managed group roles on every sign-in.

## Important decisions

- OIDC and local sign-in are separate authentication methods.
- **Unlinking SSO from My account:**
  - An account created automatically on someone's first OIDC sign-in has no local password at all.
  - So unlinking requires proving identity first (TOTP, or an existing password).
  - An account with neither cannot unlink itself. It is directed to ask a superadmin.
  - A superadmin can set a new password for it from Users and roles → the account's **Unlink identity provider** action.
- **Signing out ends the session at the identity provider too**, when it advertised a logout endpoint during **Discover**.
  - If it didn't, signing out only ends the local Admitto session.
  - If the provider was configured before logout support existed, re-run **Discover** to pick it up.
- **A group mapping can add or remove scoped roles** on later sign-ins. Manual assignments are not treated as provider-owned grants.
- **Cloudflare Access verifies the edge session.** The selected direct OIDC provider remains the source of account identity and group-based authorization. Changing or removing a group there takes effect at the next Cloudflare Access sign-in.
- **A signed-in user's display name and phone number re-sync from the provider on every sign-in.** A superadmin's own manual edit to either field in Users and Roles Administration takes priority and is not overwritten by a later sign-in.
- The system prevents removal of the last active instance Superadmin assignment.
- Enabling Cloudflare Access with incorrect audience or path values can block staff access.
- Secrets are never displayed again after saving.

## What changes after this action

- Enabled providers appear in the staff sign-in flow.
- Updated mappings apply when affected users sign in again.
- Display name and phone number changes made at the identity provider also apply the next time the affected user signs in.
- Access enforcement applies to configured paths after it is enabled.

## Common problems

- **The change risks lockout:** stop and use the separate Superadmin session to restore the last known working configuration.

### Provider setup

- **Discovery fails:** verify the HTTPS issuer and provider availability.
  - For a LAN IdP, confirm the hostname or IP literal is on `SSO_PRIVATE_DESTINATION_ALLOWLIST` (app).
  - When using a hostname, also confirm that Docker DNS resolves it.
- **Issuer rejected as private / link-local:** production blocks private destinations unless the exact hostname or IP literal is listed in `SSO_PRIVATE_DESTINATION_ALLOWLIST`. This is separate from the mail allowlist.
- **Sign-in redirects to an error at the identity provider ("redirect URI mismatch" or similar):** the callback registered at the provider must exactly match the **Redirect URI** shown in the provider editor (Instance URL + `/api/auth/oidc/<provider-id>/callback`).
  - Check for a trailing slash, `http` vs `https`, or the wrong provider id.
  - If the Redirect URI is missing in the editor, set Instance URL under Organisation settings → General first.
  - On the Add provider form, the URI appears only after the first save (the pattern is shown as a hint before then).

### SSO sign-in

- **Sign-in works but the role is wrong:** check the groups claim and every mapping.
- **Sign-in can fail right after your identity provider changed its signing key:** the app container log shows `no applicable key found in the JSON Web Key Set`.
  - Admitto fetches the provider's keys again after a short cooldown, so in a test sign-in worked again after about 35 seconds.
  - No restart is needed.
- **Sign-in with SSO returns to the Admitto sign-in page with an error:** open System logs in [Logs and Audit](Logs-and-Audit) and set the Source filter to Security.
  - Read the newest `oidc_..._failed` entry. Its `reason` says what refused the sign-in. The table under this list explains each one.
  - An entry without a `reason` was caused by an error, for example a refused ID token (see the next item).
  - The server log line that starts with the same step, such as `OIDC token validation:`, carries its message.
- **Sign-in is refused after the provider signed the person in, and the server log shows `OIDC token validation:` followed by a claim name:** the ID token must meet these requirements.
  - It must carry `iss`, `aud`, `sub`, `iat` and `exp`, and repeat the nonce Admitto sent.
  - A token issued for several audiences must also carry `azp`.
  - Any `azp` must be Admitto's client ID.
  - A provider that leaves one of these out is refused.

The `reason` of a refused SSO sign-in in System logs (Source: Security):

| `reason` | What it means | What to do |
|---|---|---|
| `missing code or state` | The provider sent the person back without a sign-in code, for example after they cancelled there. | Start again from the Admitto sign-in page. |
| `oidc flow cookie mismatch` | The sign-in was finished in another browser than the one that started it, or the browser blocked the cookie. | Finish the sign-in in the browser that started it and allow cookies for Admitto. |
| `invalid or replayed state` | The sign-in link was already used, took too long or was repeated. | Start again from the Admitto sign-in page and do not reload the page the provider returned to. |
| `provider missing or disabled` | The provider was disabled or deleted while the sign-in was under way. | Check that the provider is enabled on the Identity tab. |
| `email_already_exists` | A local account already uses the e-mail address the provider sent, and Admitto does not link it automatically. | Sign in with that local account and connect the provider from [My Account](My-Account). |
| `subject_already_linked` | That provider account is already linked to another Admitto account. | Unlink it from the other account in [My Account](My-Account), or link a different provider account. |
| `user_inactive` | The Admitto account linked to the provider account is deactivated. | Reactivate it in [Users and Roles Administration](Users-and-Roles-Administration). |
| `link ...` (several) | The account-linking page was left open too long, or the Admitto session changed while linking. | Start linking again from [My Account](My-Account). |

### Cloudflare Access

- **Cloudflare test fails:** check the team URL and audience without copying tokens into support messages.
- **Cloudflare sign-in shows a generic access-denied page** (for example "You signed in through Cloudflare Access, but this account has no admin access."), **or lands a staff member on Admitto's own sign-in screen instead of straight into the panel:** see the Common problems list in [Cloudflare Access - Identity Linking](Cloudflare-Access-Identity-Linking). It maps each specific denial reason from System logs to its cause.

### The Identity tab and its editors

- **The Identity tab or an editor shows grey rows, or says "Taking longer than usual":** the providers, the Cloudflare Access settings or the provider being edited are being read from the server.
  - Wait a moment and check your connection.
  - After 30 seconds it stops waiting and shows an error with a **Retry** button. The button stays on screen, busy, until the answer is in.
- **A group mapping shows only "Event" or "Organization" instead of a name:** the Event and Organization pickers are read when a mapping needs them.
  - If either could not be loaded, a line under the mappings says so, with its own **Retry** (one line for events and one for organizations).
  - The saved scope shows as "Event" or "Organization" until the names are known.

## Related pages

- [Cloudflare Access - Identity Linking](Cloudflare-Access-Identity-Linking) - the identity-linking layer in full detail, with troubleshooting
- [Users and Roles Administration](Users-and-Roles-Administration)
- [Organisation Settings](Organisation-Settings)
- [Logs and Audit](Logs-and-Audit)
- [Technical Documentation](Technical-Documentation)
- [My Account](My-Account) - staff self-service: once a provider is enabled here, each account connects or unlinks it for themselves from **My account**, without needing this page.
