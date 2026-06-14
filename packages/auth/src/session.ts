import type { PrismaClient, Prisma } from "@prisma/client";
import { generateToken, hashToken } from "@admitto/tickets";
import { SESSION_LAST_SEEN_THROTTLE_MS, SESSION_STAGE, type SessionStage } from "./constants.js";
import { MFA_PENDING_SESSION_TTL_MS } from "./constants.js";
import {
  getSessionTtlAdminMs,
  getSessionTtlOperatorMs,
  getMfaRequiredRoles,
} from "./settings/resolver.js";
import { userRequiresMfa, userHasConfirmedTotp } from "./mfa/policy.js";

/** Max length for optional device label on sessions (matches login form). */
const DEVICE_LABEL_MAX_LEN = 120;

export interface CreateSessionInput {
  userId: string;
  stage?: SessionStage;
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
}

/** Active full session after cookie token validation. */
export interface ValidatedSession {
  session: import("@prisma/client").Session;
  userId: string;
  rawToken: string;
}

/** Any non-revoked session including partial MFA stages. */
export interface ValidatedPartialSession extends ValidatedSession {
  stage: SessionStage;
}

/** Filters for admin session listing (future UI). */
export interface ListSessionsFilters {
  userId?: string;
  includeRevoked?: boolean;
}

async function resolveFullTtlMs(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const assignments = await prisma.roleAssignment.findMany({
    where: { user_id: userId },
    select: { role: true },
  });
  const hasElevated = assignments.some((a) => a.role === "superadmin" || a.role === "admin");
  return hasElevated ? getSessionTtlAdminMs(prisma) : getSessionTtlOperatorMs(prisma);
}

/** Create a new DB-backed session; returns raw token (give to client once). */
export async function createSession(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: CreateSessionInput,
): Promise<{ session: import("@prisma/client").Session; rawToken: string }> {
  const rawToken = generateToken();
  const token_hash = hashToken(rawToken);
  const stage = input.stage ?? SESSION_STAGE.FULL;
  const now = new Date();

  const ttlMs =
    stage === SESSION_STAGE.FULL
      ? await resolveFullTtlMs(prisma, input.userId)
      : MFA_PENDING_SESSION_TTL_MS;
  const expires_at = new Date(now.getTime() + ttlMs);

  const session = await prisma.session.create({
    data: {
      user_id: input.userId,
      token_hash,
      stage,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      device_label: input.deviceLabel ? input.deviceLabel.slice(0, DEVICE_LABEL_MAX_LEN) : null,
      last_seen_at: now,
      expires_at,
    },
  });

  return { session, rawToken };
}

async function lookupSessionByToken(
  prisma: PrismaClient | Prisma.TransactionClient,
  rawToken: string,
): Promise<ValidatedPartialSession | null> {
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

  return {
    session,
    userId: session.user_id,
    rawToken,
    stage: session.stage as SessionStage,
  };
}

/**
 * Lookup session by raw cookie token; only `full` stage (protected routes).
 * Re-checks MFA policy so elevated roles granted after login cannot reuse stale operator sessions.
 */
export async function validateSession(
  prisma: PrismaClient | Prisma.TransactionClient,
  rawToken: string,
): Promise<ValidatedSession | null> {
  const validated = await lookupSessionByToken(prisma, rawToken);
  if (!validated || validated.stage !== SESSION_STAGE.FULL) return null;
  if (!(await assertFullSessionMfaPolicy(prisma, validated))) return null;
  return validated;
}

/** Reject full sessions that predate MFA-required role grants or lack enrolled TOTP. */
async function assertFullSessionMfaPolicy(
  prisma: PrismaClient | Prisma.TransactionClient,
  validated: ValidatedPartialSession,
): Promise<boolean> {
  if (!(await userRequiresMfa(prisma, validated.userId))) return true;
  if (!(await userHasConfirmedTotp(prisma, validated.userId))) return false;

  const requiredRoles = await getMfaRequiredRoles(prisma);
  const firstElevatedRole = await prisma.roleAssignment.findFirst({
    where: { user_id: validated.userId, role: { in: requiredRoles } },
    orderBy: { created_at: "asc" },
    select: { created_at: true },
  });
  if (
    firstElevatedRole &&
    validated.session.created_at < firstElevatedRole.created_at
  ) {
    return false;
  }
  return true;
}

/**
 * Lookup any active session including mfa_pending / enrollment_required.
 */
export async function validatePartialSession(
  prisma: PrismaClient | Prisma.TransactionClient,
  rawToken: string,
): Promise<ValidatedPartialSession | null> {
  return lookupSessionByToken(prisma, rawToken);
}

/** Promote partial session to full after successful MFA; false if session ineligible or already full. */
export async function promoteSessionToFull(
  prisma: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  // TTL is resolved at promotion time (not cached from login) so SystemSettings changes apply immediately.
  const ttlMs = await resolveFullTtlMs(prisma, userId);
  const now = new Date();
  const result = await prisma.session.updateMany({
    where: {
      id: sessionId,
      user_id: userId,
      revoked_at: null,
      stage: { in: [SESSION_STAGE.MFA_PENDING, SESSION_STAGE.ENROLLMENT_REQUIRED] },
    },
    data: {
      stage: SESSION_STAGE.FULL,
      expires_at: new Date(now.getTime() + ttlMs),
      last_seen_at: now,
    },
  });
  return result.count === 1;
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
): Promise<import("@prisma/client").Session[]> {
  return prisma.session.findMany({
    where: {
      ...(filters.userId ? { user_id: filters.userId } : {}),
      ...(filters.includeRevoked ? {} : { revoked_at: null }),
    },
    orderBy: { last_seen_at: "desc" },
  });
}
