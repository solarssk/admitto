# Integrating with Admitto

Admitto is self-hosted. There is no public plugin API or marketplace.

Extension happens at specific points in the codebase: an interface that most of the app depends on, rather than a concrete implementation directly. This folder documents those extension points, for a developer or integrator company that wants Admitto to support their own service.

## Extension points today

| What | Interface | Package | Status |
|---|---|---|---|
| Wallet pass delivery (Apple/Google Wallet) | `WalletPassProvider` | `packages/wallet` | PassCreator implemented (production), but see [wallet-provider.md](wallet-provider.md) for two call sites that bypass the interface today. |
| Outbound email delivery | `MailerAdapter` | `packages/mailer` | Power Automate + SMTP implemented (production), Graph built but not live-tested. See [packages/mailer/README.md](../../packages/mailer/README.md). |
| Identity / SSO | Any OIDC-compliant provider (requirements below) | `packages/auth` | Configuration, not code. There is no code to implement. |

**Identity / SSO requirements**

- The provider must be OIDC-compliant and accept PKCE.
- If a client secret is configured, the provider must take it in the token request body (`client_secret_post`).
- An issuer that requires `client_secret_basic` or `private_key_jwt` isn't supported yet. `packages/auth/src/oidc/token.ts` sends the stored secret only as a body parameter, and none when no secret is stored.

Not listed here means it isn't currently an extension point. It is either hard-coded or not yet abstracted behind an interface. If you need Admitto to plug into something else, talk to us before writing code against internals. There's nothing stopping you, but there's also no contract that internal code won't change under you.

## Adding a new implementation

1. **Read the interface** and its domain types in the package above. The source code is the source of truth. This folder is a guide to it, not a replacement for it.
2. **Implement the interface.** Read the current production implementation (PassCreator for wallet, Power Automate or SMTP for mail) as a worked example of the contract in practice.
3. **Check for call sites that bypass the interface** for the extension point you're touching (see [wallet-provider.md](wallet-provider.md) for wallet's). Implementing the interface alone isn't always the whole story yet.
4. **Wire it in.**
   - **Mail:** add the provider to `MailerProvider` and the zod union in `packages/mailer`, to `createMailer`, `configFromEnv` and the probe. Then add it to `@admitto/mailer-config` (resolver, describer, `MailSettings` columns and a migration), the provider labels in `packages/shared`, the provider enums in `apps/web` (mail settings, health check) and the admin Mail settings UI.
   - **Wallet:** there is no provider selector yet. `resolveConfiguredWalletProvider` always builds PassCreator, so a second provider needs a selection mechanism first (see [wallet-provider.md](wallet-provider.md), Seams).
   - Never add a code path that bypasses the interface.
5. **Write tests.**
   - There's no reusable, parameterized contract suite that you can run a new implementation through yet. The existing tests are written against the current implementation specifically (mocked PassCreator or Power Automate responses, not "any provider").
   - Write new tests covering the same behavioral expectations (idempotency, error codes, etc.) called out in [wallet-provider.md](wallet-provider.md), instead of assuming the existing suite already does.

This is not an SDK release. There's no versioned package, changelog, or support commitment for external implementations. The interfaces above are Admitto's own internal domain boundary, documented here for anyone who needs to build against them.
