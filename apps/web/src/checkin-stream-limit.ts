import type { Context, Next } from "hono";
import { resolveClientIp } from "./rate-limit/client-ip.js";

/** Max concurrent SSE streams per event, per operator (or bearer IP). */
const MAX_CONCURRENT_CHECKIN_STREAMS_PER_EVENT = 3;
/** Actor-wide ceiling on top of the per-event one above - without it, an actor could mint an
 * unbounded number of fresh per-event slot budgets simply by varying :eventId, since under
 * emergency Bearer auth the event-scope gate deliberately allows an unknown/made-up event id
 * through (assertEventNotArchived has nothing to check against). Generous enough for a handful
 * of events open at once (Check-in + Overview + Reports all watch the same event, so 3 events'
 * worth of tabs is already 9), while still bounding one actor's total stream count overall -
 * same as the plain per-actor cap this used before per-event scoping (bot review). */
const MAX_CONCURRENT_CHECKIN_STREAMS_PER_ACTOR = 12;

const CHECKIN_STREAM_EVENT_SLOT_KEY = "checkinStreamEventSlotKey";
const CHECKIN_STREAM_ACTOR_SLOT_KEY = "checkinStreamActorSlotKey";

const activeStreamsByEvent = new Map<string, number>();
const activeStreamsByActor = new Map<string, number>();

function checkinAuthActorParts(c: Context): { prefix: "bearer:ip" | "user" | "ip"; value: string } {
  if (c.get("checkinAuth") === "bearer") return { prefix: "bearer:ip", value: resolveClientIp(c) };
  const userId = c.get("operatorUserId") as string | undefined;
  if (userId) return { prefix: "user", value: userId };
  return { prefix: "ip", value: resolveClientIp(c) };
}

// Scoped per event, same reasoning as checkinRateLimitKey's own "stream" branch
// (rate-limit/policies.ts) - a global-per-user slot budget let one event's reconnecting stream
// starve a completely different event's stream under the same account.
function streamEventKey(c: Context): string {
  const { prefix, value } = checkinAuthActorParts(c);
  return `checkin:stream:${prefix}:${value}:event:${c.req.param("eventId")}`;
}

function streamActorKey(c: Context): string {
  const { prefix, value } = checkinAuthActorParts(c);
  return `checkin:stream:${prefix}:${value}`;
}

function tryAcquireSlot(counters: Map<string, number>, key: string, max: number): boolean {
  const active = counters.get(key) ?? 0;
  if (active >= max) return false;
  counters.set(key, active + 1);
  return true;
}

function releaseSlot(counters: Map<string, number>, key: string): void {
  const current = counters.get(key) ?? 1;
  if (current <= 1) {
    counters.delete(key);
  } else {
    counters.set(key, current - 1);
  }
}

/** Reserve a stream slot; returns 429 Response when at capacity (per-event or actor-wide). */
export function tryAcquireCheckinStreamSlot(c: Context): Response | null {
  const eventKey = streamEventKey(c);
  const actorKey = streamActorKey(c);

  if (!tryAcquireSlot(activeStreamsByEvent, eventKey, MAX_CONCURRENT_CHECKIN_STREAMS_PER_EVENT)) {
    return c.json({ error: "too_many_streams" }, 429);
  }
  if (!tryAcquireSlot(activeStreamsByActor, actorKey, MAX_CONCURRENT_CHECKIN_STREAMS_PER_ACTOR)) {
    releaseSlot(activeStreamsByEvent, eventKey);
    return c.json({ error: "too_many_streams" }, 429);
  }

  c.set(CHECKIN_STREAM_EVENT_SLOT_KEY, eventKey);
  c.set(CHECKIN_STREAM_ACTOR_SLOT_KEY, actorKey);
  return null;
}

/** Release slot(s) acquired by {@link tryAcquireCheckinStreamSlot} (call on SSE disconnect). */
export function releaseCheckinStreamSlot(c: Context): void {
  const eventKey = c.get(CHECKIN_STREAM_EVENT_SLOT_KEY) as string | undefined;
  const actorKey = c.get(CHECKIN_STREAM_ACTOR_SLOT_KEY) as string | undefined;
  if (!eventKey && !actorKey) return;

  c.set(CHECKIN_STREAM_EVENT_SLOT_KEY, undefined);
  c.set(CHECKIN_STREAM_ACTOR_SLOT_KEY, undefined);
  if (eventKey) releaseSlot(activeStreamsByEvent, eventKey);
  if (actorKey) releaseSlot(activeStreamsByActor, actorKey);
}

/** Limit parallel long-lived check-in SSE connections per operator. */
export function createCheckinStreamConcurrencyLimit() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const blocked = tryAcquireCheckinStreamSlot(c);
    if (blocked) return blocked;
    await next();
  };
}

/** Test-only: active stream count for a per-event concurrency key. */
export function activeCheckinStreamCountForTests(key: string): number {
  return activeStreamsByEvent.get(key) ?? 0;
}

/** Test-only: active stream count for an actor-wide concurrency key. */
export function activeCheckinStreamActorCountForTests(key: string): number {
  return activeStreamsByActor.get(key) ?? 0;
}

/** Test-only: reset concurrency counters. */
export function resetCheckinStreamLimitsForTests(): void {
  activeStreamsByEvent.clear();
  activeStreamsByActor.clear();
}
