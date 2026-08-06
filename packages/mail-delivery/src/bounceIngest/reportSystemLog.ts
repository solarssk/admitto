import { lastRunOkFromSummary, lastRunSummaryFromIngest } from "./lastRun.js";
import type { IngestSummary } from "./types.js";

export type ReportBounceIngestSystemLogOptions = {
  eventId: string;
  summary: IngestSummary;
  /** Base URL of the Admitto app (e.g. http://app:3000). */
  appBaseUrl?: string;
  /** Same token as OPS_HEALTH_TOKEN on the app. */
  opsHealthToken?: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  /** Abort the best-effort POST after this many ms (default 2000). */
  timeoutMs?: number;
};

/**
 * Best-effort POST to the app System Logs buffer. No-op when URL/token missing.
 * Never throws; failures are logged to stdout only.
 */
export async function reportBounceIngestSystemLog(
  options: ReportBounceIngestSystemLogOptions,
): Promise<void> {
  const base = options.appBaseUrl?.trim().replace(/\/$/, "");
  const token = options.opsHealthToken?.trim();
  const log = options.log ?? console.error;
  if (!base || !token) return;

  const ok = lastRunOkFromSummary(options.summary);
  const counts = lastRunSummaryFromIngest(options.summary);
  const message = ok ? "mail_bounce_ingest_ok" : "mail_bounce_ingest_failed";
  const level = ok ? "info" : "error";

  const url = `${base}/api/ops/system-logs`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0 ? options.timeoutMs : 2000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        source: "mail",
        level,
        message,
        fields: {
          event_id: options.eventId,
          ...counts,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log(`[bounce-ingest] system-log POST ${res.status} event=${options.eventId}`);
    }
  } catch (err) {
    log(
      `[bounce-ingest] system-log POST failed event=${options.eventId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Read report targets from env (compose). */
export function bounceIngestSystemLogEnv(env: NodeJS.ProcessEnv = process.env): {
  appBaseUrl?: string;
  opsHealthToken?: string;
} {
  const appBaseUrl = (
    env.BOUNCE_INGEST_APP_URL?.trim() ||
    env.ADMITTO_INTERNAL_URL?.trim() ||
    undefined
  )?.replace(/\/$/, "");
  const opsHealthToken = env.OPS_HEALTH_TOKEN?.trim() || undefined;
  return { appBaseUrl, opsHealthToken };
}
