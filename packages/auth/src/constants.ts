/** Session cookie name (httpOnly). */
export const SESSION_COOKIE_NAME = "admitto_session";

/** Trusted-device cookie name (httpOnly). */
export const TRUSTED_DEVICE_COOKIE_NAME = "admitto_trusted_device";

/** Default session TTL for operator-only users (12 hours). */
export const SESSION_TTL_OPERATOR_MS = 12 * 60 * 60 * 1000;

/** Default session TTL for admin/superadmin users (7 days). */
export const SESSION_TTL_ADMIN_MS = 7 * 24 * 60 * 60 * 1000;

/** TTL for mfa_pending / enrollment_required sessions (15 minutes). */
export const MFA_PENDING_SESSION_TTL_MS = 15 * 60 * 1000;
/** Fresh TTL granted when advancing to the backup-codes acknowledgment step. */
export const BACKUP_CODES_STEP_TTL_MS = 10 * 60 * 1000;

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

/** Session stages — only `full` grants protected routes. */
export const SESSION_STAGE = {
  FULL: "full",
  MFA_PENDING: "mfa_pending",
  ENROLLMENT_REQUIRED: "enrollment_required",
  /** TOTP confirmed; user must save backup recovery codes before app access. */
  BACKUP_CODES_REQUIRED: "backup_codes_required",
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
