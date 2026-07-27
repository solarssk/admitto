import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { redactEmail } from "@admitto/shared";
import { recordSystemLog } from "@admitto/shared/system-log";

export { redactEmail };

type Db = PrismaClient | Prisma.TransactionClient;

/** The 10 auth/security event types persisted to the durable `SecurityAuditLog` table (issue
 * #473), in addition to the stdout/ring-buffer emit every event in this module already gets.
 * Deliberately narrower than this module's full event surface: `auth.rate_limit.exceeded` (11
 * call sites spanning login, MFA, OIDC, admin imports, check-in — an infra/throttle signal better
 * served by metrics/alerting than a queryable per-row table) and `auth.settings.changed` (already
 * durable via `AdminAuditLog`, see identity-api-routes.ts) stay stdout/ring-buffer only. */
export type SecurityAuditEventType =
  | "auth.login.success"
  | "auth.login.fail"
  | "auth.mfa.success"
  | "auth.mfa.fail"
  | "auth.mfa.break_glass"
  | "auth.mfa.recovery_consumed"
  | "auth.logout"
  | "auth.oidc.success"
  | "auth.oidc.superadmin_revoke_blocked"
  | "auth.access.denied";

/**
 * Persist a security/auth event to the durable `SecurityAuditLog` table (issue #473). Never
 * throws: unlike `writeAdminAuditLog` (a deliberate admin mutation, audited inside the same
 * transaction it mutates in — a write failure there rolls back the change too), these calls are
 * bolted onto existing login/MFA/CLI flows that must keep working even if the audit table is
 * briefly unavailable, so a persistence failure here only logs an error to stdout.
 */
async function writeSecurityAuditLog(
  db: Db,
  fields: {
    event_type: SecurityAuditEventType;
    user_id?: string | null;
    ip?: string | null;
    // Every one of this module's 10 callers always supplies a metadata object - non-optional
    // here rather than a defensive `?? undefined` fallback for a shape nothing ever passes.
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.securityAuditLog.create({
      data: {
        event_type: fields.event_type,
        user_id: fields.user_id ?? null,
        ip: fields.ip ?? null,
        metadata: fields.metadata as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "auth.security_audit_log.write_failed",
        target_event: fields.event_type,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    );
  }
}

/** Short SHA-256 fingerprint for IDs in audit logs (no raw UUIDs). */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

// Events naming an outright failure, rejection, or blocked action get "warn" in the live
// System logs tail; everything else (successful logins, logouts, routine settings changes)
// is "info". auth.mfa.break_glass is a sensitive emergency-bypass action, not a substring
// match below, so it's listed explicitly alongside the pattern-matched ones.
const WARN_EVENTS = new Set(["auth.mfa.break_glass"]);
function systemLogLevelFor(event: string): "info" | "warn" {
  if (WARN_EVENTS.has(event) || /fail|denied|exceeded|blocked/.test(event)) return "warn";
  return "info";
}

/**
 * Emit a structured audit event to stdout (container log collectors add transport metadata),
 * and record the same event into the System logs live-tail buffer under the "security" source
 * — this is the single place every auth/security event in this module already flows through,
 * so hooking in here covers logins, MFA, rate-limit blocks, and OIDC events without a separate
 * call at each site.
 */
export function emitAuditEvent(event: string, fields: Record<string, unknown>): void {
  const { event: _ignoredEvent, ts: _ignoredTs, ...safeFields } = fields;
  console.info(JSON.stringify({ ...safeFields, ts: new Date().toISOString(), event }));
  recordSystemLog({ level: systemLogLevelFor(event), source: "security", message: event, fields: safeFields });
}

/** Context for structured login audit events (email is redacted in logs). */
export interface LoginAuditContext {
  email: string;
  ip?: string;
  userAgent?: string;
}

/** Context for MFA completion audit events. */
export interface MfaAuditContext {
  userId: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
}

/** MFA verification method recorded in `auth.mfa.success`. */
export type MfaMethod = "totp" | "backup" | "emergency";

/** Rate-limit bucket identifiers for `auth.rate_limit.exceeded` audit events. */
export type RateLimitScope =
  | "login_ip"
  | "login_email"
  | "mfa_verify"
  | "mfa_enroll"
  | "oidc_auth"
  | "oidc_link_stepup"
  | "public"
  | "readyz"
  | "healthz"
  | "admin_import_preview"
  | "admin_import_commit"
  | "admin_template_preview"
  | "admin_oidc_provider_ops"
  | "admin_attendees_search"
  | "admin_mail_transport_test"
  | "admin_event_mail_transport_test"
  | "admin_export_pii"
  | "checkin_scan"
  | "admin_resend_bulk"
  | "admin_resend"
  | "admin_export"
  | "checkin_stream"
  | "checkin_history";

/** Emit `auth.login.success` as JSON to stdout (no password/token fields) and persist a durable
 * `SecurityAuditLog` row. Full email, not redacted - staff/operator sign-in is exactly the
 * internal accountability case this log exists for, matching the already-unredacted actor
 * identification in the per-org Audit log (`AdminAuditLog`, resolved via `actor_email` in
 * audit-routes.ts). */
export async function logLoginSuccess(db: Db, ctx: LoginAuditContext & { userId: string }): Promise<void> {
  emitAuditEvent("auth.login.success", {
    email: ctx.email,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.login.success",
    user_id: ctx.userId,
    ip: ctx.ip ?? null,
    metadata: { email: ctx.email, userAgent: ctx.userAgent ?? null },
  });
}

/** Emit `auth.login.fail` as JSON to stdout (uniform shape for enumeration-safe failures) and
 * persist a durable `SecurityAuditLog` row (`user_id: null` - same enumeration-safety reasoning:
 * never reveals whether the email belongs to a real user). Redacted, unlike logLoginSuccess above:
 * `ctx.email` here is unauthenticated form input - the login attempt failed, so this could be any
 * real address someone typed in, not a verified staff identity (external review on PR #593). Full
 * email on success is fine precisely because it's post-authentication; that reasoning doesn't
 * extend to a failed attempt. */
export async function logLoginFailure(db: Db, ctx: LoginAuditContext): Promise<void> {
  emitAuditEvent("auth.login.fail", {
    email: redactEmail(ctx.email),
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.login.fail",
    user_id: null,
    ip: ctx.ip ?? null,
    metadata: { email_redacted: redactEmail(ctx.email), userAgent: ctx.userAgent ?? null },
  });
}

/** Emit `auth.mfa.break_glass` audit (no codes/secrets) and persist a durable `SecurityAuditLog`
 * row. `userId` is the target superadmin resolved by `verifyTargetUserPassword` at every call
 * site; kept optional here since the stdout/ring-buffer emit above doesn't require it. Unlike
 * `logLoginSuccess`/`logOidcLoginSuccess` (where the email belongs to the person authenticating,
 * i.e. the accountable actor), `email` here identifies the *target* of an operator-run CLI
 * command - already resolvable via `user_id` in the admin panel's user join - so it's kept in the
 * ephemeral stdout emit only, not durably persisted (CodeRabbit PR #611). */
export async function logMfaBreakGlass(
  db: Db,
  ctx: { action: string; email: string; userId?: string; ip?: string },
): Promise<void> {
  emitAuditEvent("auth.mfa.break_glass", {
    action: ctx.action,
    email: ctx.email,
    ip: ctx.ip ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.mfa.break_glass",
    user_id: ctx.userId ?? null,
    ip: ctx.ip ?? null,
    metadata: { action: ctx.action },
  });
}

/** Emit `auth.mfa.success` after TOTP or recovery code verification and persist a durable
 * `SecurityAuditLog` row (raw `user_id`, not the stdout fingerprint - a durable row needs to be
 * genuinely queryable/joinable to the User table). */
export async function logMfaSuccess(db: Db, ctx: MfaAuditContext, method: MfaMethod): Promise<void> {
  emitAuditEvent("auth.mfa.success", {
    user_fingerprint: fingerprint(ctx.userId),
    session_fingerprint: ctx.sessionId ? fingerprint(ctx.sessionId) : null,
    method,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.mfa.success",
    user_id: ctx.userId,
    ip: ctx.ip ?? null,
    metadata: { sessionId: ctx.sessionId ?? null, method, userAgent: ctx.userAgent ?? null },
  });
}

/** Emit `auth.mfa.fail` after invalid MFA code (no code value) and persist a durable
 * `SecurityAuditLog` row (raw `user_id` - see logMfaSuccess). */
export async function logMfaFailure(db: Db, ctx: MfaAuditContext): Promise<void> {
  emitAuditEvent("auth.mfa.fail", {
    user_fingerprint: fingerprint(ctx.userId),
    session_fingerprint: ctx.sessionId ? fingerprint(ctx.sessionId) : null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.mfa.fail",
    user_id: ctx.userId,
    ip: ctx.ip ?? null,
    metadata: { sessionId: ctx.sessionId ?? null, userAgent: ctx.userAgent ?? null },
  });
}

/** Emit `auth.mfa.recovery_consumed` when a backup or emergency code is used and persist a
 * durable `SecurityAuditLog` row. */
export async function logMfaRecoveryConsumed(
  db: Db,
  ctx: MfaAuditContext,
  method: "backup" | "emergency",
): Promise<void> {
  emitAuditEvent("auth.mfa.recovery_consumed", {
    user_fingerprint: fingerprint(ctx.userId),
    session_fingerprint: ctx.sessionId ? fingerprint(ctx.sessionId) : null,
    method,
    ip: ctx.ip ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.mfa.recovery_consumed",
    user_id: ctx.userId,
    ip: ctx.ip ?? null,
    metadata: { method, sessionId: ctx.sessionId ?? null },
  });
}

/** Emit `auth.logout` when a session is revoked at sign-out and persist a durable
 * `SecurityAuditLog` row. */
export async function logLogout(
  db: Db,
  ctx: { userId: string; sessionId: string; ip?: string },
): Promise<void> {
  emitAuditEvent("auth.logout", {
    user_fingerprint: fingerprint(ctx.userId),
    session_fingerprint: fingerprint(ctx.sessionId),
    ip: ctx.ip ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.logout",
    user_id: ctx.userId,
    ip: ctx.ip ?? null,
    metadata: { sessionId: ctx.sessionId },
  });
}

/** Emit `auth.rate_limit.exceeded` when a throttle bucket is full. */
export function logRateLimitExceeded(input: {
  scope: RateLimitScope;
  ip?: string;
  keyHint?: string;
}): void {
  emitAuditEvent("auth.rate_limit.exceeded", {
    scope: input.scope,
    ip: input.ip ?? null,
    key_hint: input.keyHint ?? null,
  });
}

/** Emit `auth.oidc.superadmin_revoke_blocked` when OIDC sync would remove the last active
 * instance superadmin, and persist a durable `SecurityAuditLog` row. */
export async function logOidcSuperadminRevokeBlocked(
  db: Db,
  input: {
    providerId: string;
    userId: string;
  },
): Promise<void> {
  emitAuditEvent("auth.oidc.superadmin_revoke_blocked", {
    provider_id: input.providerId,
    user_fingerprint: fingerprint(input.userId),
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.oidc.superadmin_revoke_blocked",
    user_id: input.userId,
    metadata: { providerId: input.providerId },
  });
}

/** Emit `auth.oidc.success` after OIDC callback creates a full session, and persist a durable
 * `SecurityAuditLog` row. */
export async function logOidcLoginSuccess(
  db: Db,
  input: {
    providerId: string;
    userId: string;
    subject?: string;
    ip?: string;
  },
): Promise<void> {
  emitAuditEvent("auth.oidc.success", {
    provider_id: input.providerId,
    user_fingerprint: fingerprint(input.userId),
    subject_fingerprint: input.subject ? fingerprint(input.subject) : null,
    ip: input.ip ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.oidc.success",
    user_id: input.userId,
    ip: input.ip ?? null,
    metadata: { providerId: input.providerId, subject: input.subject ?? null },
  });
}

/** Emit `auth.access.denied` for session-based 403 on protected admin paths, and persist a
 * durable `SecurityAuditLog` row (`user_id: null` when the request had no resolvable session). */
export async function logAccessDenied(
  db: Db,
  input: {
    path: string;
    reason: string;
    authSource?: string;
    userId?: string;
    ip?: string;
  },
): Promise<void> {
  emitAuditEvent("auth.access.denied", {
    path: input.path,
    reason: input.reason,
    auth_source: input.authSource ?? null,
    user_fingerprint: input.userId ? fingerprint(input.userId) : null,
    ip: input.ip ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.access.denied",
    user_id: input.userId ?? null,
    ip: input.ip ?? null,
    metadata: { path: input.path, reason: input.reason, authSource: input.authSource ?? null },
  });
}

/** Superadmin identity settings resources tracked in `auth.settings.changed`. */
export type AuthSettingsResource = "oidc_provider" | "cf_access";

/** Emit `auth.settings.changed` when superadmin mutates identity-provider configuration. */
export function logAuthSettingsChanged(input: {
  actorUserId: string;
  resource: AuthSettingsResource;
  action: string;
  targetId?: string;
}): void {
  emitAuditEvent("auth.settings.changed", {
    actor_fingerprint: fingerprint(input.actorUserId),
    resource: input.resource,
    action: input.action,
    target_id: input.targetId ?? null,
  });
}
