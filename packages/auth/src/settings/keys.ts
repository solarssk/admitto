/** SystemSettings keys — must match prompt 16a §7. */
export const SETTING_SESSION_TTL = "session_ttl";
export const SETTING_OPERATOR_SESSION_TTL = "operator_session_ttl";
export const SETTING_TRUSTED_DEVICE_DAYS = "trusted_device_days";
export const SETTING_MFA_REQUIRED_ROLES = "mfa_required_roles";

/** Cloudflare Access (prompt 16c). */
export const SETTING_CF_ACCESS_ENABLED = "cf_access_enabled";
export const SETTING_CF_ACCESS_TEAM_DOMAIN = "cf_access_team_domain";
export const SETTING_CF_ACCESS_AUD = "cf_access_aud";
export const SETTING_CF_ACCESS_PROTECTED_PREFIXES = "cf_access_protected_prefixes";

export const SYSTEM_SETTING_KEYS = [
  SETTING_SESSION_TTL,
  SETTING_OPERATOR_SESSION_TTL,
  SETTING_TRUSTED_DEVICE_DAYS,
  SETTING_MFA_REQUIRED_ROLES,
  SETTING_CF_ACCESS_ENABLED,
  SETTING_CF_ACCESS_TEAM_DOMAIN,
  SETTING_CF_ACCESS_AUD,
  SETTING_CF_ACCESS_PROTECTED_PREFIXES,
] as const;
