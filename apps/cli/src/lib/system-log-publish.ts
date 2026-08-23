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
};

/** Registered as the emitSystemLog() publisher hook for the lifetime of the worker process (see
 * installSystemLogRelay below, called from runWorker in commands/worker.ts). Fires and forgets -
 * the caller (emitSystemLog) does not await this, so a slow or hanging request can never delay
 * the drain tick it was called from. */
export function publishSystemLogEntry(entry: SystemLogEntry, options: PublishSystemLogEntryOptions = {}): void {
  const target = resolveTarget(options.env ?? process.env);
  if (!target) return;

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
      fields: entry.fields,
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
}
