import { useEffect, useRef, useState } from "react";

export type StreamStatus = "connecting" | "connected" | "reconnecting" | "auth_error";

export interface StreamCheckinEvent {
  type: "checkin";
  attendeeId: string;
  attendeeName: string;
  ticketType: string | null;
  admittedAt: string;
  operatorId: string | null;
  deviceLabel: string | null;
}

const MAX_RETRIES = 3;
const BACKOFF_MS = [2000, 4000, 8000, 30000];

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
    let retryCount = 0;
    let everConnected = false;
    let cancelled = false;

    const clearRetry = () => {
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleReconnect = () => {
      const delay = BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)];
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
        retryCount = 0;
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

      es.onerror = () => {
        es?.close();
        es = null;
        if (cancelled) return;

        if (!everConnected) {
          retryCount += 1;
          if (retryCount >= MAX_RETRIES) {
            setStatus("auth_error");
            return;
          }
        }

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
