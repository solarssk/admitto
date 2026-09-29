import type { HealthCheckRowDto, HealthDetailDto } from "../api/types.js";
import { formatEventDateTime, formatRelativeMagnitude } from "../utils/event-dates.js";
import { formatHealthDetailLabel, formatHealthDetailValue } from "./healthCheckMarkdown.js";

/** Always hidden from the expanded row: `status` and the badge/circle already say it,
 * `last_checked` is a bookkeeping timestamp with no operator value on its own. */
const ALWAYS_HIDDEN_DETAIL_KEYS = new Set(["status", "last_checked"]);

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
  const label = formatHealthDetailLabel(key);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Panel-only readability on top of the shared {@link formatHealthDetailValue}: minutes for
 * `stale_after_ms`, plain sentences for `reason`/`live_check` codes, Yes/No capitalised, and a
 * browser-local date-time for `last_beat_at` (only reached when the worker fact itself is
 * omitted - see {@link visibleHealthDetails}). */
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
 * The detail list for an expanded row: always drops `status`/`last_checked`, drops
 * `last_beat_at` only when the worker fact already shows it (so the age isn't lost entirely
 * when the fact itself is omitted for being under a minute old or invalid), and drops any other
 * detail whose formatted value already appears in the row's own summary text, so a number isn't
 * repeated (a degraded `rate_limit_storage` already names its latency in the summary; a healthy
 * Database, whose summary is just "Connected", still shows its own Latency).
 */
export function visibleHealthDetails(
  check: HealthCheckRowDto,
  timezone: string,
  workerFactShown: boolean,
): HealthDetailDto[] {
  return check.details.filter((d) => {
    if (ALWAYS_HIDDEN_DETAIL_KEYS.has(d.key)) return false;
    if (d.key === "last_beat_at" && workerFactShown) return false;
    const displayValue = formatHealthDisplayValue(d.key, d.value, timezone);
    // An empty display value (e.g. an unset worker hostname, `beat.hostname ?? ""`) is a
    // substring of every string, so without this guard it would look like a duplicate of the
    // summary and vanish instead of showing blank.
    if (displayValue === "") return true;
    return !check.summary.includes(displayValue);
  });
}

/**
 * "Last seen 12 min before this report", measured from the worker's `last_beat_at` detail
 * against the report's own `generated_at` (never live wall-clock time, so it does not tick
 * between renders). Worker only (background_worker is the only check id that ever carries
 * `last_beat_at` today, but this pins the fact to that check by id rather than incidentally by
 * key, so a future unrelated check reusing the same detail name doesn't inherit this wording).
 * Omitted when the worker has no `last_beat_at` (never ran), the age is under a minute, or the
 * date is invalid.
 */
export function workerLastSeenFact(check: HealthCheckRowDto, generatedAt: string): string | null {
  if (check.id !== "background_worker") return null;
  const lastBeatAt = check.details.find((d) => d.key === "last_beat_at")?.value;
  if (!lastBeatAt) return null;
  const magnitude = formatRelativeMagnitude(lastBeatAt, new Date(generatedAt));
  return magnitude ? `Last seen ${magnitude} before this report` : null;
}
