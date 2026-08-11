/**
 * Redis pub/sub channel naming and event shape shared between apps/web (SSE publisher +
 * subscriber for its own HTTP connections) and the apps/cli worker (publisher only - it has no
 * SSE connections of its own, just events to announce). Kept dependency-free so both processes
 * can import it without pulling in a Redis client.
 */

const SSE_CHANNEL_PREFIX = "admitto:sse:";

/** Redis channel name for a given event's SSE fan-out. */
export function sseChannelName(eventId: string): string {
  return `${SSE_CHANNEL_PREFIX}${eventId}`;
}

/** Pattern for PSUBSCRIBE to receive every event's channel on one subscription. */
export const SSE_CHANNEL_PATTERN = `${SSE_CHANNEL_PREFIX}*`;

/** Recovers the event id from a channel name matching SSE_CHANNEL_PATTERN, or null if it doesn't. */
export function eventIdFromSseChannel(channel: string): string | null {
  return channel.startsWith(SSE_CHANNEL_PREFIX) ? channel.slice(SSE_CHANNEL_PREFIX.length) : null;
}

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
  // Lightweight signal for activity types with no optimistic-render payload (attendee added,
  // item issued/returned/revoked, mail sent/failed/bounced, import finished) - the client just
  // refetches the overview on receipt.
  | { type: "activity_changed" }
  | { type: "ping" };
