import { useEffect, useRef, useState } from "react";

/** Connection state for the admin check-in SSE subscription. */
export type StreamStatus = "connecting" | "connected" | "reconnecting" | "auth_error";

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

const MAX_INITIAL_FAILURES = 3;
/** Reconnect backoff schedule (ms) after SSE disconnect. */
export const STREAM_BACKOFF_MS = [2000, 4000, 8000, 30000] as const;

/** Preflight stream access — EventSource.onerror does not expose HTTP status. */
export async function probeStreamAuth(
  eventId: string,
  fetchFn: typeof fetch = fetch,
): Promise<"ok" | "denied" | "unknown"> {
  const ac = new AbortController();
  try {
    const res = await fetchFn(`/api/checkin/events/${encodeURIComponent(eventId)}/stream`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "text/event-stream" },
      signal: ac.signal,
    });
    ac.abort();
    await res.body?.cancel();
    if (res.status === 401 || res.status === 403) return "denied";
    return "ok";
  } catch {
    ac.abort();
    return "unknown";
  }
}

/**
 * Subscribe to live check-in SSE for an event (same-origin session cookie).
 * Ignores heartbeat `ping` events; dispatches `checkin` only.
 */
export function useEventStream(
  eventId: string | undefined,
  onCheckin: (event: StreamCheckinEvent) => void,
): { connected: boolean; status: StreamStatus } {
  const onCheckinRef = useRef(onCheckin);
  onCheckinRef.current = onCheckin;

  const [status, setStatus] = useState<StreamStatus>("connecting");
  const connected = status === "connected";

  useEffect(() => {
    if (!eventId) return;

    let es: EventSource | null = null;
    let retryTimer: number | null = null;
    let reconnectAttempt = 0;
    let initialFailureCount = 0;
    let everConnected = false;
    let cancelled = false;

    const clearRetry = () => {
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleReconnect = () => {
      const delay = STREAM_BACKOFF_MS[Math.min(reconnectAttempt - 1, STREAM_BACKOFF_MS.length - 1)];
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
        initialFailureCount = 0;
        setStatus("connected");
      };

      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as { type: string };
          if (data.type === "ping") return;
          if (data.type === "checkin") {
            onCheckinRef.current(data as StreamCheckinEvent);
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

        if (!everConnected) {
          initialFailureCount += 1;
          if (initialFailureCount >= MAX_INITIAL_FAILURES) {
            const auth = await probeStreamAuth(eventId);
            if (cancelled) return;
            // eslint-disable-next-line security/detect-possible-timing-attacks -- non-secret auth probe status string
            if (auth === "denied") {
              setStatus("auth_error");
              return;
            }
            initialFailureCount = 0;
          }
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
