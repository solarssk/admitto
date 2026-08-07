/** Session cookie name (httpOnly). */
export const SESSION_COOKIE_NAME = "admitto_session";

/** Trusted-device cookie name (httpOnly). */
export const TRUSTED_DEVICE_COOKIE_NAME = "admitto_trusted_device";

/** Default absolute session lifetime for operator-only users (12 hours), regardless of activity. */
export const SESSION_TTL_OPERATOR_MS = 12 * 60 * 60 * 1000;

/**
 * Default absolute session lifetime for admin/superadmin users (12 hours), regardless of
 * activity. Was 7 days prior to the P0 security review — a stolen admin cookie stayed valid
 * for a full week with no idle check. Kept short because elevated roles are the highest-impact
 * target; idle timeout (below) ends most sessions long before this is ever reached.
 */
export const SESSION_TTL_ADMIN_MS = 12 * 60 * 60 * 1000;

/** Default idle timeout for admin/superadmin `full` sessions (30 minutes since last activity). */
export const SESSION_IDLE_TIMEOUT_ADMIN_MS = 30 * 60 * 1000;

/** Default idle timeout for operator-only `full` sessions (2 hours since last activity). */
export const SESSION_IDLE_TIMEOUT_OPERATOR_MS = 2 * 60 * 60 * 1000;

/** TTL for mfa_pending / enrollment_required sessions (15 minutes). */
export const MFA_PENDING_SESSION_TTL_MS = 15 * 60 * 1000;
/** Fresh TTL granted when advancing to the backup-codes acknowledgment step. */
export const BACKUP_CODES_STEP_TTL_MS = 10 * 60 * 1000;

/** How long a WebAuthn registration/authentication challenge stays valid server-side, waiting
 * for the browser ceremony to complete (register a passkey/security key, or assert one). */
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Default trusted-device validity (days). */
export const DEFAULT_TRUSTED_DEVICE_DAYS = 30;

/** Backup recovery codes generated at TOTP enrollment. */
export const BACKUP_RECOVERY_CODE_COUNT = 10;

/** Default roles requiring 2FA (CSV). */
export const DEFAULT_MFA_REQUIRED_ROLES = "admin,superadmin";

/** Label on UserMfaMethod recovery rows for break-glass emergency codes. */
export const EMERGENCY_RECOVERY_LABEL = "emergency";

/** Throttle interval for updating last_seen_at on validate. */
export const SESSION_LAST_SEEN_THROTTLE_MS = 60_000;

/** Minimum length for any user-chosen password (forced-change, setup, account). */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Consecutive failed login attempts against a single admin/superadmin account that trigger the
 * `auth.login.repeated_failures` audit alert (P0 security review). Deliberately a fixed internal
 * constant, not a SystemSettings value — this is a security backstop, not a per-instance tuning
 * knob, matching the existing login/MFA rate-limit thresholds.
 */
export const PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD = 5;

/** Session stages — only `full` grants protected routes. */
export const SESSION_STAGE = {
  FULL: "full",
  MFA_PENDING: "mfa_pending",
  ENROLLMENT_REQUIRED: "enrollment_required",
  /** TOTP confirmed; user must save backup recovery codes before app access. */
  BACKUP_CODES_REQUIRED: "backup_codes_required",
  /** Admin-forced password reset pending; user can only reach `/change-password`. */
  CHANGE_PASSWORD_REQUIRED: "change_password_required",
} as const;

export type SessionStage = (typeof SESSION_STAGE)[keyof typeof SESSION_STAGE];

/** Post-login next step for clients. */
export const LOGIN_NEXT = {
  COMPLETE: "complete",
  MFA_REQUIRED: "mfa_required",
  ENROLLMENT_REQUIRED: "enrollment_required",
  BACKUP_CODES_REQUIRED: "backup_codes_required",
  CHANGE_PASSWORD: "change_password",
} as const;

export type LoginNext = (typeof LOGIN_NEXT)[keyof typeof LOGIN_NEXT];

/** How the session was authenticated — OIDC sessions skip local TOTP revalidation (16b). */
export const AUTH_METHOD = {
  LOCAL: "local",
  OIDC: "oidc",
} as const;

export type AuthMethod = (typeof AUTH_METHOD)[keyof typeof AUTH_METHOD];
