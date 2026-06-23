/** OAuth auth-state TTL (PKCE/state/nonce). */
export const OIDC_AUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Keep consumed auth-state rows briefly for replay detection, then sweep. */
export const OIDC_AUTH_STATE_CONSUMED_RETENTION_MS = 24 * 60 * 60 * 1000;

export const PROVIDER_TYPE_OIDC = "oidc";
export const PROVIDER_TYPE_CLOUDFLARE_ACCESS = "cloudflare_access";

export const DEFAULT_CLAIM_EMAIL = "email";
export const DEFAULT_CLAIM_NAME = "name";
export const DEFAULT_CLAIM_GROUPS = "groups";

/** Shown on GET /login when no per-provider override is stored. */
export const DEFAULT_SSO_LOGIN_BUTTON_LABEL = "Continue with SSO";

export const SSO_LOGIN_BUTTON_LABEL_MAX_LEN = 120;

/** Binds OIDC callback to the browser that started the flow (CSRF / session fixation). */
export const OIDC_FLOW_COOKIE_NAME = "admitto_oidc_flow";

/** Max age between password/TOTP step-up and OIDC link callback. */
export const OIDC_LINK_STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;
