# Wallet provider integration

Admitto issues Apple and Google Wallet passes through a single interface, `WalletPassProvider` (`packages/wallet/src/provider.ts`).

- Pass creation, update, void, restore, delete and status lookup all go through it.
- The provider is resolved via `resolveWalletProvider()`. A concrete provider is never imported directly.
- PassCreator is today's only implementation.
- Three things don't go through the interface yet (see "Seams that bypass the interface" below). A new provider needs to account for all three, not just implement the interface.

## Why this boundary exists

- Admitto is always the source of truth for check-in, tokens and attendance.
- A wallet provider is presentation and delivery only. It never gates check-in.
- Admitto can rebuild pass state from its own database if the provider is ever unavailable. It uses `WalletPass.provider_pass_id` / `user_provided_id` plus the stored `apple_url` / `android_url`.
- Only pass-relevant fields are sent (data minimization). See [packages/wallet/README.md](../../packages/wallet/README.md) for the full architecture and the exact fields PassCreator receives today.

## The contract

```ts
interface WalletPassProvider {
  readonly provider: string;
  readonly capabilities: WalletProviderCapabilities;              // what this provider can do at all
  readonly consistencyPolicy: WalletProviderConsistencyPolicy;    // how stale its reads may be after our commands

  createPass(input: WalletPassInput, options?: PassSendOptions): Promise<WalletPassResult>;   // never sends its request later than CREATE_PASS_DEADLINE_MS after options.checkedAt (the call, by default)
  updatePass(providerPassId: string, input: WalletPassInput, options?: PassSendOptions): Promise<WalletPassResult>;   // the same deadline when it is given options.checkedAt, none otherwise
  sendPushMessage(providerPassIds: string[], text: string): Promise<void>;
  voidPass(providerPassId: string): Promise<void>;
  restorePass(providerPassId: string): Promise<void>;
  deletePass(providerPassId: string): Promise<void>;              // idempotent: already-gone = success
  deletePassByUserProvidedId(userProvidedId: string): Promise<boolean>; // for a pass whose own id Admitto never saved: true = deleted, false = none there
  findByUserProvidedId(userProvidedId: string): Promise<WalletPassResult | null>;
  getPassSnapshot(ref: WalletProviderPassRef): Promise<WalletProviderSnapshot | null>;
}
```

Full type shapes (`WalletPassInput`, `WalletPassResult`, `WalletProviderSnapshot`, `WalletProviderError`) live in `packages/wallet/src/types.ts`. Read them alongside this doc, not instead of it.

## Who owns what

Admitto owns a pass's lifecycle (`WalletPass.status`). A provider only *observes* it and *executes* Admitto's commands.

- `getPassSnapshot` returns what the provider currently says about a pass (`validity`, `registrations`, `firstDownloadedAt`). The domain layer decides what that means.
- `validity.voided` alone can't tell an explicit void from an expiry (PassCreator sets it for both).
- A naive expiration timestamp is never given a guessed timezone by the adapter.

The rules below follow from that.

### A `null` snapshot is not proof that the pass is gone

- `null` from `getPassSnapshot` only means that the provider's read side has no such pass right now. (PassCreator's is a search whose index can lag.)
- Only a successful `deletePass` or `deletePassByUserProvidedId` confirms removal. That means 2xx, or 404 for an already-gone pass.

### `capabilities` are declarative, and only `remoteDelete` is enforced today

- Google Wallet's Event Ticket API has no delete method for objects, and an issuer cannot remove a pass from a user's Apple Wallet. So the Remove from provider routes check `remoteDelete` instead of assuming every provider is PassCreator.
- The other flags (`lifecycleObservation`, `expiration`, `voidRestore`, `registrationSnapshot`) describe a provider, but no caller checks them yet. A future provider that sets one to `false` must also wire the matching check.
- The static table is `@admitto/wallet/capabilities`. It is safe to import from `apps/admin`, but nothing imports it yet.

### An observation only ever moves an `active` pass forward

`reconcileWalletPassLifecycle` (`packages/wallet/src/reconcile-lifecycle.ts`) is the one place that decides.

- From `active` (and not removed at the provider), a read that says `voided: true` becomes `voided`. It becomes `expired` when the provider's own expiration is known and already past.
- Nothing an observation says moves a `voided` or `expired` pass anywhere.
- A `voided: false` or missing flag changes nothing. Going back to `active` is the explicit Restore action.
- A naive expiration ("Y-m-d H:i", PassCreator's wire format) is only read in an explicitly configured provider time zone, never guessed. So without one, `voided: true` always means `voided`.

### A read right after Admitto's own command is ignored

- Void and Restore stamp `WalletPass.provider_commanded_at`.
- A read taken within the provider's `consistencyPolicy.observationStalenessWindowMs` of it (PassCreator: 10 minutes, because its search index lags) may still show the state from before the command. So it cannot change the pass.
- This guards against stale reads, not against webhook ordering.

### One write, conditioned on what was read

`applyProviderSnapshotToWalletPass` writes the registration counts and any transition together.

- The write is conditional: `WHERE` the identity and lifecycle state are still what they were before the provider call. So a Void, Restore or delete-and-reissue in between makes it a quiet no-op.
- It is also ordered. `WalletPass.lifecycle_observed_at` is the moment the snapshot was *observed*. It is a column with exactly one writer, this function. The write only lands while the stored value is STRICTLY older (`<`, not `<=`), so two reads tied at the same millisecond can't have the second one overwrite the first.
- `registration_checked_at` is NOT this marker. It is stamped with write-completion time, and it is also written by a plain registration webhook, which carries no observation at all. Using it for ordering is exactly the bug that this column exists to avoid re-introducing.
- An older read can never overwrite a newer one this way. (A stale "voided" would otherwise stick, since nothing polls a voided pass to correct it.)
- A pass that turns voided or expired keeps the counts of that read. Nothing polls it afterwards.
- The periodic sync and Refresh status only read `active` passes. The sync also skips archived events.
- Refresh status applies the same reconciliation (it can move a pass to `voided` or `expired`), but it changes nothing at the provider. So it ignores the wallet master switch and the archived guard.

### A webhook is a signal, not a state

- `pass_voided` re-reads the pass through the same reconciliation.
- **200** means dealt with, including "not ours" and "already inactive".
- **503** means the re-read could not be completed (a provider error, or a no-match that survived the retry), so PassCreator redelivers.
- 503 also answers a report that the provider genuinely gives as voided, but that falls inside the consistency window right after Admitto's own last Void or Restore (`suppressedByRecentCommand`). It might be a stale search-index read of the state from before that command, or a second, real void landing in the same window. The two are indistinguishable from timestamps alone. So it is answered like an inconclusive read rather than acknowledged. Acknowledging it would lose a real void forever on an archived or switched-off event.
- Registration webhooks only ever update counts.
- `expired` is irreversible. The public Add-to-Wallet flow never tries to recreate or recover it, because PassCreator's own duplicate-rejection would recover into a false "active" without ever clearing the provider-side expiration. The admin UI offers only Delete wallet pass and Remove from provider for it, never Restore.
- The receiver resolves the provider from the event's credentials alone, not the wallet master switch. Switching Wallet off does not unsubscribe the hooks, so deliveries for existing passes keep arriving.
- A "suppressed" outcome still wrote the registration counts. So a caller that only reports on those (a bulk selection, the event-wide job) counts it as refreshed, not skipped. Only the webhook path treats it as retryable.

### "Remove from provider" deletes the remote pass and keeps the local row

- Only a `voided` or `expired` pass can be removed.
- After a successful `deletePass`, `WalletPass.provider_removed_at` is stamped. The row keeps its status, history and Reports numbers as a frozen last-known snapshot.
- A removed pass is never synced again (the sync candidate index excludes it). Restore and Push updates answer 409 `wallet_pass_removed`. The webhook receiver acks its deliveries with 200 before any provider call or write.
- The event-wide jobs use the same path:
  - **Void active passes** (`wallet_void_active`)
  - **Remove inactive passes** (`wallet_remove_inactive`), the latter only for passes voided or expired for at least a day (`WALLET_REMOVE_INACTIVE_GRACE_MS`)
- Delete wallet pass is the different action that also deletes the local row.

### Expiration is Admitto's own date, not something read from the provider

- With Event Settings → Wallet → Pass expiration set to "Expire when the event ends", every created or updated pass gets `WalletPass.expires_at` (the event's end, from `eventEndsAtUtc`).
- The provider receives it as `expirationDate`: a "Y-m-d H:i" wall-clock string with no time zone, which the provider reads in its own account time zone.
- It only works if the template has "different for each pass" switched on. `describeTemplate()` reports that as `perPassExpirationReady`, and the mode cannot be turned on unless the check passes.
- Changing the Template ID or API key while the mode is on runs the same check against the new values. It answers 409 `wallet_expiration_mode_not_supported` when the check fails.
- Turning it off is blocked once any pass has been issued, since there is no confirmed way to clear an already-sent date.
- The worker's `wallet_expire` job then marks a due pass `expired` locally, without contacting the provider, once the event's own end has also passed. `runWalletExpiry` (`packages/wallet/src/expire-passes.ts`) locks the event row, re-reads its end time and updates the passes in one transaction, so an end time moved later at that moment cannot slip through.

### The template is fixed once passes exist

- A provider scopes a pass lookup to one template. So once any pass has been issued for an event, changing the Template ID answers 409 `wallet_template_locked`. It is checked under the per-event advisory lock that issuance takes.
- The API key can still be rotated. It is verified against the unchanged template first.

### Restore closes

Restore answers 409 `wallet_restore_closed` once the event has ended or is archived, and 409 `wallet_restore_expired` once `WalletPass.expires_at` has passed, whatever the UI showed.

### "Reset" is a domain concept, not HTTP DELETE

- With `remoteDelete`, it removes the remote pass.
- Without it, a reset must retire the old remote object (void or expire) and issue the next pass under a *new* provider identity (a generation counter mixed into it). Today's stable `userProvidedId` idempotency key would keep pointing at the retired object.
- Nothing implements that yet. No provider needs it.

## What Admitto expects from an implementation

### Idempotency

- `deletePass` on an already-deleted pass must succeed, not throw.
- A retried `createPass` or `updatePass` call for the same `userProvidedId` must not create a duplicate pass.
- `deletePassByUserProvidedId` is for a pass whose own id Admitto never saved (the request that created it could not record it, see [attendee-erasure.md](attendee-erasure.md#a-pass-whose-provider-id-was-never-saved)).
  - It must answer from the provider's own record of the id, not from a search that can lag or is scoped to one template. Then "there is none" (false) is a real answer about that moment. The caller waits out a creation that may still be under way before it marks the pass removed on it.
  - It succeeds for a pass already gone, like `deletePass`.
  - It must delete only a pass whose own userProvidedId is the id asked for. PassCreator's v1 path also matches a pass that has the string as its barcode value or UID, and deleting that one would remove somebody else's pass. So an id that resolves to another pass makes it throw, with nothing deleted.

### A bounded creation

- `createPass` must not send its request later than `CREATE_PASS_DEADLINE_MS` (2 minutes) after the caller's last check that the pass may be made (`options.checkedAt`, in epoch milliseconds; the moment of the call when it is not given).
- That holds whatever it waited for: a pacing queue, a retry backoff, a suspended process. Past that, it throws `wallet_provider_timeout` and nothing of it reaches the provider.
- Erasing an attendee relies on it. A pass that was being made when the person was erased can reach the provider only within that limit plus the request's own timeout. That is why a "no pass under that id" answer can be believed ten minutes after the erasure (see [attendee-erasure.md](attendee-erasure.md#a-pass-whose-provider-id-was-never-saved)).
- The same holds for an `updatePass` that is given `options.checkedAt`. The web app gives it to the update that follows a duplicate rejection, which carries the person's data and comes after searches that can take long. Without it, an update has no deadline.

### Stable error codes, not message strings

- Throw `WalletProviderError` with one of: `wallet_provider_unauthorized`, `_rate_limited`, `_duplicate`, `_not_found`, `_timeout`, `_rejected`.
- Callers branch on `.code`, never on `.message`.
- Error messages must be fixed application text. Classify any provider reply locally, then discard its text, response body and transport exception detail.
- Routine caller logs use `walletFailureCode` and operation, job and event identifiers. Unrecognized codes become `unknown`. Never log the exception object or stack.
- PassCreator keeps the existing duplicate classification, rate-limit backoff, timeout category and idempotent delete-404 behavior.

### Data minimization

- Send only what `WalletPassInput` actually contains. Never reach back into Admitto's database for more.
- Fields are optional for a reason. Nothing beyond the provider-controlled fields reaches a provider until an admin explicitly maps the rest in Event Settings → Wallet's Field mapping.
- The provider-controlled fields are `templateId`, the barcode or QR value, `userProvidedId`, `enforceUniqueUserProvidedId`, `relevantDate` for Lock Screen surfacing (Apple-only, when the event has a start time) and, when Pass expiration is on, `expirationDate`.

### No gating authority

A webhook or callback from your service is a signal that Admitto reconciles against its own state. It is never a source of truth for check-in eligibility.

## Seams that bypass the interface

These are three things that a PassCreator-only implementation currently handles outside `WalletPassProvider`. A second provider needs its own answer for all of them, since implementing the interface alone won't cover them.

1. **Test connection and webhook subscription management.**
   - `apps/web/src/admin/event-settings-routes.ts` imports and constructs `PassCreatorClient` directly, not through `resolveWalletProvider()`. It does so for the Wallet tab's "Test connection" action, and for registering and clearing PassCreator's own webhook subscriptions.
   - `WalletPassProvider` has no method for either of these today.
2. **The inbound webhook receiver.**
   - `packages/wallet/src/passcreator-webhook.ts` parses PassCreator's payload shape and verifies its signature scheme (`parseWebhookEnvelope`, `parseWebhookData`, `verifyWebhookSignature`, `PassCreatorWebhookData`). `apps/web/src/wallet-webhook.ts` is the handler.
   - Both are PassCreator-specific. There are three routes: `/api/wallet/webhook/passcreator/:eventId`, `.../voided` and `.../first-confirmed`.
   - The provider must expose `getWebhookPublicKey()` (checked by duck typing, it is not part of `WalletPassProvider`).
   - A second provider that also delivers device-registration or void events via webhook needs its own receiver route and payload parsing. There's no generic inbound webhook abstraction to plug into.
3. **Provider selection.**
   - Nothing chooses a provider today. `resolveConfiguredWalletProvider` (`packages/wallet/src/resolve-provider.ts`) always builds a `PassCreatorClient` from the event's `wallet_template_id`, `wallet_api_key_enc` and `wallet_field_mapping`.
   - The Wallet tab is PassCreator-shaped, and `walletProviderCapabilities()` only lists `passcreator`.
   - `WalletPass.provider` is stored (default `passcreator`) but not used to route.
   - A second provider needs a selection mechanism (a per-event provider setting), its own credentials storage and a capabilities entry.

## What's out of scope

Certificates, signing keys, and platform developer-account setup (an Apple Pass Type ID, a Google Wallet issuer account, etc.) are the provider implementation's own concern. Admitto's domain boundary starts at the interface above, not at how a provider gets a pass onto a device.

## Reference implementation

`packages/wallet/src/passcreator-client.ts` implements this interface against PassCreator's HTTP API. Read it alongside [packages/wallet/README.md](../../packages/wallet/README.md) as a worked example of what implementing this interface looks like in practice. The README covers the full architecture, PassCreator's actual API surface, and the webhook trust model.
