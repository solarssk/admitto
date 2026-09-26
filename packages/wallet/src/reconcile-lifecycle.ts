import { zonedWallClockToUtcIso } from "@admitto/shared";
import type { WalletProviderConsistencyPolicy, WalletProviderValidity } from "./types.js";

/** What Admitto knows about a pass's own lifecycle right now - the slice of WalletPass the
 * reconciliation below decides from. */
export type WalletPassLifecycleState = {
  status: string;
  /** Last time Admitto sent the provider a command that changes validity (Void, Restore). */
  provider_commanded_at: Date | null;
  /** Set once the remote resource has been deleted at the provider. */
  provider_removed_at: Date | null;
};

export type ReconcileWalletPassLifecycleInput = {
  current: WalletPassLifecycleState;
  /** What the provider reported on this read. An observation, not a state to copy. */
  validity: WalletProviderValidity;
  /** When that read happened (WalletProviderSnapshot.observedAt). */
  observedAt: Date;
  policy: WalletProviderConsistencyPolicy;
  /** IANA zone the provider's naive timestamps are written in (PassCreator: the company
   * settings' time zone), or null when it is not configured - a naive timestamp is then never
   * interpreted. */
  providerTimeZone: string | null;
};

/** PassCreator's "Y-m-d H:i": local wall-clock digits, no offset. Split into fixed-width pieces by
 * hand (a date, one space, then "HH:mm" with optional ":ss"): one regex with an optional seconds
 * group trips the repo's unsafe-regex lint rule, and a bounded scan is just as clear. */
const NAIVE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAIVE_TIME_RE = /^(\d{2}):(\d{2})$/;
const NAIVE_SECONDS_RE = /^\d{2}$/;

/** A naive "Y-m-d H:i" (seconds optional) read in `timeZone`, as an instant - null for anything
 * malformed, an impossible date/time, or a zone Intl does not know, since a wrong guess here would
 * turn a void into an expiry. */
function naiveWallClockToInstant(raw: string, timeZone: string): Date | null {
  const [datePart, timePart, ...extra] = raw.split(" ");
  if (!datePart || !timePart || extra.length > 0) return null;
  // "HH:mm" or "HH:mm:ss": the seconds, when there, are the fixed last three characters.
  const hasSeconds = timePart.length === 8 && timePart.charAt(5) === ":";
  const date = NAIVE_DATE_RE.exec(datePart);
  const time = NAIVE_TIME_RE.exec(hasSeconds ? timePart.slice(0, 5) : timePart);
  const seconds = hasSeconds ? timePart.slice(6) : "00";
  if (!date || !time || !NAIVE_SECONDS_RE.test(seconds)) return null;
  const [, year, month, day] = date;
  const [, hour, minute] = time;
  const asUtc = new Date(`${year}-${month}-${day}T${hour}:${minute}:${seconds}Z`);
  // new Date() rolls an impossible calendar date over instead of failing ("2026-02-30" becomes
  // March 2nd), so the digits must survive a round trip.
  if (
    Number.isNaN(asUtc.getTime()) ||
    asUtc.getUTCFullYear() !== Number(year) ||
    asUtc.getUTCMonth() !== Number(month) - 1 ||
    asUtc.getUTCDate() !== Number(day) ||
    asUtc.getUTCHours() !== Number(hour) ||
    asUtc.getUTCMinutes() !== Number(minute)
  ) {
    return null;
  }
  try {
    return new Date(zonedWallClockToUtcIso(`${year}-${month}-${day}`, `${hour}:${minute}:${seconds}.000`, timeZone));
  } catch {
    return null;
  }
}

/** The provider's expiration as an instant, when there is enough to say - an adapter-parsed
 * instant (the wire value carried its own offset) wins, otherwise the raw wall-clock value is read
 * in the configured provider zone. Null when neither is possible. */
function providerExpirationInstant(validity: WalletProviderValidity, providerTimeZone: string | null): Date | null {
  if (validity.expiresAt) return validity.expiresAt;
  if (!validity.expirationRaw || !providerTimeZone) return null;
  return naiveWallClockToInstant(validity.expirationRaw, providerTimeZone);
}

/**
 * Decides whether one provider read moves an Admitto pass out of `active` - the only transition an
 * observation is allowed to cause. Returns the next status, or null to leave the pass alone.
 *
 * Admitto owns a pass's validity; the provider is only asked what it currently sees. Hence:
 *
 * - Monotonic. Only `active` (and not removed) can change, and only to `voided` or `expired`. A
 *   voided/expired pass never goes back to `active` because a read said so - that is the explicit
 *   Restore action's job - and a read that says "not voided" is simply not evidence of anything.
 * - Not right after Admitto's own command. Within `observationStalenessWindowMs` of
 *   `provider_commanded_at` the provider may still be serving the state from before that command
 *   (PassCreator's search index lags), so the read is ignored: a Restore must not be undone by a
 *   stale "voided" read of the same pass. This guards against read-after-write staleness, not
 *   against webhook ordering.
 * - `voided: true` means "voided OR expired" for PassCreator, which does not say which. It is read
 *   as `expired` only when the provider's own expiration is known and already past; otherwise it is
 *   `voided`. Without a configured provider zone a naive expiration is not interpreted, so the
 *   answer is `voided`, never a guessed `expired`.
 */
export function reconcileWalletPassLifecycle(input: ReconcileWalletPassLifecycleInput): "voided" | "expired" | null {
  const { current, validity, observedAt, policy, providerTimeZone } = input;
  if (current.status !== "active" || current.provider_removed_at) return null;

  const commandedAt = current.provider_commanded_at;
  if (commandedAt && observedAt.getTime() - commandedAt.getTime() < policy.observationStalenessWindowMs) return null;

  if (validity.voided !== true) return null;

  const expiresAt = providerExpirationInstant(validity, providerTimeZone);
  return expiresAt && expiresAt.getTime() <= observedAt.getTime() ? "expired" : "voided";
}
