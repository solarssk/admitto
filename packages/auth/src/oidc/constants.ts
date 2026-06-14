/** OAuth auth-state TTL (PKCE/state/nonce). */
export const OIDC_AUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Keep consumed auth-state rows briefly for replay detection, then sweep. */
export const OIDC_AUTH_STATE_CONSUMED_RETENTION_MS = 24 * 60 * 60 * 1000;

export const PROVIDER_TYPE_OIDC = "oidc";
export const PROVIDER_TYPE_CLOUDFLARE_ACCESS = "cloudflare_access";

export const DEFAULT_CLAIM_EMAIL = "email";
export const DEFAULT_CLAIM_NAME = "name";
export const DEFAULT_CLAIM_GROUPS = "groups";
