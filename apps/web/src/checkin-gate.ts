import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import type { PrismaClient } from "@prisma/client";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME, canPerformCheckIn, validateSession } from "@admitto/auth";
import { rejectCrossSitePost } from "./auth/same-origin-post.js";

/** Returns true when Authorization Bearer matches operatorToken (constant-time). */
export function isValidCheckinBearer(c: Context, operatorToken: string): boolean {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  const provided = auth.slice(7);
  const tokenBuf = Buffer.from(operatorToken, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");

  if (tokenBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(tokenBuf, providedBuf);
}

/** Check-in gate configuration for session + optional emergency Bearer path. */
export interface CheckinGateConfig {
  allowBearer: boolean;
  operatorToken: string | null;
}

/** Dependencies for session check-in gate (ADR 0011). */
export interface CheckinSessionAuthDeps {
  prisma: PrismaClient;
  config: CheckinGateConfig;
}

/**
 * Request-time pre-auth: valid emergency Bearer OR valid session cookie.
 * Does not parse body; does not check event scope.
 */
export function createCheckinPreAuth(deps: CheckinSessionAuthDeps) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const { allowBearer, operatorToken } = deps.config;

    if (allowBearer && operatorToken && isValidCheckinBearer(c, operatorToken)) {
      c.set("checkinAuth", "bearer");
      return next();
    }

    const rawToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!rawToken) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const validated = await validateSession(deps.prisma, rawToken);
    if (!validated) {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("checkinAuth", "session");
    c.set("operatorUserId", validated.userId);
    c.set("checkinSessionId", validated.session.id);
    await next();
  };
}

/** CSRF guard for session-authenticated mutating check-in requests (Bearer path skips). */
export function createCheckinSessionCsrfGuard() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.get("checkinAuth") === "bearer") {
      return next();
    }
    const blocked = rejectCrossSitePost(c, { format: "json" });
    if (blocked) return blocked;
    await next();
  };
}

/**
 * Event-scoped RBAC after preAuth. Bearer path skips RBAC; session requires eventId + canPerformCheckIn.
 */
export function createCheckinEventScope(
  deps: CheckinSessionAuthDeps,
  getEventId: (c: Context) => string | undefined,
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.get("checkinAuth") === "bearer") {
      return next();
    }

    const eventId = getEventId(c);
    if (!eventId) {
      return c.json({ error: "eventId required" }, 400);
    }

    const userId = c.get("operatorUserId") as string | undefined;
    if (!userId) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const allowed = await canPerformCheckIn(deps.prisma, userId, eventId);
    if (!allowed) {
      return c.json({ error: "forbidden" }, 403);
    }

    await next();
  };
}

/** Parse POST /api/checkin/scan JSON body once; store on context for handler reuse. */
export async function parseScanBodyMiddleware(c: Context, next: Next): Promise<Response | void> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "body required" }, 400);
  }
  c.set("parsedScanBody", body as Record<string, unknown>);
  await next();
}

/** Read `eventId` from `parsedScanBody` set by `parseScanBodyMiddleware`. */
export function eventIdFromScanBody(c: Context): string | undefined {
  const body = c.get("parsedScanBody") as Record<string, unknown> | undefined;
  if (!body) return undefined;
  const eventId = body["eventId"];
  return typeof eventId === "string" && eventId.length > 0 ? eventId : undefined;
}

/** Read `eventId` from query string (check-in history). */
export function eventIdFromHistoryQuery(c: Context): string | undefined {
  const eventId = c.req.query("eventId");
  return eventId && eventId.length > 0 ? eventId : undefined;
}
