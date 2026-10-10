/**
 * Relays the worker process's own emitSystemLog() entries to apps/web's System logs buffer, over
 * the existing /api/ops/system-logs ops bridge (apps/web/src/ops/system-log-ingest.ts) - the same
 * authenticated bridge packages/mail-delivery/src/bounceIngest/reportSystemLog.ts already uses
 * for the bounce job specifically. The worker is a separate OS process from apps/web, which owns
 * the in-memory buffer the UI reads (packages/shared/src/systemLog.ts) - without this, nothing
 * the worker logs could ever reach that screen. Best-effort and fire-and-forget: a missing
 * BOUNCE_INGEST_APP_URL/ADMITTO_INTERNAL_URL, a missing OPS_HEALTH_TOKEN, or a slow/unavailable
 * app must never throw back into emitSystemLog's caller or stall a drain tick - the worker's own
 * stdout output (already written by emitSystemLog before this runs) is the source of truth
 * regardless of whether the relay succeeds.
 */
import { setSystemLogPublisher, type SystemLogEntry } from "@admitto/shared/system-log";

const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * The ops endpoint takes 120 requests a minute per IP (the "ops:system-logs" policy in apps/web), and every relayed
 * line is a request of its own, so a burst (a provider that refuses hundreds of calls in a row, each writing a line)
 * would make the app answer 429 to the lines after it, which are the ones that sum the burst up. The relay therefore
 * keeps below that: at most OVERALL_LIMIT lines in a minute, and at most PER_MESSAGE_LIMIT of any one message, which
 * leaves room for the lines of other messages (the summary after the burst) and for other users of the same bridge.
 * What is held back is still on stdout, which is the source of truth, and the last line of a message that reached its
 * limit says so.
 */
const WINDOW_MS = 60_000;
const OVERALL_LIMIT = 90;
const PER_MESSAGE_LIMIT = 20;
const RELAY_NOTE = "Further lines of this message are not relayed for a minute (see the worker's own output).";
/** Beyond this many different messages the table is cleaned of the ones whose minute is over. */
const MAX_TRACKED_MESSAGES = 200;

type Window = { startedAt: number; sent: number };
let overall: Window = { startedAt: 0, sent: 0 };
const perMessage = new Map<string, Window>();

function freshWindow(now: number): Window {
  return { startedAt: now, sent: 0 };
}

/** Whether the line may go, and whether it is the last one its message may send in this minute. */
function admit(entry: SystemLogEntry, now: number): { relay: boolean; last: boolean } {
  if (now - overall.startedAt >= WINDOW_MS) overall = freshWindow(now);
  if (perMessage.size > MAX_TRACKED_MESSAGES) {
    for (const [key, window] of perMessage) if (now - window.startedAt >= WINDOW_MS) perMessage.delete(key);
  }
  const key = `${entry.source}/${entry.message}`;
  let own = perMessage.get(key);
  if (!own || now - own.startedAt >= WINDOW_MS) {
    own = freshWindow(now);
    perMessage.set(key, own);
  }
  if (overall.sent >= OVERALL_LIMIT || own.sent >= PER_MESSAGE_LIMIT) return { relay: false, last: false };
  overall.sent += 1;
  own.sent += 1;
  return { relay: true, last: own.sent === PER_MESSAGE_LIMIT };
}
/** Matches apps/web/src/ops/system-log-ingest.ts's bodySchema message length cap - truncate here
 * instead of letting an over-length message (worker.ts's own startup banner, say) fail validation
 * and get silently dropped by the bridge. */
const MAX_MESSAGE_LENGTH = 200;

function resolveTarget(env: NodeJS.ProcessEnv): { appBaseUrl: string; opsHealthToken: string } | null {
  const appBaseUrl = (env["BOUNCE_INGEST_APP_URL"]?.trim() || env["ADMITTO_INTERNAL_URL"]?.trim())?.replace(/\/$/, "");
  const opsHealthToken = env["OPS_HEALTH_TOKEN"]?.trim();
  if (!appBaseUrl || !opsHealthToken) return null;
  return { appBaseUrl, opsHealthToken };
}

export type PublishSystemLogEntryOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Clock override for tests. */
  nowMs?: number;
};

/** Registered as the emitSystemLog() publisher hook for the lifetime of the worker process (see
 * installSystemLogRelay below, called from runWorker in commands/worker.ts). Fires and forgets -
 * the caller (emitSystemLog) does not await this, so a slow or hanging request can never delay
 * the drain tick it was called from. */
export function publishSystemLogEntry(entry: SystemLogEntry, options: PublishSystemLogEntryOptions = {}): void {
  const target = resolveTarget(options.env ?? process.env);
  if (!target) return;
  const decision = admit(entry, options.nowMs ?? Date.now());
  if (!decision.relay) return;

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  fetchImpl(`${target.appBaseUrl}/api/ops/system-logs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${target.opsHealthToken}` },
    body: JSON.stringify({
      source: entry.source,
      level: entry.level,
      message: entry.message.slice(0, MAX_MESSAGE_LENGTH),
      fields: decision.last ? { ...entry.fields, relay_note: RELAY_NOTE } : entry.fields,
    }),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) console.warn(`worker system-log relay: POST ${res.status}`);
    })
    .catch((err) => {
      console.warn(`worker system-log relay: POST failed (${String(err)})`);
    })
    .finally(() => clearTimeout(timer));
}

/** Wires this module in as the process-wide relay. Call once at worker startup. */
export function installSystemLogRelay(): void {
  setSystemLogPublisher((entry) => publishSystemLogEntry(entry));
}

/** Stops relaying further entries. Call on worker shutdown and from tests between cases -
 * otherwise a leftover publisher from one test/run keeps firing fetch() calls into the next. */
export function uninstallSystemLogRelay(): void {
  setSystemLogPublisher(null);
  overall = freshWindow(0);
  perMessage.clear();
}
