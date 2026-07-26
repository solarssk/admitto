import { createHash } from "node:crypto";
import { redactEmail } from "@admitto/shared";
import { recordSystemLog } from "@admitto/shared/system-log";

export { redactEmail };

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

/** Emit `auth.login.success` as JSON to stdout (no password/token fields). Full email, not
 * redacted - staff/operator sign-in is exactly the internal accountability case this log
 * exists for, matching the already-unredacted actor identification in the per-org Audit log
 * (`AdminAuditLog`, resolved via `actor_email` in audit-routes.ts). */
export function logLoginSuccess(ctx: LoginAuditContext): void {
  emitAuditEvent("auth.login.success", {
    email: ctx.email,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
}

/** Emit `auth.login.fail` as JSON to stdout (uniform shape for enumeration-safe failures).
 * Redacted, unlike logLoginSuccess above: `ctx.email` here is unauthenticated form input - the
 * login attempt failed, so this could be any real address someone typed in, not a verified
 * staff identity (external review on PR #593). Full email on success is fine precisely because
 * it's post-authentication; that reasoning doesn't extend to a failed attempt. */
export function logLoginFailure(ctx: LoginAuditContext): void {
  emitAuditEvent("auth.login.fail", {
    email: redactEmail(ctx.email),
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
}

/** Emit `auth.mfa.break_glass` audit (no codes/secrets). */
export function logMfaBreakGlass(ctx: { action: string; email: string; ip?: string }): void {
  emitAuditEvent("auth.mfa.break_glass", {
    action: ctx.action,
    email: ctx.email,
    ip: ctx.ip ?? null,
  });
}

/** Emit `auth.mfa.success` after TOTP or recovery code verification. */
export function logMfaSuccess(ctx: MfaAuditContext, method: MfaMethod): void {
  emitAuditEvent("auth.mfa.success", {
    user_fingerprint: fingerprint(ctx.userId),
    session_fingerprint: ctx.sessionId ? fingerprint(ctx.sessionId) : null,
    method,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
}

/** Emit `auth.mfa.fail` after invalid MFA code (no code value). */
export function logMfaFailure(ctx: MfaAuditContext): void {
  emitAuditEvent("auth.mfa.fail", {
    user_fingerprint: fingerprint(ctx.userId),
    session_fingerprint: ctx.sessionId ? fingerprint(ctx.sessionId) : null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
}

/** Emit `auth.mfa.recovery_consumed` when a backup or emergency code is used. */
export function logMfaRecoveryConsumed(ctx: MfaAuditContext, method: "backup" | "emergency"): void {
  emitAuditEvent("auth.mfa.recovery_consumed", {
    user_fingerprint: fingerprint(ctx.userId),
    session_fingerprint: ctx.sessionId ? fingerprint(ctx.sessionId) : null,
    method,
    ip: ctx.ip ?? null,
  });
}

/** Emit `auth.logout` when a session is revoked at sign-out. */
export function logLogout(ctx: { userId: string; sessionId: string; ip?: string }): void {
  emitAuditEvent("auth.logout", {
    user_fingerprint: fingerprint(ctx.userId),
    session_fingerprint: fingerprint(ctx.sessionId),
    ip: ctx.ip ?? null,
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

/** Emit `auth.oidc.superadmin_revoke_blocked` when OIDC sync would remove the last active instance superadmin. */
export function logOidcSuperadminRevokeBlocked(input: {
  providerId: string;
  userId: string;
}): void {
  emitAuditEvent("auth.oidc.superadmin_revoke_blocked", {
    provider_id: input.providerId,
    user_fingerprint: fingerprint(input.userId),
  });
}

/** Emit `auth.oidc.success` after OIDC callback creates a full session. */
export function logOidcLoginSuccess(input: {
  providerId: string;
  userId: string;
  subject?: string;
  ip?: string;
}): void {
  emitAuditEvent("auth.oidc.success", {
    provider_id: input.providerId,
    user_fingerprint: fingerprint(input.userId),
    subject_fingerprint: input.subject ? fingerprint(input.subject) : null,
    ip: input.ip ?? null,
  });
}

/** Emit `auth.access.denied` for session-based 403 on protected admin paths. */
export function logAccessDenied(input: {
  path: string;
  reason: string;
  authSource?: string;
  userId?: string;
  ip?: string;
}): void {
  emitAuditEvent("auth.access.denied", {
    path: input.path,
    reason: input.reason,
    auth_source: input.authSource ?? null,
    user_fingerprint: input.userId ? fingerprint(input.userId) : null,
    ip: input.ip ?? null,
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
