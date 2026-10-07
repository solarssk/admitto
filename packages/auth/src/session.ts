import type { PrismaClient, Prisma } from "@admitto/db";
import { generateToken, hashToken } from "@admitto/tickets";
import { eventDayWindow } from "@admitto/shared";
import { SESSION_LAST_SEEN_THROTTLE_MS, SESSION_STAGE, AUTH_METHOD, type SessionStage, type AuthMethod } from "./constants.js";
import { MFA_PENDING_SESSION_TTL_MS, BACKUP_CODES_STEP_TTL_MS } from "./constants.js";
import {
  getSessionTtlAdminMs,
  getSessionTtlOperatorMs,
  getSessionIdleTimeoutAdminMs,
  getSessionIdleTimeoutOperatorMs,
  getMfaRequiredRoles,
  getOperatorEventDaySessionsEnabled,
} from "./settings/resolver.js";
import {
  userRequiresMfa,
  userHasAnyConfirmedMfaMethod,
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
  /** Signer's IANA timezone at login (browser-captured); null/omit when unknown. */
  timezone?: string | null;
  /** Which IdP this login came from, for RP-initiated logout. Ignored for authMethod "local". */
  oidcProviderId?: string;
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

async function hasElevatedRole(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const assignments = await prisma.roleAssignment.findMany({
    where: { user_id: userId },
    select: { role: true },
  });
  return assignments.some((a) => a.role === "superadmin" || a.role === "admin");
}

async function resolveFullTtlMs(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const elevated = await hasElevatedRole(prisma, userId);
  return elevated ? getSessionTtlAdminMs(prisma) : getSessionTtlOperatorMs(prisma);
}

/**
 * Resolve the idle timeout (inactivity window) for a `full` session, based on role.
 * Separate from the absolute lifetime above (P0 security review): a session is now
 * ended by whichever limit is hit first — long inactivity, or the absolute TTL.
 * Null means no inactivity window at all, for an event-day session (see
 * {@link resolveEventDaySessionEnd}): the check-in tablet sits idle between shifts and the end of
 * the event day, which is the session's own expiry, is the only limit. The role and the master
 * switch are re-read here on every request, so an admin role granted after sign-in, or the switch
 * turned off mid-event, puts the normal inactivity window back at once.
 */
async function resolveIdleTimeoutMs(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  eventDaySession: boolean,
): Promise<number | null> {
  const elevated = await hasElevatedRole(prisma, userId);
  if (eventDaySession && !elevated && (await getOperatorEventDaySessionsEnabled(prisma))) return null;
  return elevated
    ? getSessionIdleTimeoutAdminMs(prisma)
    : getSessionIdleTimeoutOperatorMs(prisma);
}

/**
 * Whether a `full` session has been inactive for longer than its role's idle window. Read-only:
 * unlike {@link lookupSessionByToken} it neither revokes the session nor refreshes `last_seen_at`,
 * so a long-lived connection (the check-in live stream) can apply the same policy without
 * keeping an idle session alive.
 */
export async function isSessionIdleExpired(
  prisma: PrismaClient | Prisma.TransactionClient,
  session: { user_id: string; remember_me: boolean; stage: string; last_seen_at: Date },
  now: Date = new Date(),
): Promise<boolean> {
  if (session.stage !== SESSION_STAGE.FULL) return false;
  const idleTimeoutMs = await resolveIdleTimeoutMs(prisma, session.user_id, session.remember_me);
  return idleTimeoutMs !== null && now.getTime() - session.last_seen_at.getTime() >= idleTimeoutMs;
}

/** How far the Event.date noon-UTC sentinel can sit from `now` while the sign-in still falls in the
 * event's window, as a cheap query prefilter: up to 26 hours ahead (UTC+14 at its local midnight)
 * and, behind, nearly 48 hours (an overnight event in UTC-12 that ends late the next day). 72
 * hours leaves margin on both sides. The exact check is eventDayWindow. */
const EVENT_DAY_PREFILTER_MS = 72 * 60 * 60 * 1000;

/**
 * The instant an event-day session started `now` should end, or null when none applies. It does
 * when the master switch (`operator_event_day_sessions`) is on, the user is an operator-only
 * account (no admin or superadmin role, in any scope) and one of the non-archived events it is
 * assigned to is happening today in that event's own timezone; the latest end wins when there are
 * several. The role decides, nobody is asked. An event whose date or timezone cannot be read is
 * skipped, so a bad row means normal limits and never a longer session.
 */
async function resolveEventDaySessionEnd(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<Date | null> {
  if (!(await getOperatorEventDaySessionsEnabled(prisma))) return null;
  if (await hasElevatedRole(prisma, userId)) return null;
  const assignments = await prisma.roleAssignment.findMany({
    where: { user_id: userId, role: "operator", scope_type: "event", scope_id: { not: null } },
    select: { scope_id: true },
  });
  const eventIds = assignments.map((a) => a.scope_id).filter((id): id is string => id !== null);
  if (eventIds.length === 0) return null;
  const events = await prisma.event.findMany({
    where: {
      id: { in: eventIds },
      archived_at: null,
      date: {
        gt: new Date(now.getTime() - EVENT_DAY_PREFILTER_MS),
        lt: new Date(now.getTime() + EVENT_DAY_PREFILTER_MS),
      },
    },
    select: { date: true, timezone: true, event_hours_start: true, event_hours_end: true },
  });
  let end: Date | null = null;
  for (const event of events) {
    const window = eventDayWindow({
      date: event.date,
      eventHoursStart: event.event_hours_start,
      eventHoursEnd: event.event_hours_end,
      timezone: event.timezone,
    });
    if (!window || now < window.start || now >= window.end) continue;
    if (!end || window.sessionEnd > end) end = window.sessionEnd;
  }
  return end;
}

/**
 * `Max-Age` (seconds) for the session cookie of a `full` event-day session, so the cookie
 * survives the browser or tablet app being closed; undefined for every other session, which keeps
 * a browser-session cookie.
 */
export function persistentCookieMaxAgeSeconds(
  session: { remember_me: boolean; stage: string; expires_at: Date },
  now: Date = new Date(),
): number | undefined {
  if (!session.remember_me || session.stage !== SESSION_STAGE.FULL) return undefined;
  return Math.max(0, Math.floor((session.expires_at.getTime() - now.getTime()) / 1000));
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
  if (await userHasAnyConfirmedMfaMethod(prisma, userId)) return SESSION_STAGE.MFA_PENDING;
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

  // Partial stages (MFA, enrollment, ...) keep their short TTL: the event-day session is decided
  // when the session becomes `full`, see promoteSessionToFull.
  const eventDayEnd =
    stage === SESSION_STAGE.FULL ? await resolveEventDaySessionEnd(prisma, input.userId, now) : null;
  let ttlMs = MFA_PENDING_SESSION_TTL_MS;
  if (stage === SESSION_STAGE.FULL) {
    ttlMs = eventDayEnd
      ? eventDayEnd.getTime() - now.getTime()
      : await resolveFullTtlMs(prisma, input.userId);
  }
  const expires_at = new Date(now.getTime() + ttlMs);

  const session = await prisma.session.create({
    data: {
      user_id: input.userId,
      token_hash,
      stage,
      auth_method: authMethod,
      oidc_provider_id: authMethod === AUTH_METHOD.OIDC ? (input.oidcProviderId ?? null) : null,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      device_label: input.deviceLabel ? input.deviceLabel.slice(0, DEVICE_LABEL_MAX_LEN) : null,
      timezone: input.timezone ?? null,
      remember_me: eventDayEnd !== null,
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

  // Idle timeout only applies to `full` sessions. Partial stages (mfa_pending,
  // enrollment_required, ...) already carry a short absolute TTL
  // (MFA_PENDING_SESSION_TTL_MS) that serves the same purpose.
  if (session.stage === SESSION_STAGE.FULL) {
    const idleTimeoutMs = await resolveIdleTimeoutMs(prisma, session.user_id, session.remember_me);
    if (idleTimeoutMs !== null && now.getTime() - session.last_seen_at.getTime() >= idleTimeoutMs) {
      // Revoke permanently so a later idle-timeout increase cannot resurrect a
      // session that already exceeded its inactivity window.
      await prisma.session.updateMany({
        where: { id: session.id, revoked_at: null },
        data: { revoked_at: now },
      });
      return null;
    }
  }

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
  validated: { userId: string; session: { created_at: Date; auth_method: string } },
): Promise<boolean> {
  // Backup-code acknowledgment is mandatory before a full session is honored for
  // every auth method, including OIDC (IAM-002).
  if (await userHasUnacknowledgedBackupCodes(prisma, validated.userId)) return false;

  if (validated.session.auth_method === AUTH_METHOD.OIDC) return true;
  if (!(await userRequiresMfa(prisma, validated.userId))) return true;
  if (!(await userHasAnyConfirmedMfaMethod(prisma, validated.userId))) return false;

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
 * The MFA / backup-code policy {@link validateSession} applies to a full session, as a read-only
 * check for a long-lived connection (the check-in live stream) that holds an already-loaded row.
 */
export async function isFullSessionMfaPolicySatisfied(
  prisma: PrismaClient | Prisma.TransactionClient,
  session: { user_id: string; created_at: Date; auth_method: string },
): Promise<boolean> {
  return assertFullSessionMfaPolicy(prisma, { userId: session.user_id, session });
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
 *
 * Rotates the session token (fresh raw token + hash) on every promotion, not just the stage:
 * the token issued at password-login time must not still be the one that unlocks a later,
 * higher-privilege stage, or a cookie captured while it was still `enrollment_required`
 * (worthless on its own) silently becomes fully valid the moment the legitimate user finishes
 * MFA in the same browser (OWASP ASVS / Session Management Cheat Sheet: regenerate the session
 * identifier on every authentication-level change). Caller must set the new cookie from the
 * returned `rawToken` - the old one stops matching `token_hash` immediately.
 */
export async function promoteSessionToBackupCodesStep(
  prisma: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
  userId: string,
): Promise<{ rawToken: string } | null> {
  const now = new Date();
  const rawToken = generateToken();
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
      token_hash: hashToken(rawToken),
      expires_at: new Date(now.getTime() + BACKUP_CODES_STEP_TTL_MS),
      last_seen_at: now,
    },
  });
  return result.count === 1 ? { rawToken } : null;
}

/**
 * Advance a partial session after a successful step. Resolves the next stage via
 * {@link resolvePostMfaStage}: usually `full`, but kept constrained when the user
 * still owes backup-code acknowledgment (IAM-002) or a forced password change
 * (IAM-001). Returns the resulting stage and a rotated raw token, or `null` if the
 * session was ineligible. See {@link promoteSessionToBackupCodesStep} for why the
 * token must rotate here too - caller must set the new cookie from `rawToken`.
 */
export async function promoteSessionToFull(
  prisma: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
  userId: string,
  options: { mfaVerified?: boolean } = {},
): Promise<{ stage: SessionStage; rawToken: string; cookieMaxAgeSeconds?: number } | null> {
  const targetStage = await resolvePostMfaStage(prisma, userId);
  // TTL is resolved at promotion time (not cached from login) so SystemSettings changes apply immediately.
  const nonFullTtlMs =
    targetStage === SESSION_STAGE.BACKUP_CODES_REQUIRED
      ? BACKUP_CODES_STEP_TTL_MS
      : MFA_PENDING_SESSION_TTL_MS;
  const now = new Date();
  let ttlMs = nonFullTtlMs;
  let eventDayEnd: Date | null = null;
  if (targetStage === SESSION_STAGE.FULL) {
    // Decided here, not carried over from sign-in: the MFA or password-change step in between can
    // cross midnight of the event day, or an admin role can have been granted meanwhile.
    eventDayEnd = await resolveEventDaySessionEnd(prisma, userId, now);
    ttlMs = eventDayEnd
      ? eventDayEnd.getTime() - now.getTime()
      : await resolveFullTtlMs(prisma, userId);
  }
  const rawToken = generateToken();
  const result = await prisma.session.updateMany({
    where: {
      id: sessionId,
      user_id: userId,
      revoked_at: null,
      expires_at: { gt: now },
      // Excludes targetStage itself (`BACKUP_CODES_REQUIRED`/`CHANGE_PASSWORD_REQUIRED` are also
      // valid *source* stages) so a second, racing call that resolves the same target no longer
      // matches a row a concurrent call already moved there - it would otherwise re-rotate the
      // token a second time and silently invalidate the cookie the first call already returned.
      stage: {
        in: [
          SESSION_STAGE.MFA_PENDING,
          SESSION_STAGE.ENROLLMENT_REQUIRED,
          SESSION_STAGE.BACKUP_CODES_REQUIRED,
          SESSION_STAGE.CHANGE_PASSWORD_REQUIRED,
        ].filter((stage) => stage !== targetStage),
      },
    },
    data: {
      stage: targetStage,
      token_hash: hashToken(rawToken),
      expires_at: new Date(now.getTime() + ttlMs),
      remember_me: eventDayEnd !== null,
      last_seen_at: now,
      // Only the MFA completion callers pass this, right after the code/assertion verified.
      ...(options.mfaVerified ? { mfa_verified_at: now } : {}),
    },
  });
  if (result.count !== 1) return null;
  return {
    stage: targetStage,
    rawToken,
    cookieMaxAgeSeconds: eventDayEnd ? Math.floor(ttlMs / 1000) : undefined,
  };
}

/** How long after a completed MFA step a session may still remember the device. */
export const MFA_RECENT_WINDOW_MS = 5 * 60 * 1000;

/** Whether this session itself completed MFA within {@link MFA_RECENT_WINDOW_MS}. False for OIDC,
 * passkey-login and trusted-device sessions (they never set `mfa_verified_at`) and for revoked or
 * expired sessions. */
export async function isMfaRecentlyVerified(
  prisma: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await prisma.session.findFirst({
    where: {
      id: sessionId,
      revoked_at: null,
      expires_at: { gt: now },
      mfa_verified_at: { gte: new Date(now.getTime() - MFA_RECENT_WINDOW_MS) },
    },
    select: { id: true },
  });
  return row !== null;
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
