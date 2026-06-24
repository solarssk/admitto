import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  confirmTotpEnrollment,
  getOrStartTotpEnrollment,
  hashPassword,
  resetUserMfa,
  revokeSession,
  userHasConfirmedTotp,
  verifyPasswordOrDummy,
} from "@admitto/auth";

function hasLocalPassword(passwordHash: string | null): boolean {
  return passwordHash !== null;
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
    user: { email: string; display_name: string | null };
  },
  currentSessionId: string | undefined,
) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user.email,
    userDisplayName: row.user.display_name ?? null,
    role: "operator" as const,
    deviceLabel: row.device_label,
    ip: row.ip,
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

const profileSchema = z.object({ display_name: z.string().max(120) }).strict();

/** PATCH /api/account/profile — update display name (no re-auth). */
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

  const display_name = parsed.data.display_name.trim() || null;
  await db.user.update({ where: { id: userId }, data: { display_name } });
  return c.json({ display_name });
}

const passwordSchema = z
  .object({
    current_password: z.string(),
    new_password: z.string().min(12),
    new_password_confirm: z.string(),
  })
  .strict();

/** PATCH /api/account/password — re-auth required; revokes other sessions. */
export async function handlePatchAccountPassword(c: Context, db: PrismaClient): Promise<Response> {
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

  const password_hash = await hashPassword(new_password);
  await db.user.update({
    where: { id: userId },
    data: { password_hash, must_change_password: false },
  });

  const revokeWhere: { user_id: string; revoked_at: null; id?: { not: string } } = {
    user_id: userId,
    revoked_at: null,
  };
  if (currentSessionId) revokeWhere.id = { not: currentSessionId };

  const revoked = await db.session.updateMany({
    where: revokeWhere,
    data: { revoked_at: new Date() },
  });

  return c.json({ sessions_revoked: revoked.count });
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
    include: { user: { select: { email: true, display_name: true } } },
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
    select: { user_id: true },
  });
  if (!row) return c.json({}, 200);
  if (row.user_id !== auth.userId) return c.json({ error: "forbidden" }, 403);

  await revokeSession(db, sessionId);
  return c.json({}, 200);
}

/** POST /api/account/mfa/totp/enroll — start or resume TOTP enrollment (FULL session). */
export async function handlePostMfaEnroll(c: Context, db: PrismaClient): Promise<Response> {
  const userId = c.get("auth").userId;
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

const confirmSchema = z.object({ code: z.string().min(1) }).strict();

/** POST /api/account/mfa/totp/confirm — confirm pending TOTP enrollment. */
export async function handlePostMfaConfirm(c: Context, db: PrismaClient): Promise<Response> {
  const userId = c.get("auth").userId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);

  const ok = await confirmTotpEnrollment(db, userId, parsed.data.code.trim());
  if (!ok) return c.json({ code: "invalid_code" }, 400);
  return c.json({ ok: true });
}

const resetSchema = z.object({ password: z.string() }).strict();

/** POST /api/account/mfa/reset — re-auth + remove all MFA (revokes all sessions). */
export async function handlePostMfaReset(c: Context, db: PrismaClient): Promise<Response> {
  const userId = c.get("auth").userId;

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

  await resetUserMfa(db, userId);
  return c.json({ ok: true });
}
