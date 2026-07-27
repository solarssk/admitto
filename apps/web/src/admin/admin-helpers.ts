import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@prisma/client";
import { canManageEvent, canManageInstance } from "@admitto/auth";
import { IllegalItemTransitionError, type OpsAuditContext } from "@admitto/tickets";
import { recordSystemLog } from "@admitto/shared/system-log";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import { isValidIanaTimezone } from "./timezone.js";
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

/** Client-supplied IANA timezone (X-Client-Timezone header), validated - null when missing or
 * not a real timezone. Best-effort audit metadata: never blocks the request either way. */
export function resolveClientTimezone(c: Context): string | null {
  const raw = c.req.header("x-client-timezone");
  if (!raw || !isValidIanaTimezone(raw)) return null;
  return raw;
}

/** Build ops audit context from the authenticated admin request. */
export function adminAuditFromContext(c: Context): OpsAuditContext {
  const auth = c.get("auth");
  return {
    operator: auth.userId,
    sessionId: auth.sessionId,
    ip: resolveClientIp(c),
    timezone: resolveClientTimezone(c) ?? undefined,
  };
}

/** Best-effort actor email for System-logs enrichment - the session/auth context only ever
 * carries a userId, so a raw admin action (session revoke, event archive/delete) previously
 * logged an unreadable actorUserId with no way to tell which person did it without a DB lookup.
 * Full email, not redacted - internal staff accountability, matching the per-org Audit log's
 * own already-unredacted actor identification (see `actor_email` in audit-routes.ts). Null if
 * the user row is gone (should not happen for an authenticated actor, but must not throw either
 * way). */
export async function resolveActorEmailForLog(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<string | null> {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    return user?.email ?? null;
  } catch {
    return null;
  }
}

/** Require `:eventId` route param or return 400. */
export function requireEventId(c: Context): string | Response {
  const eventId = c.req.param("eventId");
  if (!eventId) return c.json({ error: "eventId required" }, 400);
  return eventId;
}

/** Return 403 when the session user is not a superadmin; otherwise null. */
export async function requireSuperadmin(c: Context, db: PrismaClient): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

/** Require authenticated actor for audit writes; 401 when session has no user id. */
export function requireAuditActor(c: Context): (OpsAuditContext & { operator: string }) | Response {
  const audit = adminAuditFromContext(c);
  if (!audit.operator) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return { ...audit, operator: audit.operator };
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Reject impossible calendar dates such as 2026-02-30. Shared by every admin route that
 * accepts a `YYYY-MM-DD` query date bound (audit-routes.ts, security-audit-routes.ts). */
export function isValidCalendarDate(value: string): boolean {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3) return false;
  const [year, month, day] = parts as [number, number, number];
  if (!year || !month || !day) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Parse a query date bound. Date-only values (`YYYY-MM-DD`) use UTC day bounds:
 * start → 00:00:00.000, end → 23:59:59.999 (inclusive through the selected day).
 * Full ISO instants (with `T`) are used as-is - the UI sends local-day bounds this way.
 * Invalid calendar dates and unparseable values are ignored (returns undefined).
 */
export function parseDateBound(raw: string | undefined, bound: "start" | "end"): Date | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (DATE_ONLY.test(trimmed)) {
    if (!isValidCalendarDate(trimmed)) return undefined;
    const [year, month, day] = trimmed.split("-").map(Number) as [number, number, number];
    if (bound === "start") return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

/**
 * Acquires a Postgres advisory lock scoped to one event, held for the rest of the current
 * transaction. Serializes permanent event deletion against a concurrent event mail-settings
 * PUT on the same eventId — whichever transaction starts first blocks the other until it
 * commits, so a PUT can never recreate an orphaned MailSettings row for an event a
 * concurrent delete just removed (MailSettings has no FK to Event; see event-deletion.ts).
 * Call at the very start of both transactions, before any other read (CodeRabbit review).
 */
export async function lockEventForMailSettingsWrite(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
  const lockKey = `event-mail-settings:${eventId}`;
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

/** Shared error shape for a failed item-state transition/revoke (operator and admin routes). */
export function itemTransitionErrorResponse(c: Context, err: unknown, logLabel: string): Response {
  if (err instanceof IllegalItemTransitionError) {
    return c.json({ error: err.message }, 409);
  }
  console.error(`${logLabel} failed:`, err);
  recordSystemLog({
    level: "error",
    source: "api",
    message: `${logLabel}_failed`,
  });
  return c.json({ error: "server error" }, 500);
}
