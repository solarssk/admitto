import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@admitto/db";
import { z } from "zod";
import {
  cancelPendingTotpEnrollment,
  confirmTotpEnrollment,
  getOrStartTotpEnrollment,
  hashPassword,
  isPasswordTooCommon,
  markBackupCodesAcknowledged,
  revokeAllTrustedDevicesForUser,
  revokeOtherSessions,
  revokeSession,
  runInTransaction,
  userHasConfirmedTotp,
  userRequiresMfaStepUp,
  verifyPasswordOrDummy,
  verifyTotpOrRecoveryCode,
} from "@admitto/auth";
import { checkMfaVerifyRateLimit, resolveMfaClientIp } from "../auth/mfa-rate-limit.js";
import { resolveIpLocation } from "../rate-limit/ip-location.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import {
  isSupportedLocale,
  sanitizePreferredLocale,
} from "@admitto/shared";
import { writeAdminAuditLog, type OpsAuditContext } from "@admitto/tickets";
import { adminAuditFromContext } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

function hasLocalPassword(passwordHash: string | null): boolean {
  return passwordHash !== null;
}

/** Revoke every other session for `userId`, or all of them if no current session to keep. */
async function revokeSessionsExcludingCurrent(
  tx: Prisma.TransactionClient,
  userId: string,
  currentSessionId: string | undefined,
): Promise<number> {
  if (currentSessionId) {
    return revokeOtherSessions(tx, userId, currentSessionId);
  }
  const revoked = await tx.session.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  return revoked.count;
}

type StepUpFailureReason = "unauthorized" | "totp_required" | "invalid_totp";

/**
 * Advisory pre-check + rate-limit for a step-up-gated self-service action (password change,
 * MFA reset): lets the common case fail fast (400/429) without opening a transaction, and keeps
 * the rate limiter's Redis round-trip out of a held Postgres connection. NOT the security gate —
 * callers must still re-check via `checkStepUpInTransaction` inside their own transaction,
 * immediately before the sensitive write, so this pre-check can only make a request fail earlier
 * or the same way, never skip the authoritative check.
 */
async function stepUpPreflight(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  userId: string,
  currentSessionId: string | undefined,
  code: string | undefined,
  rateLimitAction: string,
): Promise<Response | null> {
  if (await userRequiresMfaStepUp(db, userId)) {
    if (!currentSessionId) return c.json({ error: "unauthorized" }, 401);
    if (!code) return c.json({ code: "totp_required" }, 400);
  }
  if (code && currentSessionId) {
    const ip = resolveMfaClientIp(c);
    if (!(await checkMfaVerifyRateLimit(rateLimitStore, currentSessionId, ip, code, rateLimitAction))) {
      return c.json({ error: "too many requests" }, 429);
    }
  }
  return null;
}

/**
 * Authoritative step-up check, read via `tx` rather than the pre-check's `db`, so a role change
 * racing this request can't let a password-only call skip step-up entirely.
 */
async function checkStepUpInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  currentSessionId: string | undefined,
  code: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: StepUpFailureReason }> {
  if (!(await userRequiresMfaStepUp(tx, userId))) return { ok: true };
  if (!currentSessionId) return { ok: false, reason: "unauthorized" };
  if (!code) return { ok: false, reason: "totp_required" };
  if (!(await verifyTotpOrRecoveryCode(tx, userId, code))) {
    return { ok: false, reason: "invalid_totp" };
  }
  return { ok: true };
}

function stepUpFailureResponse(c: Context, reason: StepUpFailureReason): Response {
  switch (reason) {
    case "unauthorized":
      return c.json({ error: "unauthorized" }, 401);
    case "totp_required":
      return c.json({ code: "totp_required" }, 400);
    case "invalid_totp":
      return c.json({ code: "invalid_totp" }, 401);
  }
}

/**
 * Runs `body` inside a step-up-gated transaction, shared by every self-service action that
 * requires a TOTP/recovery-code step-up (password change, MFA reset): `stepUpPreflight` fails
 * the common case fast (400/429), outside any transaction; `orgId`/`audit` are then resolved via
 * the root `db` client, also before the transaction opens, so that query never runs from inside
 * an active `tx` callback (which would need a second pooled connection and deadlock on a
 * single-connection deployment, e.g. `connection_limit=1`); only once the authoritative
 * in-transaction step-up check has passed does `body` run and do the actual sensitive write.
 */
async function withStepUpGate<T>(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  params: {
    userId: string;
    currentSessionId: string | undefined;
    rawCode: string | undefined;
    rateLimitAction: string;
  },
  body: (tx: Prisma.TransactionClient, orgId: string, audit: OpsAuditContext) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  const { userId, currentSessionId, rateLimitAction } = params;
  const code = params.rawCode?.trim();
  const preflightDenied = await stepUpPreflight(
    c,
    db,
    rateLimitStore,
    userId,
    currentSessionId,
    code,
    rateLimitAction,
  );
  if (preflightDenied) return { ok: false, response: preflightDenied };

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);

  const result = await runInTransaction(db, async (tx) => {
    const step = await checkStepUpInTransaction(tx, userId, currentSessionId, code);
    if (!step.ok) return step;
    return { ok: true as const, value: await body(tx, orgId, audit) };
  });

  if (!result.ok) return { ok: false, response: stepUpFailureResponse(c, result.reason) };
  return { ok: true, value: result.value };
}

const ROLE_PRIORITY: Record<string, number> = { superadmin: 3, admin: 2, operator: 1 };

function highestRole(assignments: { role: string }[]): string {
  if (!assignments.length) return "operator";
  return assignments.reduce(
    (best, a) => ((ROLE_PRIORITY[a.role] ?? 0) > (ROLE_PRIORITY[best] ?? 0) ? a.role : best),
    "operator",
  );
}

function serializeAccountSession(
  row: {
    id: string;
    user_id: string;
    device_label: string | null;
    ip: string | null;
    user_agent: string | null;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date;
    auth_method: string;
    stage: string;
    user: {
      email: string;
      display_name: string | null;
      role_assignments: { role: string }[];
    };
  },
  currentSessionId: string | undefined,
) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user.email,
    userDisplayName: row.user.display_name ?? null,
    role: highestRole(row.user.role_assignments),
    deviceLabel: row.device_label,
    ip: row.ip,
    country: resolveIpLocation(row.ip),
    userAgent: row.user_agent,
    loginAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    authMethod: row.auth_method,
    stage: row.stage,
    isCurrent: !!currentSessionId && row.id === currentSessionId,
  };
}

/** GET /api/account — own profile, roles (read-only), MFA methods. No secrets. */
export async function handleGetAccount(c: Context, db: PrismaClient): Promise<Response> {
  const userId = c.get("auth").userId;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      display_name: true,
      preferred_locale: true,
      is_active: true,
      must_change_password: true,
      password_hash: true,
    },
  });
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const [assignments, oidcGrants, mfaMethods] = await Promise.all([
    db.roleAssignment.findMany({
      where: { user_id: userId },
      select: { id: true, role: true, scope_type: true, scope_id: true },
    }),
    db.oidcRoleGrant.findMany({
      where: { user_id: userId },
      select: { role_assignment_id: true },
    }),
    db.userMfaMethod.findMany({
      where: { user_id: userId },
      select: { type: true, confirmed_at: true, last_used_at: true },
    }),
  ]);

  const oidcAssignmentIds = new Set(oidcGrants.map((g) => g.role_assignment_id));

  return c.json({
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    preferred_locale: sanitizePreferredLocale(user.preferred_locale),
    is_active: user.is_active,
    must_change_password: user.must_change_password,
    has_local_password: hasLocalPassword(user.password_hash),
    roles: assignments.map((a) => ({
      id: a.id,
      role: a.role,
      scope_type: a.scope_type,
      scope_id: a.scope_id,
      is_oidc: oidcAssignmentIds.has(a.id),
    })),
    mfa_methods: mfaMethods.map((m) => ({
      type: m.type,
      confirmed: m.confirmed_at !== null,
      last_used_at: m.last_used_at?.toISOString() ?? null,
    })),
  });
}

const profileSchema = z
  .object({
    display_name: z.string().max(120).optional(),
    preferred_locale: z
      .string()
      .max(20)
      .refine((v) => isSupportedLocale(v), { message: "Unsupported locale" })
      .nullable()
      .optional(),
  })
  .strict()
  .refine((d) => d.display_name !== undefined || d.preferred_locale !== undefined, {
    message: "Nothing to update",
  });

/** PATCH /api/account/profile — update display name and/or preferred locale (no re-auth). */
export async function handlePatchAccountProfile(c: Context, db: PrismaClient): Promise<Response> {
  const userId = c.get("auth").userId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);

  const data: { display_name?: string | null; preferred_locale?: string | null } = {};
  if (parsed.data.display_name !== undefined) {
    data.display_name = parsed.data.display_name.trim() || null;
  }
  if (parsed.data.preferred_locale !== undefined) {
    data.preferred_locale = parsed.data.preferred_locale;
  }

  const updated = await db.user.update({
    where: { id: userId },
    data,
    select: { display_name: true, preferred_locale: true },
  });

  return c.json({
    display_name: updated.display_name,
    preferred_locale: sanitizePreferredLocale(updated.preferred_locale),
  });
}

const passwordSchema = z
  .object({
    current_password: z.string(),
    new_password: z.string().min(12),
    new_password_confirm: z.string(),
    code: z.string().optional(),
  })
  .strict();

/**
 * PATCH /api/account/password — re-auth required; revokes other sessions.
 * Requires a TOTP/recovery-code step-up (mirroring `handlePostMfaReset`) whenever the user's
 * role requires MFA and TOTP is confirmed — password alone must not be enough to change the
 * password (and lock the legitimate owner out) on an MFA-required account.
 */
export async function handlePatchAccountPassword(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  const auth = c.get("auth");
  const userId = auth.userId;
  const currentSessionId = auth.sessionId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);

  const { current_password, new_password, new_password_confirm } = parsed.data;
  if (new_password !== new_password_confirm) {
    return c.json({ error: "passwords do not match" }, 400);
  }
  if (isPasswordTooCommon(new_password)) {
    return c.json({ code: "password_too_common", error: "password_too_common" }, 400);
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { password_hash: true },
  });
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (!hasLocalPassword(user.password_hash)) {
    return c.json({ code: "no_local_password" }, 400);
  }

  const passwordOk = await verifyPasswordOrDummy(current_password, user.password_hash);
  if (!passwordOk) return c.json({ code: "wrong_password" }, 401);

  // The new password is only hashed once step-up has passed (or wasn't required), so a
  // totp_required/invalid_totp/rate-limited request never pays for the hash.
  const gated = await withStepUpGate(
    c,
    db,
    rateLimitStore,
    { userId, currentSessionId, rawCode: parsed.data.code, rateLimitAction: "account-password" },
    async (tx, orgId, audit) => {
      const password_hash = await hashPassword(new_password);
      await tx.user.update({
        where: { id: userId },
        data: { password_hash, must_change_password: false },
      });
      const revokedCount = await revokeSessionsExcludingCurrent(tx, userId, currentSessionId);
      await writeAdminAuditLog(tx, {
        organizationId: orgId,
        actorUserId: audit.operator ?? userId,
        sessionId: audit.sessionId,
        ip: audit.ip,
        timezone: audit.timezone,
        actionType: "account_password_changed",
        metadata: { sessionsRevoked: revokedCount },
      });
      return revokedCount;
    },
  );

  if (!gated.ok) return gated.response;
  return c.json({ sessions_revoked: gated.value });
}

/** GET /api/account/sessions — own active sessions only. */
export async function handleGetAccountSessions(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  const rows = await db.session.findMany({
    where: {
      user_id: auth.userId,
      revoked_at: null,
      expires_at: { gt: new Date() },
    },
    include: {
      user: {
        select: {
          email: true,
          display_name: true,
          role_assignments: { select: { role: true } },
        },
      },
    },
    orderBy: { last_seen_at: "desc" },
  });
  return c.json({ sessions: rows.map((s) => serializeAccountSession(s, auth.sessionId)) });
}

/** DELETE /api/account/sessions/:sessionId — revoke own session (not current). */
export async function handleDeleteAccountSession(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  const sessionId = c.req.param("sessionId") ?? "";
  if (!sessionId) return c.json({ error: "session id required" }, 400);

  if (auth.sessionId && sessionId === auth.sessionId) {
    return c.json({ code: "cannot_revoke_current" }, 409);
  }

  const row = await db.session.findUnique({
    where: { id: sessionId },
    select: { user_id: true, revoked_at: true, expires_at: true },
  });
  if (!row) return c.json({}, 200);
  if (row.user_id !== auth.userId) return c.json({ error: "forbidden" }, 403);
  // Already revoked, or already expired (stale sessions-list page): no live session was cut
  // short, so no audit row either.
  if (row.revoked_at || row.expires_at <= new Date()) return c.json({}, 200);

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await runInTransaction(db, async (tx) => {
    // Re-check inside the transaction: two concurrent DELETEs can both pass the read above
    // before either commits. Only the one that actually revoked the session gets audited.
    const revoked = await revokeSession(tx, sessionId);
    if (!revoked) return;
    await writeAdminAuditLog(tx, {
      organizationId: orgId,
      actorUserId: audit.operator ?? auth.userId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "account_session_revoked",
      metadata: { sessionId },
    });
  });
  return c.json({}, 200);
}

/** POST /api/account/mfa/totp/enroll — start or resume TOTP enrollment (local-password accounts only). */
export async function handlePostMfaEnroll(c: Context, db: PrismaClient): Promise<Response> {
  const userId = c.get("auth").userId;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { password_hash: true },
  });
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (!hasLocalPassword(user.password_hash)) {
    return c.json({ code: "no_local_password" }, 400);
  }

  if (await userHasConfirmedTotp(db, userId)) {
    return c.json({ code: "already_enrolled" }, 409);
  }

  const result = await getOrStartTotpEnrollment(db, userId);
  if (!result) return c.json({ code: "already_enrolled" }, 409);

  return c.json({
    otpauthUri: result.otpauthUri,
    backupCodes: result.backupCodes,
    backupCodesAlreadyShown: result.backupCodesAlreadyShown ?? false,
  });
}

/** DELETE /api/account/mfa/totp/enroll — cancel (abort) pending TOTP enrollment. */
export async function handleDeleteMfaEnroll(c: Context, db: PrismaClient): Promise<Response> {
  const userId = c.get("auth").userId;
  await cancelPendingTotpEnrollment(db, userId);
  return c.json({ ok: true });
}

const confirmSchema = z.object({ code: z.string().min(1) }).strict();

/** POST /api/account/mfa/totp/confirm — confirm pending TOTP enrollment. */
export async function handlePostMfaConfirm(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  const auth = c.get("auth");
  const userId = auth.userId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);

  const code = parsed.data.code.trim();
  const sessionId = auth.sessionId;
  if (!sessionId) return c.json({ error: "unauthorized" }, 401);

  const ip = resolveMfaClientIp(c);
  if (!(await checkMfaVerifyRateLimit(rateLimitStore, sessionId, ip, code, "mfa-confirm"))) {
    return c.json({ error: "too many requests" }, 429);
  }

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);

  const ok = await runInTransaction(db, async (tx) => {
    const confirmed = await confirmTotpEnrollment(tx, userId, code);
    if (!confirmed) return false;

    // Self-service enroll already returned backup codes to the client (unlike the
    // login-time flow's separate acknowledgment step) — mark them acknowledged now so
    // this already-`full` session isn't rejected by the backup-codes gate (IAM-002) on
    // its very next request.
    await markBackupCodesAcknowledged(tx, userId);
    await writeAdminAuditLog(tx, {
      organizationId: orgId,
      actorUserId: audit.operator ?? userId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "account_mfa_enrolled",
    });
    return true;
  });
  if (!ok) return c.json({ code: "invalid_code" }, 400);

  return c.json({ ok: true });
}

const resetSchema = z.object({ password: z.string(), code: z.string().optional() }).strict();

/**
 * POST /api/account/mfa/reset — re-auth, remove MFA, revoke other sessions (keeps current).
 * Requires a TOTP/recovery-code step-up (mirroring `verifyOidcLinkStepUp`) whenever the user's
 * role requires MFA and TOTP is confirmed — password alone must not be able to strip MFA from an
 * MFA-required account.
 */
export async function handlePostMfaReset(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  const auth = c.get("auth");
  const userId = auth.userId;
  const currentSessionId = auth.sessionId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { password_hash: true },
  });
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (!hasLocalPassword(user.password_hash)) {
    return c.json({ code: "no_local_password" }, 400);
  }

  const passwordOk = await verifyPasswordOrDummy(parsed.data.password, user.password_hash);
  if (!passwordOk) return c.json({ code: "wrong_password" }, 401);

  // A recovery code is consumed as soon as it's checked, so if the reset work below fails for
  // any other reason, the whole transaction (including that consumption) rolls back rather than
  // burning a one-time code for a reset that never actually happened.
  const gated = await withStepUpGate(
    c,
    db,
    rateLimitStore,
    { userId, currentSessionId, rawCode: parsed.data.code, rateLimitAction: "mfa-reset" },
    async (tx, orgId, audit) => {
      const mfaDeleted = await tx.userMfaMethod.deleteMany({ where: { user_id: userId } });
      const devicesRevoked = await revokeAllTrustedDevicesForUser(tx, userId);
      const revokedCount = await revokeSessionsExcludingCurrent(tx, userId, currentSessionId);
      // Gate on any real effect, not just an MFA method actually being deleted: a
      // no-MFA-enrolled account calling this still revokes trusted devices and other
      // sessions, which is itself security-relevant and must stay audited. This still
      // suppresses the duplicate audit on a true no-op (two concurrent resets, or a retry
      // after the state is already fully cleared) — that case has all three counts at 0.
      if (mfaDeleted.count > 0 || devicesRevoked > 0 || revokedCount > 0) {
        await writeAdminAuditLog(tx, {
          organizationId: orgId,
          actorUserId: audit.operator ?? userId,
          sessionId: audit.sessionId,
          ip: audit.ip,
          timezone: audit.timezone,
          actionType: "account_mfa_reset",
          metadata: { sessionsRevoked: revokedCount },
        });
      }
      return revokedCount;
    },
  );

  if (!gated.ok) return gated.response;
  return c.json({ ok: true, sessions_revoked: gated.value });
}
