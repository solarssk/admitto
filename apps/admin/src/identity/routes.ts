/** Canonical Identity & SSO route constants. Shared so SettingsPage (legacy
 * `?tab=identity` redirect + Identity tab hand-off) and IdentityLayout (sub-tab
 * navigation) compose paths consistently instead of hardcoding the prefix. */
export const IDENTITY_BASE = "/admin/settings/identity";
export const IDENTITY_PROVIDERS_ROUTE = `${IDENTITY_BASE}/providers`;
export const IDENTITY_CLOUDFLARE_ROUTE = `${IDENTITY_BASE}/cloudflare`;
