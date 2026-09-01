import { useEffect, useRef, useState } from "react";

/** Connection state for the admin check-in SSE subscription. */
export type StreamStatus = "connecting" | "connected" | "reconnecting" | "auth_error" | "rate_limited";

/** Payload for a live `checkin` event on the event stream. */
export interface StreamCheckinEvent {
  type: "checkin";
  attendeeId: string;
  attendeeName: string;
  ticketType: string | null;
  admittedAt: string;
  operatorId: string | null;
  deviceLabel: string | null;
}

const MAX_CONSECUTIVE_FAILURES = 3;
/** Reconnect backoff schedule (ms) after SSE disconnect. */
export const STREAM_BACKOFF_MS = [2000, 4000, 8000, 30000] as const;
/** Backoff after a confirmed 429 (rate/concurrency limited) - longer than the normal schedule's
 * own 30s ceiling, since retrying at the same pace that caused the limit just prolongs it. */
export const RATE_LIMIT_BACKOFF_MS = 60_000;

/** Preflight stream access — EventSource.onerror does not expose HTTP status. */
export async function probeStreamAuth(
  eventId: string,
  fetchFn: typeof fetch = fetch,
): Promise<"ok" | "denied" | "rate_limited" | "unknown"> {
  const ac = new AbortController();
  try {
    const res = await fetchFn(`/api/checkin/events/${encodeURIComponent(eventId)}/stream`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "text/event-stream" },
      signal: ac.signal,
    });
    // Classify from the status before any cleanup - a real (non-mocked) body's cancel() after
    // aborting the same signal can itself reject with AbortError, which the outer catch would
    // otherwise mistake for "status unknown" and silently drop a real 429/401/403 (bot review).
    const status = res.status;
    try {
      ac.abort();
      await res.body?.cancel();
    } catch {
      /* cleanup failure doesn't change the classification already read above */
    }
    if (status === 401 || status === 403) return "denied";
    if (status === 429) return "rate_limited";
    return "ok";
  } catch {
    ac.abort();
    return "unknown";
  }
}

/**
 * Subscribe to live check-in SSE for an event (same-origin session cookie).
 * Ignores heartbeat `ping` events; dispatches `checkin` and `activity_changed`.
 * `onActivityChanged` fires for attendee-add / item issue/return/revoke - events with no
 * optimistic-render payload, just a signal to refetch the overview.
 */
export function useEventStream(
  eventId: string | undefined,
  onCheckin: (event: StreamCheckinEvent) => void,
  onActivityChanged?: () => void,
): { connected: boolean; status: StreamStatus } {
  const onCheckinRef = useRef(onCheckin);
  onCheckinRef.current = onCheckin;
  const onActivityChangedRef = useRef(onActivityChanged);
  onActivityChangedRef.current = onActivityChanged;

  const [status, setStatus] = useState<StreamStatus>("connecting");
  const connected = status === "connected";

  useEffect(() => {
    if (!eventId) return;

    let es: EventSource | null = null;
    let retryTimer: number | null = null;
    let reconnectAttempt = 0;
    let consecutiveFailureCount = 0;
    let everConnected = false;
    let rateLimited = false;
    let cancelled = false;

    const clearRetry = () => {
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleReconnect = () => {
      // A confirmed 429 gets its own longer, fixed delay instead of the normal schedule -
      // retrying at the pace that caused the limit just prolongs it.
      const delay = rateLimited
        ? RATE_LIMIT_BACKOFF_MS
        : STREAM_BACKOFF_MS[Math.min(reconnectAttempt - 1, STREAM_BACKOFF_MS.length - 1)];
      clearRetry();
      retryTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (cancelled) return;
      setStatus(everConnected ? "reconnecting" : "connecting");

      es = new EventSource(`/api/checkin/events/${encodeURIComponent(eventId)}/stream`, {
        withCredentials: true,
      });

      es.onopen = () => {
        everConnected = true;
        reconnectAttempt = 0;
        consecutiveFailureCount = 0;
        rateLimited = false;
        setStatus("connected");
      };

      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as { type: string };
          if (data.type === "ping") return;
          if (data.type === "checkin") {
            onCheckinRef.current(data as StreamCheckinEvent);
          } else if (data.type === "activity_changed") {
            onActivityChangedRef.current?.();
          }
        } catch {
          /* ignore malformed payloads */
        }
      };

      es.onerror = async () => {
        es?.close();
        es = null;
        if (cancelled) return;

        reconnectAttempt += 1;
        consecutiveFailureCount += 1;

        // Re-probe every Nth consecutive failure to check for a real cause (403 vs 429) rather
        // than on every single drop - a probe is itself a request, so probing continuously while
        // rate-limited would just add to the very budget it's trying to detect exhaustion of.
        // Once already rate-limited, re-probe on every failure instead: the whole point of that
        // state is to notice recovery quickly rather than staying stuck for MAX_CONSECUTIVE_FAILURES
        // more silent attempts.
        if (rateLimited || consecutiveFailureCount >= MAX_CONSECUTIVE_FAILURES) {
          const probeResult = await probeStreamAuth(eventId);
          if (cancelled) return;
          // eslint-disable-next-line security/detect-possible-timing-attacks -- non-secret probe status string
          if (probeResult === "denied") {
            setStatus("auth_error");
            return;
          }
          // eslint-disable-next-line security/detect-possible-timing-attacks -- non-secret probe status string
          if (probeResult === "rate_limited") {
            rateLimited = true;
            setStatus("rate_limited");
            scheduleReconnect();
            return;
          }
          rateLimited = false;
          consecutiveFailureCount = 0;
        }

        if (cancelled) return;
        setStatus(everConnected ? "reconnecting" : "connecting");
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearRetry();
      es?.close();
    };
  }, [eventId]);

  return { connected, status };
}
