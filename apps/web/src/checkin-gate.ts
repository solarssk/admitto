import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import type { PrismaClient } from "@prisma/client";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME, canPerformCheckIn, validateSession } from "@admitto/auth";

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

/**
 * ADR 0003 configured guard: null operatorToken → 503 for entire /api/checkin/* namespace.
 */
export function createCheckinConfiguredGuard(operatorToken: string | null) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (!operatorToken) {
      return c.json({ error: "check-in not configured" }, 503);
    }
    await next();
  };
}

export interface CheckinDualAuthDeps {
  prisma: PrismaClient;
  operatorToken: string;
}

/**
 * Per-route auth: valid Bearer OR valid session with canPerformCheckIn for eventId.
 * Bearer does not require eventId. Session path requires non-empty eventId string.
 */
export function createCheckinDualAuth(
  deps: CheckinDualAuthDeps,
  getEventId: (c: Context) => string | undefined,
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (isValidCheckinBearer(c, deps.operatorToken)) {
      c.set("checkinAuth", "bearer");
      return next();
    }

    const eventId = getEventId(c);
    if (!eventId) {
      return c.json({ error: "eventId required" }, 400);
    }

    const rawToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!rawToken) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const validated = await validateSession(deps.prisma, rawToken);
    if (!validated) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const allowed = await canPerformCheckIn(deps.prisma, validated.userId, eventId);
    if (!allowed) {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("checkinAuth", "session");
    c.set("operatorUserId", validated.userId);
    await next();
  };
}

/**
 * Legacy bearer-only gate (configured guard + bearer). Used when session deps are not wired.
 */
export function createCheckinGate(operatorToken: string | null) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (!operatorToken) {
      return c.json({ error: "check-in not configured" }, 503);
    }

    if (!isValidCheckinBearer(c, operatorToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("checkinAuth", "bearer");
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

export function eventIdFromScanBody(c: Context): string | undefined {
  const body = c.get("parsedScanBody") as Record<string, unknown> | undefined;
  if (!body) return undefined;
  const eventId = body["eventId"];
  return typeof eventId === "string" && eventId.length > 0 ? eventId : undefined;
}

export function eventIdFromHistoryQuery(c: Context): string | undefined {
  const eventId = c.req.query("eventId");
  return eventId && eventId.length > 0 ? eventId : undefined;
}
