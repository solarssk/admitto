# Wallet provider integration

Admitto issues Apple/Google Wallet passes through a single interface, `WalletPassProvider`
(`packages/wallet/src/provider.ts`). Pass creation, update, void, restore, delete, and status
lookup all go through it - resolved via `resolveWalletProvider()`, never a concrete provider
imported directly. PassCreator is today's only implementation. Three things don't go through it yet
- see "Seams that bypass the interface" below; a new provider needs to account for all three, not
just implement the interface.

## Why this boundary exists

Admitto is always the source of truth for check-in, tokens, and attendance. A wallet provider is
presentation and delivery only - it never gates check-in, and Admitto can rebuild pass state from
its own database (`WalletPass.provider_pass_id` / `user_provided_id` plus the stored `apple_url` /
`android_url`) if the provider is ever unavailable. Only pass-relevant
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
- **`capabilities` are declarative; only `remoteDelete` is enforced today.** Google Wallet's Event
  Ticket API has no delete method for objects and an issuer cannot remove a pass from a user's
  Apple Wallet, so the Remove from provider routes check `remoteDelete` instead of assuming every
  provider is PassCreator. The other flags (`lifecycleObservation`, `expiration`, `voidRestore`,
  `registrationSnapshot`) describe a provider but no caller checks them yet, so a future provider
  that sets one to `false` must also wire the matching check. The static table is
  `@admitto/wallet/capabilities` (safe to import from `apps/admin`, but nothing imports it yet).
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
  between makes it a quiet no-op. It is also ordered: `WalletPass.lifecycle_observed_at` - a column
  with exactly one writer, this function - is the moment the snapshot was *observed*, and the write
  only lands while the stored value is STRICTLY older (`<`, not `<=`, so two reads tied at the same
  millisecond can't have the second one overwrite the first). `registration_checked_at` is NOT this
  marker: it's stamped with write-completion time and is also written by a plain registration
  webhook, which carries no observation at all - using it for ordering is exactly the bug this
  column exists to avoid re-introducing. An older read can never overwrite a newer one this way (a
  stale "voided" would otherwise stick, since nothing polls a voided pass to correct it). A pass
  that turns voided/expired keeps the counts of that read; nothing polls it afterwards. The
  periodic sync and Refresh status only read `active` passes (sync also skips archived events).
  Refresh status applies the same reconciliation (it can move a pass to `voided`/`expired`) but
  changes nothing at the provider, so it ignores the wallet master switch and the archived guard.
- **A webhook is a signal, not a state.** `pass_voided` re-reads the pass through the same
  reconciliation. 200 means dealt with (including "not ours" and "already inactive"); 503 means the
  re-read could not be completed (provider error, or a no-match that survived the retry), so
  PassCreator redelivers. So does a report the provider genuinely gives as voided but that falls
  inside the consistency window right after Admitto's own last Void/Restore
  (`suppressedByRecentCommand`): it might be a stale search-index read of the state from before
  that command, or a second, real void landing in the same window, and the two are indistinguishable
  from timestamps alone - so it is answered like an inconclusive read rather than acknowledged,
  which would otherwise lose a real void forever on an archived or switched-off event. Registration
  webhooks only ever update counts. `expired` is irreversible - the public Add-to-Wallet flow
  never tries to recreate or recover it (that would have PassCreator's own duplicate-rejection
  recover into a false "active" without ever clearing the provider-side expiration), and the admin
  UI offers only Delete wallet pass and Remove from provider for it, never Restore. The receiver resolves the
  provider from the event's credentials alone, not the wallet master switch: switching Wallet off
  does not unsubscribe the hooks, so deliveries for existing passes keep arriving. A "suppressed"
  outcome still wrote the registration counts, so a caller that only reports on those (a bulk
  selection, the event-wide job) counts it as refreshed, not skipped - only the webhook path treats
  it as retryable.
- **"Remove from provider" deletes the remote pass and keeps the local row.** Only a `voided` or
  `expired` pass can be removed. After a successful `deletePass`, `WalletPass.provider_removed_at`
  is stamped and the row keeps its status, history and Reports numbers as a frozen last-known
  snapshot. A removed pass is never synced again (the sync candidate index excludes it), Restore and
  Push updates answer 409 `wallet_pass_removed`, and the webhook receiver acks its deliveries with
  200 before any provider call or write. The event-wide jobs use the same path: **Void active
  passes** (`wallet_void_active`) and **Remove inactive passes** (`wallet_remove_inactive`), the
  latter only for passes voided or expired for at least a day (`WALLET_REMOVE_INACTIVE_GRACE_MS`).
  Delete wallet pass is the different action that also deletes the local row.
- **Expiration is Admitto's own date, not something read from the provider.** With Event Settings →
  Wallet → Pass expiration set to "Expire when the event ends", every created or updated pass gets
  `WalletPass.expires_at` (the event's end, from `eventEndsAtUtc`) and the provider receives it as
  `expirationDate`, a "Y-m-d H:i" wall-clock string with no time zone that the provider reads in
  its own account time zone. It only works if the template has "different for each pass" switched
  on; `describeTemplate()` reports that as `perPassExpirationReady`, and the mode cannot be turned
  on unless the check passes. Changing the Template ID or API key while the mode is on runs the same
  check against the new values and answers 409 `wallet_expiration_mode_not_supported` when it fails.
  Turning it off is blocked once any pass has been issued, since there is no confirmed way to clear
  an already-sent date. The worker's `wallet_expire` job then marks a due pass `expired` locally,
  without contacting the provider, once the event's own end has also passed: `runWalletExpiry`
  (`packages/wallet/src/expire-passes.ts`) locks the event row, re-reads its end time and updates the
  passes in one transaction, so an end time moved later at that moment cannot slip through.
- **The template is fixed once passes exist.** A provider scopes a pass lookup to one template, so
  once any pass has been issued for an event, changing the Template ID answers 409
  `wallet_template_locked` (checked under the per-event advisory lock issuance takes). The API key
  can still be rotated; it is verified against the unchanged template first.
- **Restore closes.** Restore answers 409 `wallet_restore_closed` once the event has ended or is
  archived, and 409 `wallet_restore_expired` once `WalletPass.expires_at` has passed, whatever the
  UI showed.
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
  provider-controlled fields (`templateId`, barcode/QR value, `userProvidedId`, `enforceUniqueUserProvidedId`,
  `relevantDate` for Lock Screen surfacing - Apple-only, when the event has a start time - and, when
  Pass expiration is on, `expirationDate`) reaches a provider until an admin explicitly maps the
  rest in Event Settings → Wallet's Field mapping.
- **No gating authority.** A webhook or callback from your service is a signal Admitto reconciles
  against its own state - never a source of truth for check-in eligibility.

## Seams that bypass the interface

Three things a PassCreator-only implementation currently handles outside `WalletPassProvider` - a
second provider needs its own answer for all of them, since implementing the interface alone won't
cover them:

- **Test connection and webhook subscription management.** `apps/web/src/admin/event-settings-routes.ts`
  imports and constructs `PassCreatorClient` directly (not through `resolveWalletProvider()`) for
  the Wallet tab's "Test connection" action and for registering/clearing PassCreator's own webhook
  subscriptions. `WalletPassProvider` has no method for either of these today.
- **The inbound webhook receiver.** `packages/wallet/src/passcreator-webhook.ts` parses PassCreator's
  payload shape and verifies its signature scheme (`parseWebhookEnvelope`, `parseWebhookData`,
  `verifyWebhookSignature`, `PassCreatorWebhookData`), and `apps/web/src/wallet-webhook.ts` is the
  handler. Both are PassCreator-specific: there are three routes
  (`/api/wallet/webhook/passcreator/:eventId`, `.../voided` and `.../first-confirmed`), and the
  provider must expose `getWebhookPublicKey()` (checked by duck typing, it is not part of
  `WalletPassProvider`). A second provider that also delivers device-registration/void events via
  webhook needs its own receiver route and payload parsing - there's no generic inbound webhook
  abstraction to plug into.
- **Provider selection.** Nothing chooses a provider today. `resolveConfiguredWalletProvider`
  (`packages/wallet/src/resolve-provider.ts`) always builds a `PassCreatorClient` from the event's
  `wallet_template_id`, `wallet_api_key_enc` and `wallet_field_mapping`, the Wallet tab is
  PassCreator-shaped, and `walletProviderCapabilities()` only lists `passcreator`.
  `WalletPass.provider` is stored (default `passcreator`) but not used to route. A second provider
  needs a selection mechanism (a per-event provider setting), its own credentials storage and a
  capabilities entry.

## What's out of scope

Certificates, signing keys, and platform developer-account setup (an Apple Pass Type ID, a Google
Wallet issuer account, etc.) are the provider implementation's own concern. Admitto's domain
boundary starts at the interface above, not at how a provider gets a pass onto a device.

## Reference implementation

`packages/wallet/src/passcreator-client.ts` implements this interface against PassCreator's HTTP
API. Read it alongside [packages/wallet/README.md](../../packages/wallet/README.md) - full
architecture, PassCreator's actual API surface, and the webhook trust model - as a worked example
of what implementing this interface looks like in practice.
