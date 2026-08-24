# Integrating with Admitto

Admitto is self-hosted — there is no public plugin API or marketplace. Extension happens at
specific points in the codebase: an interface most of the app depends on, rather than a concrete
implementation directly. This folder documents those extension points for a developer or
integrator company that wants Admitto to support their own service.

## Extension points today

| What | Interface | Package | Status |
|---|---|---|---|
| Wallet pass delivery (Apple/Google Wallet) | `WalletPassProvider` | `packages/wallet` | PassCreator implemented (production), but see [wallet-provider.md](wallet-provider.md) for two call sites that bypass the interface today. |
| Outbound email delivery | `MailerAdapter` | `packages/mailer` | Power Automate + SMTP implemented (production), Graph built but not live-tested. See [packages/mailer/README.md](../../packages/mailer/README.md). |
| Identity / SSO | any OIDC-compliant provider that accepts a client secret in the token request body (`client_secret_post`) | `packages/auth` | Configuration, not code — no code to implement. An issuer that requires `client_secret_basic` or `private_key_jwt` isn't supported yet (`packages/auth/src/oidc/token.ts` always sends the secret as a body parameter). |

Not listed here means it isn't currently an extension point — either hard-coded or not yet
abstracted behind an interface. If you need Admitto to plug into something else, talk to us before
writing code against internals; there's nothing stopping you, but there's also no contract that
internal code won't change under you.

## Adding a new implementation

1. Read the interface and its domain types in the package above — the source code is the source
   of truth, this folder is a guide to it, not a replacement for it.
2. Implement the interface. Read the current production implementation (PassCreator for wallet,
   Power Automate/SMTP for mail) as a worked example of the contract in practice.
3. Check for call sites that bypass the interface for the extension point you're touching (see
   [wallet-provider.md](wallet-provider.md) for wallet's) — implementing the interface alone isn't
   always the whole story yet.
4. Wire it in behind existing configuration (env var / admin UI), the same way the current
   implementation is selected — never a new code path that bypasses the interface.
5. Tests: there's no reusable, parameterized contract suite you can run a new implementation
   through yet — the existing tests are written against the current implementation specifically
   (mocked PassCreator/Power Automate responses, not "any provider"). Write new tests covering the
   same behavioral expectations (idempotency, error codes, etc.) called out in
   [wallet-provider.md](wallet-provider.md) instead of assuming the existing suite already does.

This is not an SDK release — there's no versioned package, changelog, or support commitment for
external implementations. The interfaces above are Admitto's own internal domain boundary,
documented here for anyone who needs to build against them.
