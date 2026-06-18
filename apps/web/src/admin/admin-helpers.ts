import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageEvent } from "@admitto/auth";
import type { OpsAuditContext } from "@admitto/tickets";
import { resolveClientIp } from "../rate-limit/client-ip.js";

/** Return 403 when the session user cannot manage the event; otherwise null. */
export async function assertEventManageAccess(
  c: Context,
  db: PrismaClient,
  eventId: string,
): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageEvent(db, auth.userId, eventId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

/** Build ops audit context from the authenticated admin request. */
export function adminAuditFromContext(c: Context): OpsAuditContext {
  const auth = c.get("auth");
  return {
    operator: auth.userId,
    sessionId: auth.sessionId,
    ip: resolveClientIp(c),
  };
}

/** Require `:eventId` route param or return 400. */
export function requireEventId(c: Context): string | Response {
  const eventId = c.req.param("eventId");
  if (!eventId) return c.json({ error: "eventId required" }, 400);
  return eventId;
}

/** Parse a positive integer query param with safe fallback. */
export function positiveIntQuery(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) return fallback;
  return n;
}
