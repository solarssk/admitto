import { createHash } from "node:crypto";

/** Redact email for logs: `a***@example.com`. */
export function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, 1);
  return `${visible}***${domain}`;
}

/** Short SHA-256 fingerprint for IDs in audit logs (no raw UUIDs). */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** Emit a structured audit event to stdout (container log collectors add transport metadata). */
export function emitAuditEvent(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
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

export type MfaMethod = "totp" | "backup" | "emergency";

export type RateLimitScope =
  | "login_ip"
  | "login_email"
  | "mfa_verify"
  | "oidc_auth"
  | "oidc_link_stepup"
  | "public"
  | "readyz";

/** Emit `auth.login.success` as JSON to stdout (no password/token fields). */
export function logLoginSuccess(ctx: LoginAuditContext): void {
  emitAuditEvent("auth.login.success", {
    email: redactEmail(ctx.email),
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
}

/** Emit `auth.login.fail` as JSON to stdout (uniform shape for enumeration-safe failures). */
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
    email: redactEmail(ctx.email),
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
