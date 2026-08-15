# Cloudflare Access - Authentik Setup

| Field | Value |
|---|---|
| **Audience** | Superadmins |
| **Required role** | Superadmin |
| **Feature status** | Available |
| **Last verified** | Admitto 0.5.1 |

## What this page helps you do

Bind Cloudflare Access sign-ins to an existing, already-linked Admitto account, so a staff member who has signed in through your direct OIDC provider (for example Authentik) once can pass through Cloudflare Access and land in the admin panel without a second Admitto sign-in screen. This page covers the identity-linking layer specifically. Set up the base Cloudflare Access connection first from [Identity and SSO](Identity-and-SSO).

## Before you start

- Complete both the direct OIDC provider setup and the base Cloudflare Access connection (team URL, audience tag, protected paths) described in [Identity and SSO](Identity-and-SSO) first.
- Keep a way back into Admitto that does not depend on Cloudflare before changing anything here - a break-glass local password session, or network access to the origin that bypasses Cloudflare.
- Confirm exactly which Authentik provider or application Cloudflare authenticates against. If more than one Authentik provider could plausibly be it (for example a separate account-provisioning integration sitting alongside the sign-in one), match it by its **Client ID** in Cloudflare's identity provider settings rather than guessing from a similar-looking name.

> [!CAUTION]
> A wrong claim name or a mismatched subject silently blocks every sign-in through Cloudflare, including your own, with no fallback on the same path once Cloudflare is already enforcing on it. Verify each change in Cloudflare's own identity provider Test result before touching a real sign-in.

## Steps

1. In Authentik, open **Customization → Property Mappings → Create**, choose the OAuth2/OpenID Provider Scope Mapping type, and add an expression that returns a stable identifier, for example:

   ```python
   return {"admitto_identity": request.user.uid}
   ```

   Set **Scope name** to an already-requested scope such as `profile`, not a new name of your own. Cloudflare only receives claims tied to scopes it actually asks for, and by default it already requests `openid`, `profile`, and `email` - inventing a new scope name here means Cloudflare would need separate configuration to ever request it.
2. Open the specific Authentik provider that Cloudflare authenticates against (matched by Client ID, see Before you start) and add the new mapping to its **Selected Scopes**. Creating the mapping in step 1 does not attach it to anything by itself.
3. Confirm the **Subject mode** on that same Authentik provider produces the exact same value as the direct provider already uses for the same person. Authentik's default subject mode is often computed per provider registration, so two separately registered providers can produce two different values for the same human being unless both are deliberately set to the same mode. Do not change the Subject mode of the direct provider if any account has already signed in through it - that orphans its existing links. If both providers are new, "Based on the User's ID" is a safe, stable, non-email choice for both.
4. If the direct provider has group-to-role mappings configured, repeat steps 1-3 for a second, bounded claim carrying only the groups Admitto's mappings actually use (for example `admitto_groups`) - do not forward an entire directory-wide group list.
5. In Cloudflare Zero Trust, open **Integrations → Identity providers**, edit the Authentik entry, and add your claim name(s) from steps 1 and 4 under **OIDC Claims**. This is a different field from **OIDC Scopes** further down the same page: Scopes controls what Cloudflare requests, Claims controls what Cloudflare actually copies into the signed Access JWT it sends to Admitto. Adding a claim name only under Scopes forwards nothing.
6. Click **Test** on that same Cloudflare identity provider page and confirm your claim name (for example `admitto_identity`) appears under `oidc_fields` with a real value, before testing an actual sign-in.
7. Select this direct provider as **Direct identity provider** in Admitto's Cloudflare Access settings (see [Identity and SSO](Identity-and-SSO)) if you have not already, and confirm the account you will test with has signed in through the direct provider at least once - that sign-in is what actually creates the link Cloudflare's assertion will match against.
8. Sign in through the Cloudflare-protected URL in a private/incognito window. You should land directly in the admin panel with no second Admitto sign-in screen.

## Expected result

A staff member already linked to the selected direct provider signs in through Cloudflare Access and enters the admin panel directly. Anyone Cloudflare authenticates who has never signed in through that direct provider is denied, with no account created and no link guessed from their e-mail address.

## Important decisions

- Cloudflare Access only decides whether a request reaches Admitto at all - it never decides which local account or role a person gets. That always comes from an existing, explicit link to the selected direct provider, created the normal way by a real sign-in through that provider. There is no automatic account creation and no linking by e-mail on this path.
- This automatic sign-in applies only to `/admin` and `/api/admin/*`. Admitto's own `/login` page is unrelated to Cloudflare Access and always shows the password form, whether or not Cloudflare also protects that path. Which paths Cloudflare gates at the edge is a separate choice made in the Cloudflare Access application, independent of anything configured in Admitto.
- Protecting `/login` with Cloudflare too stops anyone reaching the password form without first clearing Cloudflare, but removes it as a recovery path if Cloudflare or the identity provider ever has an outage. Decide this deliberately rather than by default.
- Role grants for a Cloudflare sign-in come only from the group claim configured in steps 4-5, never from any group data Cloudflare provides natively.

## What changes after this action

Staff already linked to the selected direct provider skip Admitto's own sign-in screen when arriving through Cloudflare Access. Nobody else gains access through this path, and existing local-password and direct-OIDC sign-in continue to work unchanged.

## Common problems

- **Sign-in through Cloudflare fails with "Forbidden" and no further detail:** open [Logs and Audit](Logs-and-Audit)'s System logs and look for `auth.cf_access` entries - every failed attempt logs a specific `reason`, listed below.
- **`missing_canonical_identity` or `invalid_canonical_identity`:** Cloudflare is not sending a usable claim at all - most often because it was added under OIDC Scopes instead of OIDC Claims (step 5), or because the value looks like an e-mail address, which is rejected on purpose. Re-check step 5 and Cloudflare's own Test result.
- **`source_identity_not_linked`:** the value Cloudflare sent does not match any existing link to the direct provider. Either the account has never signed in through that direct provider yet (step 7), or the two Authentik providers are using different Subject modes for the same person (step 3).
- **`source_provider_not_configured` or `source_provider_unavailable`:** no Direct identity provider is selected in Admitto's Cloudflare Access settings, or the one selected is currently disabled.
- **`source_groups_unavailable`:** the direct provider has group-to-role mappings configured, but this particular sign-in did not carry a usable group claim. Add or fix the group claim the same way as the identity claim (steps 4-5).
- **`source_user_inactive`:** the linked local account is deactivated.
- **`cloudflare_subject_already_linked`:** this Cloudflare identity is already bound to a different local account than the one the claim points to.
- **Everything above looks correct but sign-in still fails the same way:** the browser may still be using a Cloudflare Access session issued before the fix. Sign out of Cloudflare Access itself, not just Admitto, or test from a private window that has never used this Access application before.

## Related pages

- [Identity and SSO](Identity-and-SSO) - base OIDC and Cloudflare Access setup
- [Logs and Audit](Logs-and-Audit) - where to read `auth.cf_access` reason codes
- [Organisation Settings](Organisation-Settings)
