# Integrating with Admitto

Admitto is self-hosted — there is no public plugin API or marketplace. Extension happens at
specific points in the codebase: an interface the rest of the app depends on, never on a concrete
implementation. This folder documents those extension points for a developer or integrator
company that wants Admitto to support their own service.

## Extension points today

| What | Interface | Package | Status |
|---|---|---|---|
| Wallet pass delivery (Apple/Google Wallet) | `WalletPassProvider` | `packages/wallet` | PassCreator implemented (production). See [wallet-provider.md](wallet-provider.md). |
| Outbound email delivery | `MailerAdapter` | `packages/mailer` | Power Automate + SMTP implemented (production), Graph built but not live-tested. See [packages/mailer/README.md](../../packages/mailer/README.md). |
| Identity / SSO | any OIDC-compliant provider | `packages/auth` | Configuration, not code — any standard OIDC issuer works via Settings → Identity providers. Nothing to implement. |

Not listed here means it isn't currently an extension point — either hard-coded or not yet
abstracted behind an interface. If you need Admitto to plug into something else, talk to us before
writing code against internals; there's nothing stopping you, but there's also no contract that
internal code won't change under you.

## Adding a new implementation

1. Read the interface and its domain types in the package above — the source code is the source
   of truth, this folder is a guide to it, not a replacement for it.
2. Implement the interface. Read the current production implementation (PassCreator for wallet,
   Power Automate/SMTP for mail) as a worked example of the contract in practice.
3. Wire it in behind existing configuration (env var / admin UI), the same way the current
   implementation is selected — never a new code path that bypasses the interface.
4. Tests: the interface's existing test suite doubles as a compliance suite for a new
   implementation — exercise it against the same behavioral expectations (idempotency, error
   codes, etc.) the current implementation is tested against.

This is not an SDK release — there's no versioned package, changelog, or support commitment for
external implementations. The interfaces above are Admitto's own internal domain boundary,
documented here for anyone who needs to build against them.
