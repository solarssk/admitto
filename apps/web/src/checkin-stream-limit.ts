import type { Context, Next } from "hono";
import { CHECKIN_STREAM_LIMITS, type CheckinStreamLimits } from "./checkin-stream-config.js";
import { resolveClientIp } from "./rate-limit/client-ip.js";

type StreamConcurrencyLimits = Pick<CheckinStreamLimits, "maxConcurrentPerEvent" | "maxConcurrentPerActor">;

// Concurrency ceilings (max simultaneously open streams) come from ENV, resolved once at app start:
// `CHECKIN_STREAM_MAX_CONCURRENT_PER_EVENT` (per operator or bearer IP, per event) and
// `CHECKIN_STREAM_MAX_CONCURRENT_PER_ACTOR` (see checkin-stream-config.ts). The actor-wide ceiling
// sits on top of the per-event one: without it, an actor could mint an unbounded number of fresh
// per-event slot budgets simply by varying :eventId, since under emergency Bearer auth the
// event-scope gate deliberately allows an unknown/made-up event id through
// (assertEventNotArchived has nothing to check against). The default of 12 is generous for a
// handful of events open at once (Check-in + Overview + Reports all watch the same event, so 3
// events' worth of tabs is already 9), while still bounding one actor's total stream count
// overall - same as the plain per-actor cap this used before per-event scoping (bot review).

const CHECKIN_STREAM_SLOT_KEY = "checkinStreamSlotKey";

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
export function tryAcquireCheckinStreamSlot(
  c: Context,
  limits: StreamConcurrencyLimits = CHECKIN_STREAM_LIMITS,
): Response | null {
  const eventKey = streamEventKey(c);
  const actorKey = streamActorKey(c);

  if (!tryAcquireSlot(activeStreamsByEvent, eventKey, limits.maxConcurrentPerEvent)) {
    return c.json({ error: "too_many_streams" }, 429);
  }
  if (!tryAcquireSlot(activeStreamsByActor, actorKey, limits.maxConcurrentPerActor)) {
    releaseSlot(activeStreamsByEvent, eventKey);
    return c.json({ error: "too_many_streams" }, 429);
  }

  c.set(CHECKIN_STREAM_SLOT_KEY, { eventKey, actorKey });
  return null;
}

/** Release the slot pair acquired by {@link tryAcquireCheckinStreamSlot} (call on SSE disconnect).
 * Always stored/released as one pair, not two independently-nullable keys - the two are only ever
 * set together above, so there's no real "only one acquired" state to branch on separately. */
export function releaseCheckinStreamSlot(c: Context): void {
  const slot = c.get(CHECKIN_STREAM_SLOT_KEY) as { eventKey: string; actorKey: string } | undefined;
  if (!slot) return;

  c.set(CHECKIN_STREAM_SLOT_KEY, undefined);
  releaseSlot(activeStreamsByEvent, slot.eventKey);
  releaseSlot(activeStreamsByActor, slot.actorKey);
}

/** Limit parallel long-lived check-in SSE connections per operator. */
export function createCheckinStreamConcurrencyLimit(
  limits: StreamConcurrencyLimits = CHECKIN_STREAM_LIMITS,
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const blocked = tryAcquireCheckinStreamSlot(c, limits);
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
