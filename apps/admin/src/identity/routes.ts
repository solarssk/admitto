/** Canonical Identity & SSO route constants. Shared by SettingsLayout (primary tab
 * hand-off + legacy `?tab=identity` redirect) and identity panels/editors. */
export const IDENTITY_BASE = "/admin/settings/identity";
export const IDENTITY_PROVIDERS_ROUTE = `${IDENTITY_BASE}/providers`;
export const IDENTITY_CLOUDFLARE_ROUTE = `${IDENTITY_BASE}/cloudflare`;
