import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@admitto/db";
import { redactEmail } from "@admitto/shared";
import { recordSystemLog } from "@admitto/shared/system-log";

export { redactEmail };

type Db = PrismaClient | Prisma.TransactionClient;

type UserIdentitySnapshot = { email: string; display_name: string | null };

/** Resolve staff email/display_name at audit write time (immutable snapshot columns). */
async function resolveUserIdentitySnapshot(
  db: Db,
  userId: string | null | undefined,
): Promise<UserIdentitySnapshot | null> {
  if (!userId) return null;
  try {
    return await db.user.findUnique({
      where: { id: userId },
      select: { email: true, display_name: true },
    });
  } catch {
    return null;
  }
}

/** The 13 auth/security event types persisted to the durable `SecurityAuditLog` table (issue
 * #473), in addition to the stdout/ring-buffer emit every event in this module already gets.
 * Deliberately narrower than this module's full event surface: `auth.rate_limit.exceeded` (11
 * call sites spanning login, MFA, OIDC, admin imports, check-in — an infra/throttle signal better
 * served by metrics/alerting than a queryable per-row table) and `auth.settings.changed` (already
 * durable via `AdminAuditLog`, see identity-api-routes.ts) stay stdout/ring-buffer only. */
export type SecurityAuditEventType =
  | "auth.login.success"
  | "auth.login.fail"
  | "auth.login.repeated_failures"
  | "auth.mfa.success"
  | "auth.mfa.fail"
  | "auth.mfa.break_glass"
  | "auth.superadmin.bootstrap"
  | "auth.mfa.recovery_consumed"
  | "auth.mfa.repeated_failures"
  | "auth.logout"
  | "auth.oidc.success"
  | "auth.oidc.superadmin_revoke_blocked"
  | "auth.access.denied"
  | "auth.trusted_device.created";

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
    /** Actor's IANA timezone at write time — null when unknown (bots, older clients, CLI). */
    actor_timezone?: string | null;
    // Every one of this module's 11 callers always supplies a metadata object - non-optional
    // here rather than a defensive `?? undefined` fallback for a shape nothing ever passes.
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const snapshot = await resolveUserIdentitySnapshot(db, fields.user_id);
    await db.securityAuditLog.create({
      data: {
        event_type: fields.event_type,
        user_id: fields.user_id ?? null,
        user_email: snapshot?.email ?? null,
        user_display_name: snapshot?.display_name ?? null,
        ip: fields.ip ?? null,
        actor_timezone: fields.actor_timezone ?? null,
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
 * call at each site. `opts.quiet` skips the stdout JSON only, for callers whose "log collector"
 * is a human at an interactive terminal rather than a container log aggregator (the break-glass
 * CLI commands) — the System logs buffer entry still happens either way.
 */
export function emitAuditEvent(event: string, fields: Record<string, unknown>, opts?: { quiet?: boolean }): void {
  const { event: _ignoredEvent, ts: _ignoredTs, ...safeFields } = fields;
  if (!opts?.quiet) {
    console.info(JSON.stringify({ ...safeFields, ts: new Date().toISOString(), event }));
  }
  recordSystemLog({ level: systemLogLevelFor(event), source: "security", message: event, fields: safeFields });
}

/** Context for structured login audit events (email is redacted in logs). */
export interface LoginAuditContext {
  email: string;
  ip?: string;
  userAgent?: string;
  /** Browser IANA timezone when captured (HTML form / header); omit when unknown. */
  timezone?: string | null;
}

/** Context for MFA completion audit events. */
export interface MfaAuditContext {
  userId: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
}

/** MFA verification method recorded in `auth.mfa.success`. */
export type MfaMethod = "totp" | "backup" | "emergency" | "webauthn";

/** Rate-limit bucket identifiers for `auth.rate_limit.exceeded` audit events. */
export type RateLimitScope =
  | "login_ip"
  | "login_email"
  | "mfa_verify"
  | "mfa_enroll"
  | "oidc_auth"
  | "oidc_link_stepup"
  | "account_ip"
  | "account_password_check"
  | "public"
  | "readyz"
  | "healthz"
  | "ops-system-logs"
  | "admin_import_preview"
  | "admin_import_commit"
  | "admin_import_job_status"
  | "admin_wallet_push_job_status"
  | "admin_wallet_message_job_status"
  | "admin_wallet_message_send"
  | "admin_template_preview"
  | "admin_oidc_provider_ops"
  | "admin_attendees_search"
  | "admin_mail_transport_test"
  | "admin_health_live"
  | "admin_event_mail_transport_test"
  | "admin_export_pii"
  | "checkin_scan"
  | "admin_resend_bulk"
  | "admin_resend"
  | "admin_export"
  | "admin_attendee_patch"
  | "checkin_stream"
  | "checkin_history"
  | "admin_geocoding_search"
  | "admin_geocoding_timezone"
  | "wallet_webhook";

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
    actor_timezone: ctx.timezone ?? null,
    metadata: { userAgent: ctx.userAgent ?? null },
  });
}

/** Why a login attempt was rejected, recorded in `auth.login.fail`'s `reason` field so an
 * investigator can tell a bad password apart from a correct password against a deactivated
 * account (the latter has no session-granting outcome either way, but is a distinct signal -
 * e.g. a breached credential still being probed after offboarding). Never shown to the caller,
 * which always sees the same generic failure regardless of reason. */
export type LoginFailureReason = "invalid_credentials" | "inactive";

/** Emit `auth.login.fail` as JSON to stdout and persist a durable `SecurityAuditLog` row.
 * `user_id: null` - the login attempt failed, so this never resolves against (or reveals whether
 * there is) a real account; the write path itself doesn't check account existence, avoiding a
 * behavioral side channel. Split redaction: stdout / System-log still emit `redactEmail` (failed
 * attempt is unauthenticated input; container logs may be forwarded under an operator-controlled
 * retention policy - see DATA-PROTECTION.md). The durable superadmin-only `SecurityAuditLog` row
 * stores the full attempted email in `metadata.email` so investigations can attribute
 * brute-force/credential-stuffing to a specific address (OWASP Logging Cheat Sheet; PO decision
 * reversing PR #593's more conservative durable-row call). */
export async function logLoginFailure(
  db: Db,
  ctx: LoginAuditContext,
  reason: LoginFailureReason,
): Promise<void> {
  emitAuditEvent("auth.login.fail", {
    email: redactEmail(ctx.email),
    reason,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.login.fail",
    user_id: null,
    ip: ctx.ip ?? null,
    actor_timezone: ctx.timezone ?? null,
    metadata: { email: ctx.email, reason, userAgent: ctx.userAgent ?? null },
  });
}

/** Emit `auth.mfa.break_glass` audit (no codes/secrets) and persist a durable `SecurityAuditLog`
 * row. `userId` is the target superadmin resolved by `verifyTargetUserPassword` at every call
 * site; kept optional here since the stdout/ring-buffer emit above doesn't require it. Unlike
 * `logLoginSuccess`/`logOidcLoginSuccess` (where the email belongs to the person authenticating,
 * i.e. the accountable actor), `email` here identifies the *target* of an operator-run CLI
 * command - already resolvable via `user_id` in the admin panel's user join - so it's kept in the
 * ephemeral stdout emit only, not durably persisted (CodeRabbit PR #611). `ctx.quiet` (set by the
 * break-glass CLI commands themselves) skips that stdout JSON, since those commands print their
 * own human-readable result line right after and an operator's terminal isn't a log collector;
 * the durable row below is unaffected either way. */
export async function logMfaBreakGlass(
  db: Db,
  ctx: { action: string; email: string; userId?: string; ip?: string; quiet?: boolean },
): Promise<void> {
  emitAuditEvent(
    "auth.mfa.break_glass",
    { action: ctx.action, email: ctx.email, ip: ctx.ip ?? null },
    { quiet: ctx.quiet },
  );
  await writeSecurityAuditLog(db, {
    event_type: "auth.mfa.break_glass",
    user_id: ctx.userId ?? null,
    ip: ctx.ip ?? null,
    metadata: { action: ctx.action },
  });
}

/** `logMfaBreakGlass` for the break-glass CLI commands specifically (`reset-mfa`,
 * `generate-emergency-recovery`, in both `packages/auth/src/cli.ts` and `apps/cli/src/commands/
 * auth.ts`). Always quiet - unlike `logMfaBreakGlass` itself, this wrapper's `ctx` has no `quiet`
 * field to set, so a future break-glass call site can't reintroduce the raw-JSON-on-terminal bug
 * by simply forgetting to pass `quiet: true`; every CLI command gets the right behavior by
 * construction instead of by convention. */
export async function logMfaBreakGlassCli(
  db: Db,
  ctx: { action: string; email: string; userId?: string; ip?: string },
): Promise<void> {
  await logMfaBreakGlass(db, { ...ctx, quiet: true });
}

/** Emit `auth.superadmin.bootstrap` (no codes/secrets) and persist a durable `SecurityAuditLog`
 * row when the break-glass CLI mints a new superadmin (`bootstrap-superadmin`, both
 * `packages/auth/src/cli.ts` and `apps/cli/src/commands/auth.ts`). Kept as its own event type
 * rather than folded into `auth.mfa.break_glass` like this CLI's other commands
 * (`reset-mfa`/`generate-emergency-recovery` genuinely are MFA break-glass actions) - minting a
 * brand-new privileged account is a materially different, more significant action, and Recent
 * Activity's UI (`AuditLogPanel.tsx`) labels/filters purely off `event_type`; sharing the MFA
 * type would show account creation as "2FA break-glass override" and obscure it in that view.
 * Called from inside `bootstrapSuperadmin`'s own transaction so account creation and its audit
 * record commit or roll back together - never a persisted superadmin with no audit trail. Writes
 * the `SecurityAuditLog` row directly rather than through `writeSecurityAuditLog`, which swallows
 * persistence errors by design (correct for its other, best-effort login/MFA callers, but wrong
 * here: a swallowed error would let this transaction commit the new superadmin with no audit
 * record at all, exactly what this function exists to prevent) - a failure here must propagate
 * and roll back the whole transaction instead. */
export async function logSuperadminBootstrapCli(
  db: Db,
  ctx: { email: string; userId: string },
): Promise<void> {
  emitAuditEvent("auth.superadmin.bootstrap", { email: ctx.email }, { quiet: true });
  await db.securityAuditLog.create({
    data: {
      event_type: "auth.superadmin.bootstrap",
      user_id: ctx.userId,
      user_email: ctx.email,
      user_display_name: null,
      ip: null,
      actor_timezone: null,
      metadata: {} as Prisma.InputJsonValue,
    },
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

/** Why an MFA completion attempt failed, recorded in `auth.mfa.fail`'s `reason` field: a wrong
 * TOTP/recovery code, a recovery code that matched but lost a race to consume its row, a rejected
 * WebAuthn assertion, or a code/assertion that verified correctly but session promotion failed
 * afterward (e.g. the partial session expired or was concurrently revoked between verification and
 * promotion - the transaction rolls back in that last case, see `completeMfaInTransaction`/
 * `completeMfaWithWebauthnInTransaction`, so this is what makes the outcome reconstructable after
 * the fact instead of leaving a silent, unaudited failure). */
export type MfaFailureReason =
  | "invalid_code"
  | "recovery_consume_conflict"
  | "invalid_webauthn"
  | "session_not_promoted";

/** Emit `auth.mfa.fail` after a failed MFA completion attempt and persist a durable
 * `SecurityAuditLog` row (raw `user_id` - see logMfaSuccess). `method` is only known for
 * `session_not_promoted` (the code itself verified correctly); omitted otherwise. */
export async function logMfaFailure(
  db: Db,
  ctx: MfaAuditContext,
  reason: MfaFailureReason,
  method?: MfaMethod,
): Promise<void> {
  emitAuditEvent("auth.mfa.fail", {
    user_fingerprint: fingerprint(ctx.userId),
    session_fingerprint: ctx.sessionId ? fingerprint(ctx.sessionId) : null,
    reason,
    method: method ?? null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.mfa.fail",
    user_id: ctx.userId,
    ip: ctx.ip ?? null,
    metadata: { sessionId: ctx.sessionId ?? null, reason, method: method ?? null, userAgent: ctx.userAgent ?? null },
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
    /** Browser IANA timezone captured at OIDC /start (carried via OidcAuthState). */
    timezone?: string | null;
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
    actor_timezone: input.timezone ?? null,
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

/** Emit `auth.trusted_device.created` when MFA completion remembers a device (skips MFA on
 * future logins on that device for its configured lifetime, see `trusted_device_days`), and
 * persist a durable `SecurityAuditLog` row (P0 security review — this was the one MFA outcome
 * with no audit trail). */
export async function logTrustedDeviceCreated(db: Db, ctx: MfaAuditContext): Promise<void> {
  emitAuditEvent("auth.trusted_device.created", {
    user_fingerprint: fingerprint(ctx.userId),
    session_fingerprint: ctx.sessionId ? fingerprint(ctx.sessionId) : null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.trusted_device.created",
    user_id: ctx.userId,
    ip: ctx.ip ?? null,
    metadata: { sessionId: ctx.sessionId ?? null, userAgent: ctx.userAgent ?? null },
  });
}

/** Emit `auth.login.repeated_failures` once consecutive failed attempts against a single
 * admin/superadmin account cross `PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD`, and persist a
 * durable `SecurityAuditLog` row (P0 security review). Deliberately breaks from
 * `logLoginFailure`'s enumeration-safe `user_id: null` / redacted-email shape: this event only
 * ever fires for a real, elevated-role account after repeated failures, so identifying *which*
 * privileged account is under attack is the entire point — a superadmin reviewing the audit log
 * needs to know that, qualitatively different from the routine per-attempt failure log that must
 * never reveal whether an arbitrary email belongs to a real user. */
export async function logRepeatedFailedLogins(
  db: Db,
  ctx: { userId: string; email: string; ip?: string; streak: number },
): Promise<void> {
  emitAuditEvent("auth.login.repeated_failures", {
    email: ctx.email,
    streak: ctx.streak,
    ip: ctx.ip ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.login.repeated_failures",
    user_id: ctx.userId,
    ip: ctx.ip ?? null,
    metadata: { streak: ctx.streak },
  });
}

/** Emit `auth.mfa.repeated_failures` once consecutive failed MFA verification attempts against a
 * single admin/superadmin account's session cross `PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD`, and
 * persist a durable `SecurityAuditLog` row. Counterpart to `logRepeatedFailedLogins` for the MFA
 * step: the password-failure streak resets on password success (before MFA is attempted), so an
 * attacker who already has a valid password for a privileged account could otherwise grind
 * unlimited MFA-code guesses without ever tripping that alert. Same enumeration-unsafe shape as
 * `logRepeatedFailedLogins` (real `email`, not redacted) - this only ever fires for a real,
 * elevated-role account already past password verification. */
export async function logRepeatedFailedMfaAttempts(
  db: Db,
  ctx: { userId: string; email: string; ip?: string; streak: number },
): Promise<void> {
  emitAuditEvent("auth.mfa.repeated_failures", {
    email: ctx.email,
    streak: ctx.streak,
    ip: ctx.ip ?? null,
  });
  await writeSecurityAuditLog(db, {
    event_type: "auth.mfa.repeated_failures",
    user_id: ctx.userId,
    ip: ctx.ip ?? null,
    metadata: { streak: ctx.streak },
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
