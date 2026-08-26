# Wallet provider integration

Admitto issues Apple/Google Wallet passes through a single interface, `WalletPassProvider`
(`packages/wallet/src/provider.ts`). Pass creation, update, void, restore, delete, and status
lookup all go through it — resolved via `resolveWalletProvider()`, never a concrete provider
imported directly. PassCreator is today's only implementation. Two things don't go through it yet
— see "Seams that bypass the interface" below; a new provider needs to account for both, not just
implement the interface.

## Why this boundary exists

Admitto is always the source of truth for check-in, tokens, and attendance. A wallet provider is
presentation and delivery only — it never gates check-in, and Admitto can rebuild pass state from
its own database (`passId` + wallet URLs) if the provider is ever unavailable. Only pass-relevant
fields are sent (data minimization) — see [packages/wallet/README.md](../../packages/wallet/README.md)
for the full architecture and the exact fields PassCreator receives today.

## The contract

```ts
interface WalletPassProvider {
  readonly provider: string;

  createPass(input: WalletPassInput): Promise<WalletPassResult>;
  updatePass(providerPassId: string, input: WalletPassInput): Promise<WalletPassResult>;
  sendPushMessage(providerPassIds: string[], text: string): Promise<void>;
  voidPass(passUid: string): Promise<void>;
  restorePass(passUid: string): Promise<void>;
  deletePass(providerPassId: string): Promise<void>;              // idempotent: already-gone = success
  findByUserProvidedId(userProvidedId: string): Promise<WalletPassResult | null>;
  getRegistrationStatus(userProvidedId: string): Promise<WalletPassRegistrationStatus | null>;
}
```

Full type shapes (`WalletPassInput`, `WalletPassResult`, `WalletProviderError`) live in
`packages/wallet/src/types.ts` — read them alongside this doc, not instead of it.

## What Admitto expects from an implementation

- **Idempotency.** `deletePass` on an already-deleted pass must succeed, not throw. A retried
  `createPass`/`updatePass` call for the same `userProvidedId` must not create a duplicate pass.
- **Stable error codes, not message strings.** Throw `WalletProviderError` with one of:
  `wallet_provider_unauthorized`, `_rate_limited`, `_duplicate`, `_not_found`, `_timeout`,
  `_rejected`. Callers branch on `.code`, never on `.message`.
- **Data minimization.** Send only what `WalletPassInput` actually contains — never reach back
  into Admitto's database for more. Fields are optional for a reason: nothing beyond the
  provider-controlled identity fields (barcode/QR value, `userProvidedId`, and — Apple-only, when
  the event has a start time — `relevantDate` for Lock Screen surfacing) reaches a provider until
  an admin explicitly maps the rest in Event Settings → Wallet's Field mapping.
- **No gating authority.** A webhook or callback from your service is a signal Admitto reconciles
  against its own state — never a source of truth for check-in eligibility.

## Seams that bypass the interface

Two things a PassCreator-only implementation currently handles outside `WalletPassProvider` — a
second provider needs its own answer for both, since implementing the interface alone won't cover
them:

- **Test connection and webhook subscription management.** `apps/web/src/admin/event-settings-routes.ts`
  imports and constructs `PassCreatorClient` directly (not through `resolveWalletProvider()`) for
  the Wallet tab's "Test connection" action and for registering/clearing PassCreator's own webhook
  subscriptions. `WalletPassProvider` has no method for either of these today.
- **The inbound webhook receiver.** `apps/web/src/wallet-webhook.ts` parses PassCreator's specific
  webhook payload shape and signature scheme (`PassCreatorWebhookData`, `verifyWebhookSignature`),
  and the route itself is PassCreator-specific (`/api/wallet/webhook/passcreator/:eventId`). A
  second provider that also delivers device-registration/void events via webhook needs its own
  receiver route and payload parsing - there's no generic inbound webhook abstraction to plug into.

## What's out of scope

Certificates, signing keys, and platform developer-account setup (an Apple Pass Type ID, a Google
Wallet issuer account, etc.) are the provider implementation's own concern. Admitto's domain
boundary starts at the interface above, not at how a provider gets a pass onto a device.

## Reference implementation

`packages/wallet/src/passcreator-client.ts` implements this interface against PassCreator's HTTP
API. Read it alongside [packages/wallet/README.md](../../packages/wallet/README.md) — full
architecture, PassCreator's actual API surface, and the webhook trust model — as a worked example
of what implementing this interface looks like in practice.
