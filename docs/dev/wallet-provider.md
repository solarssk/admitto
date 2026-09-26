# Wallet provider integration

Admitto issues Apple/Google Wallet passes through a single interface, `WalletPassProvider`
(`packages/wallet/src/provider.ts`). Pass creation, update, void, restore, delete, and status
lookup all go through it - resolved via `resolveWalletProvider()`, never a concrete provider
imported directly. PassCreator is today's only implementation. Two things don't go through it yet
- see "Seams that bypass the interface" below; a new provider needs to account for both, not just
implement the interface.

## Why this boundary exists

Admitto is always the source of truth for check-in, tokens, and attendance. A wallet provider is
presentation and delivery only - it never gates check-in, and Admitto can rebuild pass state from
its own database (`passId` + wallet URLs) if the provider is ever unavailable. Only pass-relevant
fields are sent (data minimization) - see [packages/wallet/README.md](../../packages/wallet/README.md)
for the full architecture and the exact fields PassCreator receives today.

## The contract

```ts
interface WalletPassProvider {
  readonly provider: string;
  readonly capabilities: WalletProviderCapabilities;              // what this provider can do at all
  readonly consistencyPolicy: WalletProviderConsistencyPolicy;    // how stale its reads may be after our commands

  createPass(input: WalletPassInput): Promise<WalletPassResult>;
  updatePass(providerPassId: string, input: WalletPassInput): Promise<WalletPassResult>;
  sendPushMessage(providerPassIds: string[], text: string): Promise<void>;
  voidPass(providerPassId: string): Promise<void>;
  restorePass(providerPassId: string): Promise<void>;
  deletePass(providerPassId: string): Promise<void>;              // idempotent: already-gone = success
  findByUserProvidedId(userProvidedId: string): Promise<WalletPassResult | null>;
  getPassSnapshot(ref: WalletProviderPassRef): Promise<WalletProviderSnapshot | null>;
}
```

Full type shapes (`WalletPassInput`, `WalletPassResult`, `WalletProviderSnapshot`,
`WalletProviderError`) live in `packages/wallet/src/types.ts` - read them alongside this doc, not
instead of it.

## Who owns what

Admitto owns a pass's lifecycle (`WalletPass.status`); a provider only *observes* it and *executes*
Admitto's commands. `getPassSnapshot` returns what the provider currently says about a pass
(`validity`, `registrations`, `firstDownloadedAt`) and the domain layer decides what that means -
`validity.voided` alone can't tell an explicit void from an expiry (PassCreator sets it for both),
and a naive expiration timestamp is never given a guessed timezone by the adapter.

- **`null` from `getPassSnapshot` is not proof the remote pass is gone.** It only means the
  provider's read side has no such pass right now (PassCreator's is a search whose index can lag).
  Only a successful `deletePass` (2xx, or 404 for an already-gone pass) confirms removal.
- **`capabilities` gate actions.** Callers check them instead of assuming every provider is
  PassCreator: Google Wallet's Event Ticket API has no delete method for objects and an issuer
  cannot remove a pass from a user's Apple Wallet, so `remoteDelete` is a capability, not a given.
  The static table is `@admitto/wallet/capabilities` (safe to import from `apps/admin`).
- **An observation only ever moves an `active` pass forward.** `reconcileWalletPassLifecycle`
  (`packages/wallet/src/reconcile-lifecycle.ts`) is the one place that decides. From `active` (and
  not removed at the provider) a read that says `voided: true` becomes `voided`, or `expired` when
  the provider's own expiration is known and already past. Nothing an observation says moves a
  `voided`/`expired` pass anywhere, and a `voided: false` or missing flag changes nothing: going
  back to `active` is the explicit Restore action. A naive expiration ("Y-m-d H:i", PassCreator's
  wire format) is only read in an explicitly configured provider time zone, never guessed, so
  without one `voided: true` always means `voided`.
- **A read right after Admitto's own command is ignored.** Void and Restore stamp
  `WalletPass.provider_commanded_at`; a read taken within the provider's
  `consistencyPolicy.observationStalenessWindowMs` of it (PassCreator: 10 minutes, its search index
  lags) may still show the state from before the command, so it cannot change the pass. This guards
  against stale reads, not against webhook ordering.
- **One write, conditioned on what was read.** `applyProviderSnapshotToWalletPass` writes the
  registration counts and any transition together, `WHERE` the identity and lifecycle state are
  still what they were before the provider call, so a Void, Restore or delete-and-reissue in
  between makes it a quiet no-op. A pass that turns voided/expired keeps the counts of that read;
  nothing polls it afterwards. The periodic sync and Refresh status only read `active` passes
  (sync also skips archived events); Refresh status is read-only, so it ignores the wallet master
  switch and the archived guard.
- **A webhook is a signal, not a state.** `pass_voided` re-reads the pass through the same
  reconciliation. 200 means dealt with (including "not ours" and "already inactive"); 503 means the
  re-read could not be completed (provider error, or a no-match that survived the retry), so
  PassCreator redelivers. Registration webhooks only ever update counts.
- **"Reset" is a domain concept, not HTTP DELETE.** With `remoteDelete` it removes the remote pass.
  Without it, a reset must retire the old remote object (void/expire) and issue the next pass under
  a *new* provider identity (a generation counter mixed into it), because today's stable
  `userProvidedId` idempotency key would keep pointing at the retired object. Nothing implements
  that yet - no provider needs it.

## What Admitto expects from an implementation

- **Idempotency.** `deletePass` on an already-deleted pass must succeed, not throw. A retried
  `createPass`/`updatePass` call for the same `userProvidedId` must not create a duplicate pass.
- **Stable error codes, not message strings.** Throw `WalletProviderError` with one of:
  `wallet_provider_unauthorized`, `_rate_limited`, `_duplicate`, `_not_found`, `_timeout`,
  `_rejected`. Callers branch on `.code`, never on `.message`.
- **Data minimization.** Send only what `WalletPassInput` actually contains - never reach back
  into Admitto's database for more. Fields are optional for a reason: nothing beyond the
  provider-controlled identity fields (barcode/QR value, `userProvidedId`, and - Apple-only, when
  the event has a start time - `relevantDate` for Lock Screen surfacing) reaches a provider until
  an admin explicitly maps the rest in Event Settings → Wallet's Field mapping.
- **No gating authority.** A webhook or callback from your service is a signal Admitto reconciles
  against its own state - never a source of truth for check-in eligibility.

## Seams that bypass the interface

Two things a PassCreator-only implementation currently handles outside `WalletPassProvider` - a
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
API. Read it alongside [packages/wallet/README.md](../../packages/wallet/README.md) - full
architecture, PassCreator's actual API surface, and the webhook trust model - as a worked example
of what implementing this interface looks like in practice.
