import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageEvent } from "@admitto/auth";
import { IllegalItemTransitionError, type OpsAuditContext } from "@admitto/tickets";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import {
  InstanceUrlRequiredError,
  resolveInstanceBaseUrl,
} from "../instance-base-url.js";

/** Resolve mail/preview base URL or return 422 when unset in production. */
export async function resolveMailInstanceBaseUrl(
  c: Context,
  db: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  injectedBaseUrl?: string,
): Promise<string | Response> {
  try {
    return await resolveInstanceBaseUrl(db, env, injectedBaseUrl);
  } catch (err) {
    if (err instanceof InstanceUrlRequiredError) {
      return c.json({ error: "instance_url_required" }, 422);
    }
    throw err;
  }
}

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

/** Parse a positive integer query param with safe fallback and optional upper bound. */
export function positiveIntQuery(
  raw: string | undefined,
  fallback: number,
  max?: number,
): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) return fallback;
  return max !== undefined ? Math.min(n, max) : n;
}

/** Shared error shape for a failed item-state transition/revoke (operator and admin routes). */
export function itemTransitionErrorResponse(c: Context, err: unknown, logLabel: string): Response {
  if (err instanceof IllegalItemTransitionError) {
    return c.json({ error: err.message }, 409);
  }
  console.error(`${logLabel} failed:`, err);
  return c.json({ error: "server error" }, 500);
}
