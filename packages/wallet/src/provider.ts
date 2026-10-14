import type {
  WalletPassInput,
  WalletPassResult,
  WalletProviderCapabilities,
  WalletProviderConsistencyPolicy,
  WalletProviderPassRef,
  WalletProviderSnapshot,
} from "./types.js";

/**
 * How long after the caller's last check (see {@link CreatePassOptions}) a `createPass` may still send its request to
 * the provider. A call that has not sent by then (it queued behind other calls in the pacing gate, was retried after a
 * rate limit, or the process was suspended) gives up without sending and fails with `wallet_provider_timeout`.
 * Erasing an attendee relies on it: a pass that was being made when the person was erased can reach the provider only
 * within this limit plus the request's own timeout, so the answer "no pass under that id" is final once the erasure is
 * several times older than that (`CREATION_SETTLE_WINDOW_MS` in `@admitto/tickets`, tied to this value by a test). Two
 * minutes is longer than the 75 s that 500 queued calls take to leave the process at the client's 150 ms spacing, so a
 * call behind such a queue is still sent. A provider's `createPass` must keep to it.
 */
export const CREATE_PASS_DEADLINE_MS = 2 * 60_000;

/** What a caller can tell `createPass` about the time it has. */
export type CreatePassOptions = {
  /** When the caller last confirmed that the pass may be made, in epoch milliseconds (for Admitto: the attendee read as
   * not erased, under their row lock, as the id for the pass was reserved). The call counts {@link CREATE_PASS_DEADLINE_MS}
   * from then, not from the moment it is made, so that a pause in between (a suspended process) cannot stretch it.
   * Defaults to the moment of the call. */
  checkedAt?: number;
};

/**
 * Domain boundary for wallet pass delivery (ADR 0009). The rest of Admitto depends only on this
 * interface — never on a concrete provider (e.g. PassCreator, see ADR 0041).
 *
 * Admitto owns a pass's lifecycle (`WalletPass.status`); a provider only *observes* it
 * (`getPassSnapshot`) and *executes* Admitto's commands (`voidPass`, `restorePass`, `deletePass`).
 * What a provider can do at all is declared in `capabilities`, and how quickly its reads reflect
 * Admitto's own commands in `consistencyPolicy` - callers gate on those, never on which provider
 * they happen to be talking to.
 *
 * "Reset" is a domain concept, not a synonym for HTTP DELETE: with `capabilities.remoteDelete` a
 * reset physically removes the remote pass, without it (Google Wallet has no delete method for
 * event ticket objects, and an issuer cannot remove a pass from a user's Apple Wallet) a reset must
 * retire the old remote object and issue the next pass under a NEW provider identity (a generation
 * counter mixed into it), because today's stable `userProvidedId` idempotency key would keep
 * pointing at the retired object. No provider needs that yet.
 */
export interface WalletPassProvider {
  readonly provider: string;
  readonly capabilities: WalletProviderCapabilities;
  readonly consistencyPolicy: WalletProviderConsistencyPolicy;

  /** Creates the pass. Never sends its request later than {@link CREATE_PASS_DEADLINE_MS} after
   * `options.checkedAt` (the moment of the call when that is not given), whatever it waited for: past that it fails with
   * `wallet_provider_timeout` and nothing reaches the provider. */
  createPass(input: WalletPassInput, options?: CreatePassOptions): Promise<WalletPassResult>;
  updatePass(providerPassId: string, input: WalletPassInput): Promise<WalletPassResult>;
  /** Sends a custom, attendee-visible push notification/message to already-installed passes
   * (e.g. an Apple Wallet lock-screen banner, a Google Wallet notification) - distinct from
   * updatePass, which only silently refreshes field values with no guaranteed visible signal.
   * Only confirms the provider accepted the request, not that every device has received it. */
  sendPushMessage(providerPassIds: string[], text: string): Promise<void>;
  voidPass(providerPassId: string): Promise<void>;
  restorePass(providerPassId: string): Promise<void>;
  /** Permanently removes the pass from the provider (e.g. GDPR/DSAR erasure) - idempotent, a
   * pass that's already gone (404) is treated as success. Only meaningful when
   * `capabilities.remoteDelete`. */
  deletePass(providerPassId: string): Promise<void>;
  /** Permanently removes the pass the provider holds under `userProvidedId`, for one whose own id Admitto
   * never saved (the request that created it could not record it). Unlike `findByUserProvidedId`, the
   * answer comes from the provider's own record of the id, not from a search that can lag or be scoped to
   * one template, so "there is none" is a real answer. Resolves true when a pass was deleted and false
   * when there was none at that moment (already gone, never created, or a creation still under way that
   * has not reached the provider yet): when that is enough to call the pass gone is the caller's call.
   * It deletes only a pass whose own userProvidedId is that id: an id that merely resolves to another pass
   * (PassCreator's path also matches a barcode value) is never deleted, the call throws instead.
   * Only meaningful when `capabilities.remoteDelete`. */
  deletePassByUserProvidedId(userProvidedId: string): Promise<boolean>;
  findByUserProvidedId(userProvidedId: string): Promise<WalletPassResult | null>;
  /** One read of the pass's validity, registrations and first-download time. Polled periodically
   * by the wallet-sync worker job and on demand by the admin "Refresh status" action, not called
   * inline on any other request path.
   *
   * null means only "the provider's read side has no such pass right now" (a search index that
   * lags, a pass deleted at the provider, or never created) - it is NOT proof the remote pass is
   * gone, so no caller may conclude deletion from it. Only a successful delete
   * (`deletePass` 2xx or 404) confirms removal. */
  getPassSnapshot(ref: WalletProviderPassRef): Promise<WalletProviderSnapshot | null>;
}
