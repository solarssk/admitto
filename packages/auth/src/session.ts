import type { PrismaClient, Prisma } from "@admitto/db";
import { generateToken, hashToken } from "@admitto/tickets";
import { SESSION_LAST_SEEN_THROTTLE_MS, SESSION_STAGE, AUTH_METHOD, type SessionStage, type AuthMethod } from "./constants.js";
import { MFA_PENDING_SESSION_TTL_MS, BACKUP_CODES_STEP_TTL_MS } from "./constants.js";
import {
  getSessionTtlAdminMs,
  getSessionTtlOperatorMs,
  getMfaRequiredRoles,
} from "./settings/resolver.js";
import {
  userRequiresMfa,
  userHasConfirmedTotp,
  userHasUnacknowledgedBackupCodes,
} from "./mfa/policy.js";

/** Max length for optional device label on sessions (operator check-in step). */
export const DEVICE_LABEL_MAX_LEN = 120;

export interface CreateSessionInput {
  userId: string;
  stage?: SessionStage;
  authMethod?: AuthMethod;
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
}

/** Active full session after cookie token validation. */
export interface ValidatedSession {
  session: import("@admitto/db").Session;
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

/**
 * Resolve the stage a session is allowed to hold once any MFA step is satisfied.
 * A `full` session is withheld while the user still owes a constrained step:
 * acknowledging backup recovery codes (IAM-002) or a forced password change
 * (IAM-001). These gates are enforced at the session layer so no HTTP client can
 * skip them by ignoring a client-side `next` hint.
 */
async function resolvePostMfaStage(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<SessionStage> {
  if (await userHasUnacknowledgedBackupCodes(prisma, userId)) {
    return SESSION_STAGE.BACKUP_CODES_REQUIRED;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { must_change_password: true },
  });
  if (user?.must_change_password) return SESSION_STAGE.CHANGE_PASSWORD_REQUIRED;
  return SESSION_STAGE.FULL;
}

/** Derive session stage when caller omits it (fail closed for MFA-required users). */
async function resolveInitialSessionStage(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  explicit?: SessionStage,
): Promise<SessionStage> {
  if (explicit !== undefined) return explicit;
  if (!(await userRequiresMfa(prisma, userId))) return resolvePostMfaStage(prisma, userId);
  if (await userHasConfirmedTotp(prisma, userId)) return SESSION_STAGE.MFA_PENDING;
  return SESSION_STAGE.ENROLLMENT_REQUIRED;
}

/** Create a new DB-backed session; returns raw token (give to client once). */
export async function createSession(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: CreateSessionInput,
): Promise<{ session: import("@admitto/db").Session; rawToken: string }> {
  const rawToken = generateToken();
  const token_hash = hashToken(rawToken);
  const authMethod = input.authMethod ?? AUTH_METHOD.LOCAL;
  const stage =
    input.stage === SESSION_STAGE.FULL && authMethod === AUTH_METHOD.OIDC
      ? SESSION_STAGE.FULL
      : await resolveInitialSessionStage(prisma, input.userId, input.stage);
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
      auth_method: authMethod,
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
  if (validated?.stage !== SESSION_STAGE.FULL) return null;
  if (!(await assertFullSessionMfaPolicy(prisma, validated))) return null;
  return validated;
}

/** Reject full sessions that predate MFA-required role grants or lack enrolled TOTP. */
async function assertFullSessionMfaPolicy(
  prisma: PrismaClient | Prisma.TransactionClient,
  validated: ValidatedPartialSession,
): Promise<boolean> {
  // Backup-code acknowledgment is mandatory before a full session is honored for
  // every auth method, including OIDC (IAM-002).
  if (await userHasUnacknowledgedBackupCodes(prisma, validated.userId)) return false;

  if (validated.session.auth_method === AUTH_METHOD.OIDC) return true;
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

/**
 * Promote partial session to backup-codes step after TOTP enrollment confirm.
 * Grants a fresh TTL so users who spent most of the QR-scan window do not hit
 * an expired session immediately upon reaching the backup-codes page.
 */
export async function promoteSessionToBackupCodesStep(
  prisma: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const now = new Date();
  const result = await prisma.session.updateMany({
    where: {
      id: sessionId,
      user_id: userId,
      revoked_at: null,
      expires_at: { gt: now },
      stage: SESSION_STAGE.ENROLLMENT_REQUIRED,
    },
    data: {
      stage: SESSION_STAGE.BACKUP_CODES_REQUIRED,
      expires_at: new Date(now.getTime() + BACKUP_CODES_STEP_TTL_MS),
      last_seen_at: now,
    },
  });
  return result.count === 1;
}

/**
 * Advance a partial session after a successful step. Resolves the next stage via
 * {@link resolvePostMfaStage}: usually `full`, but kept constrained when the user
 * still owes backup-code acknowledgment (IAM-002) or a forced password change
 * (IAM-001). Returns the resulting stage, or `null` if the session was ineligible.
 */
export async function promoteSessionToFull(
  prisma: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
  userId: string,
): Promise<SessionStage | null> {
  const targetStage = await resolvePostMfaStage(prisma, userId);
  // TTL is resolved at promotion time (not cached from login) so SystemSettings changes apply immediately.
  const nonFullTtlMs =
    targetStage === SESSION_STAGE.BACKUP_CODES_REQUIRED
      ? BACKUP_CODES_STEP_TTL_MS
      : MFA_PENDING_SESSION_TTL_MS;
  const ttlMs =
    targetStage === SESSION_STAGE.FULL ? await resolveFullTtlMs(prisma, userId) : nonFullTtlMs;
  const now = new Date();
  const result = await prisma.session.updateMany({
    where: {
      id: sessionId,
      user_id: userId,
      revoked_at: null,
      expires_at: { gt: now },
      stage: {
        in: [
          SESSION_STAGE.MFA_PENDING,
          SESSION_STAGE.ENROLLMENT_REQUIRED,
          SESSION_STAGE.BACKUP_CODES_REQUIRED,
          SESSION_STAGE.CHANGE_PASSWORD_REQUIRED,
        ],
      },
    },
    data: {
      stage: targetStage,
      expires_at: new Date(now.getTime() + ttlMs),
      last_seen_at: now,
    },
  });
  return result.count === 1 ? targetStage : null;
}

/** Set or clear device label on the active session (operator check-in step). */
export async function updateSessionDeviceLabel(
  prisma: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
  userId: string,
  deviceLabel: string | null | undefined,
): Promise<boolean> {
  const trimmed = deviceLabel?.trim();
  const normalized =
    trimmed && trimmed.length > 0 ? trimmed.slice(0, DEVICE_LABEL_MAX_LEN) : null;
  const now = new Date();
  const result = await prisma.session.updateMany({
    where: {
      id: sessionId,
      user_id: userId,
      revoked_at: null,
      expires_at: { gt: now },
      stage: SESSION_STAGE.FULL,
    },
    data: { device_label: normalized },
  });
  return result.count === 1;
}

/** Mark one session revoked by id (no-op if already revoked). Returns whether it actually revoked one. */
export async function revokeSession(
  prisma: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  return result.count > 0;
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

  const now = new Date();
  const result = await prisma.session.updateMany({
    where: {
      user_id: { in: userIds },
      revoked_at: null,
      expires_at: { gt: now },
    },
    data: { revoked_at: now },
  });

  return result.count;
}

/** List sessions for admin tooling; excludes revoked rows unless `includeRevoked`. */
export async function listSessions(
  prisma: PrismaClient | Prisma.TransactionClient,
  filters: ListSessionsFilters = {},
): Promise<import("@admitto/db").Session[]> {
  return prisma.session.findMany({
    where: {
      ...(filters.userId ? { user_id: filters.userId } : {}),
      ...(filters.includeRevoked ? {} : { revoked_at: null }),
    },
    orderBy: { last_seen_at: "desc" },
  });
}
