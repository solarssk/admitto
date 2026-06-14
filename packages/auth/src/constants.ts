/** Session cookie name (httpOnly). */
export const SESSION_COOKIE_NAME = "admitto_session";

/** Default session TTL for operator-only users (12 hours). */
export const SESSION_TTL_OPERATOR_MS = 12 * 60 * 60 * 1000;

/** Default session TTL for admin/superadmin users (7 days). */
export const SESSION_TTL_ADMIN_MS = 7 * 24 * 60 * 60 * 1000;

/** Throttle interval for updating last_seen_at on validate. */
export const SESSION_LAST_SEEN_THROTTLE_MS = 60_000;
