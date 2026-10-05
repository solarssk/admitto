import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import type { PrismaClient } from "@admitto/db";
import {
  canPerformCheckIn,
  cfAccessIdentityBindingStillHolds,
  extractAccessTokenFromHeaders,
  findCloudflareAccessProvider,
  getCfAccessConfigCached,
  isFullSessionMfaPolicySatisfied,
  isSessionIdleExpired,
  isTransientCfAccessJwtFailure,
  validateAccessJwt,
} from "@admitto/auth";
import { assertEventNotArchived } from "./admin/event-archiving.js";
import { rejectCrossSitePost } from "./auth/same-origin-post.js";
import { resolveStaffAuthFromRequest } from "./auth/resolve-staff-auth.js";

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
 * Request-time pre-auth: valid emergency Bearer, OR whatever the shared staff resolver accepts
 * (session cookie or, when enabled, a Cloudflare Access JWT resolved to an already-linked
 * account - same resolver /admin itself uses, so an operator who only ever signs in through
 * Cloudflare Access is not silently unable to scan). Does not parse body; does not check event
 * scope.
 */
export function createCheckinPreAuth(deps: CheckinSessionAuthDeps) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const { allowBearer, operatorToken } = deps.config;

    if (allowBearer && operatorToken && isValidCheckinBearer(c, operatorToken)) {
      c.set("checkinAuth", "bearer");
      return next();
    }

    const result = await resolveStaffAuthFromRequest(c, deps.prisma);
    if (result.status !== "authenticated") {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("checkinAuth", "session");
    c.set("checkinAuthSource", result.auth.authSource);
    c.set("operatorUserId", result.auth.userId);
    if (result.auth.sessionId) {
      c.set("checkinSessionId", result.auth.sessionId);
    }
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
 * Both auth paths are blocked once the event is archived — archiving is a terminal, read-only
 * state that also ends check-in (see event-archiving.ts).
 */
export function createCheckinEventScope(
  deps: CheckinSessionAuthDeps,
  getEventId: (c: Context) => string | undefined,
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const eventId = getEventId(c);

    if (c.get("checkinAuth") === "bearer") {
      if (eventId) {
        const archived = await assertEventNotArchived(c, deps.prisma, eventId);
        if (archived) return archived;
      }
      return next();
    }

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

    const archived = await assertEventNotArchived(c, deps.prisma, eventId);
    if (archived) return archived;

    await next();
  };
}

/** A full cookie session as validateSession would still honour it, without touching `last_seen_at`. */
async function sessionStillValid(
  prisma: PrismaClient,
  sessionId: string,
): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      revoked_at: true,
      expires_at: true,
      user_id: true,
      remember_me: true,
      stage: true,
      last_seen_at: true,
      created_at: true,
      auth_method: true,
    },
  });
  if (!session || session.revoked_at || session.expires_at.getTime() <= Date.now()) return false;
  // Same inactivity and MFA policy as validateSession, read-only.
  if (await isSessionIdleExpired(prisma, session)) return false;
  return isFullSessionMfaPolicySatisfied(prisma, session);
}

/**
 * The Cloudflare Access assertion a stream was opened with, as a fresh request would be judged:
 * integration still enabled, provider still enabled, the JWT (signature, audience, expiry) still
 * valid and its identity still linked to this operator through the configured source provider
 * (cfAccessIdentityBindingStillHolds). Only a verdict on the credential closes the stream; a transient JWKS timeout or
 * network failure (see isTransientCfAccessJwtFailure) keeps it open, since the client's reconnect
 * is then judged by the full auth path.
 */
async function cfAccessCredentialStillValid(
  c: Context,
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  const config = await getCfAccessConfigCached(prisma);
  if (!config.enabled) return false;
  const token = extractAccessTokenFromHeaders(Object.fromEntries(c.req.raw.headers.entries()));
  if (!token) return false;
  let payload;
  try {
    payload = await validateAccessJwt(token, config);
  } catch (err) {
    return isTransientCfAccessJwtFailure(err);
  }
  if ((await findCloudflareAccessProvider(prisma))?.enabled !== true) return false;
  return cfAccessIdentityBindingStillHolds(prisma, { config, payload, userId });
}

/**
 * Re-checks, on every SSE heartbeat, what the first request was judged on: archived or deleted
 * event, account status, the credential it was opened with (session row or Cloudflare Access
 * assertion) and the operator's role on the event. Returns false once any of them no longer
 * holds. Never refreshes `last_seen_at`, so an open stream cannot keep an idle session alive, and
 * fails open on a database error so a blip does not drop every operator at once.
 */
export function createCheckinStreamRevalidator(deps: CheckinSessionAuthDeps) {
  return async (c: Context, eventId: string): Promise<boolean> => {
    try {
      const event = await deps.prisma.event.findUnique({
        where: { id: eventId },
        select: { archived_at: true },
      });
      // A deleted event has no row at all, which is as final as an archived one.
      if (!event || event.archived_at) return false;
      if (c.get("checkinAuth") === "bearer") return true;

      const userId = c.get("operatorUserId") as string | undefined;
      if (!userId) return false;
      // Deactivation revokes sessions but leaves role assignments, so the account status is read
      // for every caller, including Cloudflare Access streams that have no session row.
      const user = await deps.prisma.user.findUnique({
        where: { id: userId },
        select: { is_active: true },
      });
      if (!user?.is_active) return false;

      const sessionId = c.get("checkinSessionId") as string | undefined;
      if (sessionId && !(await sessionStillValid(deps.prisma, sessionId))) return false;
      if (
        c.get("checkinAuthSource") === "cloudflare-access" &&
        !(await cfAccessCredentialStillValid(c, deps.prisma, userId))
      ) {
        return false;
      }
      return await canPerformCheckIn(deps.prisma, userId, eventId);
    } catch {
      return true;
    }
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
