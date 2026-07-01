// In-memory SSE channels per event.
// For multi-instance: replace Map with Redis pub/sub (TODO ADR).

export type SseEvent =
  | {
      type: "checkin";
      attendeeId: string;
      attendeeName: string;
      ticketType: string | null;
      admittedAt: string;
      operatorId: string | null;
      deviceLabel: string | null;
    }
  | { type: "checkin_already" } // reserved (PR B / replay); not emitted in PR A
  | { type: "ping" };

type SseListener = (event: SseEvent) => void;

const channels = new Map<string, Set<SseListener>>();

export function subscribe(eventId: string, cb: SseListener): () => void {
  let listeners = channels.get(eventId);
  if (!listeners) {
    listeners = new Set();
    channels.set(eventId, listeners);
  }
  listeners.add(cb);

  return () => {
    const set = channels.get(eventId);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) {
      channels.delete(eventId);
    }
  };
}

export function publish(eventId: string, event: SseEvent): void {
  const listeners = channels.get(eventId);
  if (!listeners) return;
  for (const cb of listeners) {
    cb(event);
  }
}

export function subscriberCount(eventId: string): number {
  return channels.get(eventId)?.size ?? 0;
}

/** Test-only: reset all channels. */
export function resetSseChannelsForTests(): void {
  channels.clear();
}
