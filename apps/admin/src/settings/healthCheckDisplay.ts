import type { HealthCheckRowDto, HealthDetailDto } from "../api/types.js";
import { formatEventDateTime, formatRelativeMagnitude } from "../utils/event-dates.js";
import { formatHealthDetailLabel, formatHealthDetailValue } from "./healthCheckMarkdown.js";

/** Always hidden from the expanded row: `status` and the status circle already say it,
 * `last_checked` is a bookkeeping timestamp with no operator value on its own. */
const ALWAYS_HIDDEN_DETAIL_KEYS = new Set(["status", "last_checked"]);

/** Counts of different sets of events that Wallet passes lists side by side. A number they share
 * with the row's summary ("Configured for 1 event") is coincidence, not repetition, so hiding it
 * would leave a breakdown with a missing line. */
const NEVER_DEDUPED_DETAIL_KEYS = new Set(["wallet_enabled_events", "configured_events", "wallet_incomplete_events"]);

/** `Map`, not a plain object: `reason`/`live_check` are server-controlled today (a closed set
 * of literals), but this module has no way to enforce that stays true, and a plain object's
 * `["__proto__"]`/`["constructor"]` lookup returns a real (truthy) value instead of undefined,
 * which would silently render the wrong thing instead of falling through to the fallback below -
 * the same class of bug `detect-object-injection` already guards against elsewhere in this repo. */
const REASON_SENTENCES = new Map<string, string>([
  ["lookup_failed", "Status could not be read"],
  ["never_ran", "Never ran"],
  ["stale", "Stale"],
  ["not_implemented", "Not implemented"],
  ["unknown_provider", "Unknown provider"],
  ["write_probe_failed", "Write test did not pass"],
  ["not_a_directory", "Not a folder"],
  ["not_writable", "Not writable"],
  ["missing_directory", "Missing folder"],
  ["cannot_create_directory", "Cannot create the folder"],
  ["mail_secret_decryption_failed", "Could not decrypt the stored mail secret"],
]);

const LIVE_CHECK_SENTENCES = new Map<string, string>([
  ["ok", "Passed"],
  ["failed", "Did not pass"],
  ["skipped", "Not tested this run"],
  ["timeout", "Timed out"],
  ["unavailable", "Provider unavailable"],
  ["support_contact_required", "Needs a support contact"],
]);

/** A code this module doesn't recognise yet: readable, but not hand-picked. */
function humanizeUnknownCode(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Sentence-cases whatever the shared export label gives (which itself is `key` verbatim for
 * an unmapped key, e.g. `stale_after_ms`), instead of relying on a blanket CSS capitalize that
 * would also wrongly capitalize every word of a multi-word label. */
export function formatHealthDisplayLabel(key: string): string {
  // The value is shown in minutes (see formatHealthDisplayValue), so the raw key's "ms" would
  // contradict it.
  if (key === "stale_after_ms") return "Stale after";
  const label = formatHealthDetailLabel(key);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Panel-only readability on top of the shared {@link formatHealthDetailValue}: minutes for
 * `stale_after_ms`, plain sentences for `reason`/`live_check` codes, Yes/No capitalised, and a
 * browser-local date-time for `last_beat_at` (only reached when the "Last seen" age is omitted -
 * see {@link healthDetailRows}). */
export function formatHealthDisplayValue(key: string, value: string, timezone: string): string {
  if (key === "stale_after_ms") {
    const ms = Number(value);
    return Number.isFinite(ms) ? `${Math.round(ms / 60_000)} min` : value;
  }
  if (key === "reason") return REASON_SENTENCES.get(value) ?? humanizeUnknownCode(value);
  if (key === "live_check") return LIVE_CHECK_SENTENCES.get(value) ?? humanizeUnknownCode(value);
  if (key === "last_beat_at") return formatEventDateTime(value, timezone);
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  return formatHealthDetailValue(key, value);
}

/**
 * The detail list for an expanded row: always drops `status`/`last_checked`, and drops any other
 * detail whose formatted value already appears in the row's own summary text (except the Wallet
 * event counts, see NEVER_DEDUPED_DETAIL_KEYS), so a number isn't repeated (a degraded
 * `rate_limit_storage` already names its latency in the summary; a healthy Database, whose summary
 * is just "Connected", still shows its own Latency).
 */
export function visibleHealthDetails(check: HealthCheckRowDto, timezone: string): HealthDetailDto[] {
  return check.details.filter((d) => {
    if (ALWAYS_HIDDEN_DETAIL_KEYS.has(d.key)) return false;
    if (NEVER_DEDUPED_DETAIL_KEYS.has(d.key)) return true;
    const displayValue = formatHealthDisplayValue(d.key, d.value, timezone);
    // An empty display value (e.g. an unset worker hostname, `beat.hostname ?? ""`) is a
    // substring of every string, so without this guard it would look like a duplicate of the
    // summary and vanish instead of showing blank.
    if (displayValue === "") return true;
    return !summaryShowsValue(check.summary, displayValue);
  });
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** True when `value` appears in `summary` as a whole word or phrase. A plain substring test would
 * treat the detail "No" as already shown by a summary reading "Not configured", or "12" by "112 ms",
 * and silently drop it from the expanded row. */
function summaryShowsValue(summary: string, value: string): boolean {
  let from = 0;
  for (;;) {
    const at = summary.indexOf(value, from);
    if (at === -1) return false;
    if (!isWordChar(summary.charAt(at - 1)) && !isWordChar(summary.charAt(at + value.length))) return true;
    from = at + 1;
  }
}

/** One row of the expanded detail list, already worded for display. */
export type HealthDetailRow = { key: string; label: string; value: string };

/**
 * {@link visibleHealthDetails}, worded for display. The worker's `last_beat_at` row becomes
 * "Last seen: 12 min before this report" when {@link workerLastSeen} has an age to show, and
 * stays a plain browser-local date-time when it has not (under a minute old, or invalid).
 */
export function healthDetailRows(check: HealthCheckRowDto, timezone: string, generatedAt: string): HealthDetailRow[] {
  const lastSeen = workerLastSeen(check, generatedAt);
  return visibleHealthDetails(check, timezone).map((d) =>
    d.key === "last_beat_at" && lastSeen !== null
      ? { key: d.key, label: "Last seen", value: lastSeen }
      : {
          key: d.key,
          label: formatHealthDisplayLabel(d.key),
          value: formatHealthDisplayValue(d.key, d.value, timezone),
        },
  );
}

/**
 * "12 min before this report", measured from the worker's `last_beat_at` detail
 * against the report's own `generated_at` (never live wall-clock time, so it does not tick
 * between renders). Worker only (background_worker is the only check id that ever carries
 * `last_beat_at` today, but this pins the fact to that check by id rather than incidentally by
 * key, so a future unrelated check reusing the same detail name doesn't inherit this wording).
 * Null when the worker has no `last_beat_at` (never ran), the age is under a minute, or the
 * date is invalid.
 */
export function workerLastSeen(check: HealthCheckRowDto, generatedAt: string): string | null {
  if (check.id !== "background_worker") return null;
  const lastBeatAt = check.details.find((d) => d.key === "last_beat_at")?.value;
  if (!lastBeatAt) return null;
  const magnitude = formatRelativeMagnitude(lastBeatAt, new Date(generatedAt));
  return magnitude ? `${magnitude} before this report` : null;
}
