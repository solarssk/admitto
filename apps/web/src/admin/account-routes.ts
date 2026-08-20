import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@admitto/db";
import { z } from "zod";
import {
  cancelPendingTotpEnrollment,
  confirmTotpEnrollment,
  findEnabledOidcProviders,
  getOrStartTotpEnrollment,
  hashPassword,
  isPasswordTooCommon,
  passwordTooCommonJsonBody,
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
import { checkAccountPasswordRateLimit } from "../rate-limit/policies.js";
import { resolveIpLocation } from "../rate-limit/ip-location.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import {
  isSupportedLocale,
  sanitizePreferredLocale,
  sanitizePreferredTimeFormat,
} from "@admitto/shared";
import { writeAdminAuditLog, type OpsAuditContext } from "@admitto/tickets";
import { PASSWORD_MIN_LENGTH } from "@admitto/auth/constants";
import { adminAuditFromContext } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

function hasLocalPassword(passwordHash: string | null): boolean {
  return passwordHash !== null;
}

/** Verify the caller's own current password before a sensitive local-credential action (account
 * password change, MFA reset via password) - rejects SSO-managed accounts (no local password to
 * check against), rate-limits attempts via checkAccountPasswordRateLimit, and verifies the
 * candidate against the stored hash. Returns the failure Response to short-circuit on, or null
 * once verification passed. */
async function verifyCurrentPasswordOrFail(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  userId: string,
  candidatePassword: string,
): Promise<Response | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { password_hash: true } });
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (!hasLocalPassword(user.password_hash)) {
    return c.json({ code: "no_local_password" }, 400);
  }

  const passwordCheckIp = resolveMfaClientIp(c);
  if (!(await checkAccountPasswordRateLimit(rateLimitStore, userId, passwordCheckIp))) {
    return c.json({ error: "too many requests" }, 429);
  }

  const passwordOk = await verifyPasswordOrDummy(candidatePassword, user.password_hash);
  if (!passwordOk) return c.json({ code: "wrong_password" }, 401);
  return null;
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
  params: {
    userId: string;
    currentSessionId: string | undefined;
    code: string | undefined;
    rateLimitAction: string;
    forceRequired?: boolean;
  },
): Promise<Response | null> {
  const { userId, currentSessionId, code, rateLimitAction, forceRequired } = params;
  if (forceRequired || (await userRequiresMfaStepUp(db, userId))) {
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
 * racing this request can't let a password-only call skip step-up entirely. `forceRequired`
 * bypasses `userRequiresMfaStepUp`'s own policy check (`userRequiresMfa && userHasConfirmedTotp`)
 * entirely - needed by callers (users-routes.ts's superadmin-on-superadmin reset) for whom
 * step-up must be unconditional: if the instance's configurable `mfa_required_roles` setting
 * doesn't include "superadmin", `userRequiresMfa` alone would return false for the actor despite
 * them having a confirmed TOTP method, and this whole check would silently no-op - exactly the
 * bypass a compromised session could exploit regardless of that setting.
 */
async function checkStepUpInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  currentSessionId: string | undefined,
  code: string | undefined,
  forceRequired = false,
): Promise<{ ok: true } | { ok: false; reason: StepUpFailureReason }> {
  if (!forceRequired && !(await userRequiresMfaStepUp(tx, userId))) return { ok: true };
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
 *
 * Exported for reuse by users-routes.ts's admin-assisted MFA/password reset endpoints, which
 * gate the ACTOR's own step-up (not the target's) when the reset target is another superadmin -
 * always passing `forceRequired: true`, since that protection must hold regardless of the
 * instance's configurable `mfa_required_roles` policy (see checkStepUpInTransaction's docstring).
 */
export async function withStepUpGate<T>(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  params: {
    userId: string;
    currentSessionId: string | undefined;
    rawCode: string | undefined;
    rateLimitAction: string;
    forceRequired?: boolean;
  },
  body: (tx: Prisma.TransactionClient, orgId: string, audit: OpsAuditContext) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  const { userId, currentSessionId, rateLimitAction, forceRequired } = params;
  const code = params.rawCode?.trim();
  const preflightDenied = await stepUpPreflight(c, db, rateLimitStore, {
    userId,
    currentSessionId,
    code,
    rateLimitAction,
    forceRequired,
  });
  if (preflightDenied) return { ok: false, response: preflightDenied };

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);

  const result = await runInTransaction(db, async (tx) => {
    const step = await checkStepUpInTransaction(tx, userId, currentSessionId, code, forceRequired);
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
    timezone: string | null;
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
    timezone: row.timezone,
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
      preferred_time_format: true,
      is_active: true,
      must_change_password: true,
      password_hash: true,
      phone_country_code: true,
      phone_number: true,
    },
  });
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const [assignments, oidcGrants, mfaMethods, externalIdentities] = await Promise.all([
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
    db.externalIdentity.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        provider_id: true,
        linked_at: true,
        provider: { select: { display_name: true, provider_type: true } },
      },
    }),
  ]);

  const oidcAssignmentIds = new Set(oidcGrants.map((g) => g.role_assignment_id));

  // Resolve each assignment's scope_id to the human label shown on the account page (event
  // title / organization name) - only the specific events/organizations this account is already
  // assigned to, never a full list, so this needs no extra permission beyond viewing your own
  // account.
  const eventScopeIds = assignments.filter((a) => a.scope_type === "event" && a.scope_id).map((a) => a.scope_id!);
  const orgScopeIds = assignments.filter((a) => a.scope_type === "organization" && a.scope_id).map((a) => a.scope_id!);
  const [scopedEvents, scopedOrgs] = await Promise.all([
    eventScopeIds.length ? db.event.findMany({ where: { id: { in: eventScopeIds } }, select: { id: true, title: true } }) : [],
    orgScopeIds.length ? db.organization.findMany({ where: { id: { in: orgScopeIds } }, select: { id: true, name: true } }) : [],
  ]);
  const eventTitleById = new Map(scopedEvents.map((e) => [e.id, e.title]));
  const orgNameById = new Map(scopedOrgs.map((o) => [o.id, o.name]));

  function scopeLabel(a: (typeof assignments)[number]): string | null {
    if (a.scope_type === "event") return (a.scope_id && eventTitleById.get(a.scope_id)) ?? null;
    if (a.scope_type === "organization") return (a.scope_id && orgNameById.get(a.scope_id)) ?? null;
    return null;
  }

  // Enabled providers not already linked to this account - the "Connect SSO" list. Same source
  // the public login page's own SSO buttons use (loadLoginSsoProviders), just filtered against
  // this account's existing external_identities instead of shown unconditionally.
  const linkedProviderIds = new Set(externalIdentities.map((ei) => ei.provider_id));
  const enabledProviders = await findEnabledOidcProviders(db);
  const availableProviders = enabledProviders.filter((p) => !linkedProviderIds.has(p.id));

  return c.json({
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    preferred_locale: sanitizePreferredLocale(user.preferred_locale),
    preferred_time_format: sanitizePreferredTimeFormat(user.preferred_time_format),
    is_active: user.is_active,
    must_change_password: user.must_change_password,
    has_local_password: hasLocalPassword(user.password_hash),
    phone_country_code: user.phone_country_code,
    phone_number: user.phone_number,
    roles: assignments.map((a) => ({
      id: a.id,
      role: a.role,
      scope_type: a.scope_type,
      scope_id: a.scope_id,
      scope_label: scopeLabel(a),
      is_oidc: oidcAssignmentIds.has(a.id),
    })),
    mfa_methods: mfaMethods.map((m) => ({
      type: m.type,
      confirmed: m.confirmed_at !== null,
      last_used_at: m.last_used_at?.toISOString() ?? null,
    })),
    external_identities: externalIdentities.map((ei) => ({
      id: ei.id,
      provider_id: ei.provider_id,
      provider_display_name: ei.provider.display_name,
      provider_type: ei.provider.provider_type,
      linked_at: ei.linked_at.toISOString(),
    })),
    available_identity_providers: availableProviders.map((p) => ({ id: p.id, display_name: p.display_name })),
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
    preferred_time_format: z.enum(["12h", "24h"]).nullable().optional(),
    // Both nullable (not just optional) - the account page always sends one or the other for
    // both phone fields, using null to mean "clear it", same convention as the admin-side
    // PATCH /api/admin/users/:id (buildPatchUserData in users-routes.ts).
    phone_country_code: z.string().max(8).nullable().optional(),
    phone_number: z.string().max(40).nullable().optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.display_name !== undefined ||
      d.preferred_locale !== undefined ||
      d.preferred_time_format !== undefined ||
      d.phone_country_code !== undefined ||
      d.phone_number !== undefined,
    { message: "Nothing to update" },
  );

/** PATCH /api/account/profile — update display name, date/time display preferences, and/or phone (no re-auth). */
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

  const data: {
    display_name?: string | null;
    preferred_locale?: string | null;
    preferred_time_format?: "12h" | "24h" | null;
    phone_country_code?: string | null;
    phone_number?: string | null;
  } = {};
  if (parsed.data.display_name !== undefined) {
    data.display_name = parsed.data.display_name.trim() || null;
  }
  if (parsed.data.preferred_locale !== undefined) {
    data.preferred_locale = parsed.data.preferred_locale;
  }
  if (parsed.data.preferred_time_format !== undefined) {
    data.preferred_time_format = parsed.data.preferred_time_format;
  }
  if (parsed.data.phone_country_code !== undefined) {
    data.phone_country_code = parsed.data.phone_country_code?.trim() || null;
  }
  if (parsed.data.phone_number !== undefined) {
    data.phone_number = parsed.data.phone_number?.trim() || null;
  }

  const updated = await db.user.update({
    where: { id: userId },
    data,
    select: { display_name: true, preferred_locale: true, preferred_time_format: true, phone_country_code: true, phone_number: true },
  });

  return c.json({
    display_name: updated.display_name,
    preferred_locale: sanitizePreferredLocale(updated.preferred_locale),
    preferred_time_format: sanitizePreferredTimeFormat(updated.preferred_time_format),
    phone_country_code: updated.phone_country_code,
    phone_number: updated.phone_number,
  });
}

const unlinkExternalIdentitySchema = z
  .object({
    new_password: z.string(),
    current_password: z.string().optional(),
    code: z.string().optional(),
  })
  .strict();

type UnlinkDenialCode =
  | "unauthorized"
  | "provider_managed_roles_exist"
  | "current_password_required"
  | "wrong_password"
  | "totp_required"
  | "invalid_totp"
  | "insufficient_verification";

const UNLINK_DENIAL_STATUS: Record<UnlinkDenialCode, 401 | 409 | 400> = {
  unauthorized: 401,
  provider_managed_roles_exist: 409,
  current_password_required: 400,
  wrong_password: 401,
  totp_required: 400,
  invalid_totp: 401,
  insufficient_verification: 400,
};

/**
 * A stolen session alone must never be enough to replace an account's only credential - unlike
 * `withStepUpGate`'s role-gated check (a no-op for roles that don't require MFA), self-unlink
 * always demands one proof: the TOTP/recovery code if the account has it confirmed (a strictly
 * stronger check than the role-gated one, since it fires regardless of role), otherwise the
 * current local password. An account with neither - a JIT-provisioned SSO user who never set a
 * password or enrolled MFA - has no universally available proof to offer, so the action is
 * blocked rather than silently allowed through session validity alone.
 */
async function verifySelfUnlinkProof(
  tx: Prisma.TransactionClient,
  userId: string,
  passwordHash: string | null,
  proof: { current_password: string | undefined; code: string | undefined },
): Promise<{ ok: true } | { ok: false; code: UnlinkDenialCode }> {
  if (await userHasConfirmedTotp(tx, userId)) {
    if (!proof.code) return { ok: false, code: "totp_required" };
    if (!(await verifyTotpOrRecoveryCode(tx, userId, proof.code))) {
      return { ok: false, code: "invalid_totp" };
    }
    return { ok: true };
  }
  if (hasLocalPassword(passwordHash)) {
    if (!proof.current_password) return { ok: false, code: "current_password_required" };
    if (!(await verifyPasswordOrDummy(proof.current_password, passwordHash))) {
      return { ok: false, code: "wrong_password" };
    }
    return { ok: true };
  }
  return { ok: false, code: "insufficient_verification" };
}

/**
 * DELETE /api/account/external-identity — self-service SSO unlink.
 *
 * Adapted from the admin-only `handleDeleteUserExternalIdentity` (users-routes.ts), not by
 * dropping its actorId guard - that guard exists to stop an admin unlinking *their own* SSO
 * through the admin route; here the caller unlinking their own identity is the entire point, so
 * there's no equivalent guard to drop, and the admin route's other invariants don't carry over
 * cleanly either:
 * - Session revocation excludes the caller's own current session (`revokeSessionsExcludingCurrent`,
 *   same helper `handlePatchAccountPassword` uses) instead of revoking every session - the admin
 *   route revokes all of them because the admin isn't the one using the target's session.
 * - `must_change_password` is cleared, same as `handlePatchAccountPassword` - the caller just
 *   chose their own password deliberately, unlike the admin flow where an admin sets a temporary
 *   password for someone else.
 * - Gated by `verifySelfUnlinkProof` rather than `withStepUpGate` - self-unlink must demand proof
 *   unconditionally (see that function's own comment), not only for roles that require MFA.
 * - Refuses to run at all while any role assignment is still owned by an OIDC group sync
 *   (`OidcRoleGrant`): converting it to a manually-owned role would let the caller unilaterally
 *   keep IdP-managed access that a future group sync would otherwise revoke. An admin has to
 *   remove the grant (or the group membership) first.
 *
 * `new_password` is still always required, same as the admin route: unlinking SSO always means
 * consciously picking the local password this account will use going forward, whether or not one
 * already existed - not silently reusing whatever was there before.
 */
/**
 * Rate-limits the two proof paths self-unlink accepts, independently of each other and before
 * either is actually verified by `verifySelfUnlinkProof`: a caller who supplied `current_password`
 * must not be able to grind guesses just by omitting `code`, or vice versa.
 */
async function unlinkSsoPreflightRateLimit(
  c: Context,
  rateLimitStore: RateLimitStore,
  userId: string,
  currentSessionId: string | undefined,
  code: string | undefined,
  currentPassword: string | undefined,
): Promise<Response | null> {
  if (code) {
    if (!currentSessionId) return c.json({ error: "unauthorized" }, 401);
    const ip = resolveMfaClientIp(c);
    if (!(await checkMfaVerifyRateLimit(rateLimitStore, currentSessionId, ip, code, "account-external-identity"))) {
      return c.json({ error: "too many requests" }, 429);
    }
  }
  if (currentPassword) {
    const ip = resolveMfaClientIp(c);
    if (!(await checkAccountPasswordRateLimit(rateLimitStore, userId, ip))) {
      return c.json({ error: "too many requests" }, 429);
    }
  }
  return null;
}

export async function handleDeleteAccountExternalIdentity(
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
  const parsed = unlinkExternalIdentitySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);

  const linked = await db.externalIdentity.findMany({
    where: { user_id: userId },
    select: { id: true },
  });
  if (linked.length === 0) return c.json({ error: "not_found" }, 404);

  const newPassword = parsed.data.new_password;
  if (newPassword.length < PASSWORD_MIN_LENGTH) return c.json({ error: "invalid_request" }, 400);
  if (isPasswordTooCommon(newPassword)) return c.json(passwordTooCommonJsonBody(), 400);

  const code = parsed.data.code?.trim();
  const rateLimited = await unlinkSsoPreflightRateLimit(
    c,
    rateLimitStore,
    userId,
    currentSessionId,
    code,
    parsed.data.current_password,
  );
  if (rateLimited) return rateLimited;

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);

  const result = await runInTransaction(db, async (tx) => {
    // Re-checked fresh inside the transaction (not from the read above) so a grant added by a
    // concurrent group sync between the two can't race past this guard.
    const managedGrants = await tx.oidcRoleGrant.count({ where: { user_id: userId } });
    if (managedGrants > 0) {
      return { ok: false as const, code: "provider_managed_roles_exist" as UnlinkDenialCode };
    }

    const user = await tx.user.findUnique({ where: { id: userId }, select: { password_hash: true } });
    if (!user) return { ok: false as const, code: "unauthorized" as UnlinkDenialCode };

    const proof = await verifySelfUnlinkProof(tx, userId, user.password_hash, {
      current_password: parsed.data.current_password,
      code,
    });
    if (!proof.ok) return proof;

    const password_hash = await hashPassword(newPassword);
    await tx.externalIdentity.deleteMany({ where: { user_id: userId } });
    await tx.user.update({
      where: { id: userId },
      data: { password_hash, must_change_password: false },
    });
    const revokedCount = await revokeSessionsExcludingCurrent(tx, userId, currentSessionId);
    await revokeAllTrustedDevicesForUser(tx, userId);
    await writeAdminAuditLog(tx, {
      organizationId: orgId,
      actorUserId: audit.operator ?? userId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "account_sso_unlinked",
      metadata: { count: linked.length, sessionsRevoked: revokedCount },
    });
    await writeAdminAuditLog(tx, {
      organizationId: orgId,
      actorUserId: audit.operator ?? userId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      timezone: audit.timezone,
      actionType: "account_password_changed",
      metadata: { sessionsRevoked: revokedCount, reason: "sso_unlink" },
    });
    return { ok: true as const, value: revokedCount };
  });

  if (!result.ok) {
    const status = UNLINK_DENIAL_STATUS[result.code];
    if (result.code === "unauthorized") return c.json({ error: "unauthorized" }, status);
    return c.json({ code: result.code }, status);
  }
  return c.json({ ok: true });
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

  const passwordFailure = await verifyCurrentPasswordOrFail(c, db, rateLimitStore, userId, current_password);
  if (passwordFailure) return passwordFailure;

  if (isPasswordTooCommon(new_password)) {
    return c.json(passwordTooCommonJsonBody(), 400);
  }

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

  const passwordFailure = await verifyCurrentPasswordOrFail(c, db, rateLimitStore, userId, parsed.data.password);
  if (passwordFailure) return passwordFailure;

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
