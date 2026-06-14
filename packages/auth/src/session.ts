import type { PrismaClient, Prisma, Session } from "@prisma/client";
import { generateToken, hashToken } from "@admitto/tickets";
import { SESSION_LAST_SEEN_THROTTLE_MS } from "./constants.js";
import { resolveSessionTtlMs } from "./session-ttl.js";

/** Max length for optional device label on sessions (matches login form). */
const DEVICE_LABEL_MAX_LEN = 120;

export interface CreateSessionInput {
  userId: string;
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
}

/** Active session after cookie token validation (includes raw token for logout). */
export interface ValidatedSession {
  session: Session;
  userId: string;
  rawToken: string;
}

/** Filters for admin session listing (future UI). */
export interface ListSessionsFilters {
  userId?: string;
  includeRevoked?: boolean;
}

/** Create a new DB-backed session; returns raw token (give to client once). */
export async function createSession(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: CreateSessionInput,
): Promise<{ session: Session; rawToken: string }> {
  const rawToken = generateToken();
  const token_hash = hashToken(rawToken);
  const ttlMs = await resolveSessionTtlMs(prisma, input.userId);
  const now = new Date();
  const expires_at = new Date(now.getTime() + ttlMs);

  const session = await prisma.session.create({
    data: {
      user_id: input.userId,
      token_hash,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      device_label: input.deviceLabel ? input.deviceLabel.slice(0, DEVICE_LABEL_MAX_LEN) : null,
      last_seen_at: now,
      expires_at,
    },
  });

  return { session, rawToken };
}

/**
 * Lookup session by raw cookie token; reject revoked, expired, or inactive-user sessions.
 * Updates `last_seen_at` at most once per `SESSION_LAST_SEEN_THROTTLE_MS`.
 */
export async function validateSession(
  prisma: PrismaClient | Prisma.TransactionClient,
  rawToken: string,
): Promise<ValidatedSession | null> {
  const token_hash = hashToken(rawToken);
  const session = await prisma.session.findUnique({
    where: { token_hash },
    include: { user: { select: { is_active: true } } },
  });

  if (!session) return null;
  if (session.revoked_at) return null;
  if (session.expires_at.getTime() <= Date.now()) return null;
  if (!session.user.is_active) return null;

  const now = new Date();
  if (now.getTime() - session.last_seen_at.getTime() >= SESSION_LAST_SEEN_THROTTLE_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { last_seen_at: now },
    });
  }

  return { session, userId: session.user_id, rawToken };
}

/** Mark one session revoked by id (no-op if already revoked). */
export async function revokeSession(
  prisma: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

/**
 * Revoke active sessions for users with operator@event scope on the given event.
 * Does not revoke admin/superadmin sessions.
 */
export async function revokeAllOperatorSessionsForEvent(
  prisma: PrismaClient | Prisma.TransactionClient,
  eventId: string,
): Promise<number> {
  const operatorAssignments = await prisma.roleAssignment.findMany({
    where: {
      role: "operator",
      scope_type: "event",
      scope_id: eventId,
    },
    select: { user_id: true },
  });

  const operatorUserIds = [...new Set(operatorAssignments.map((a) => a.user_id))];
  if (operatorUserIds.length === 0) return 0;

  const elevatedAssignments = await prisma.roleAssignment.findMany({
    where: {
      user_id: { in: operatorUserIds },
      role: { in: ["superadmin", "admin"] },
    },
    select: { user_id: true },
  });
  const elevatedUserIds = new Set(elevatedAssignments.map((a) => a.user_id));
  const userIds = operatorUserIds.filter((id) => !elevatedUserIds.has(id));
  if (userIds.length === 0) return 0;

  const result = await prisma.session.updateMany({
    where: {
      user_id: { in: userIds },
      revoked_at: null,
    },
    data: { revoked_at: new Date() },
  });

  return result.count;
}

/** List sessions for admin tooling; excludes revoked rows unless `includeRevoked`. */
export async function listSessions(
  prisma: PrismaClient | Prisma.TransactionClient,
  filters: ListSessionsFilters = {},
): Promise<Session[]> {
  return prisma.session.findMany({
    where: {
      ...(filters.userId ? { user_id: filters.userId } : {}),
      ...(filters.includeRevoked ? {} : { revoked_at: null }),
    },
    orderBy: { last_seen_at: "desc" },
  });
}
