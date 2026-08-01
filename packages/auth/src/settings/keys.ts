/** SystemSettings keys — must match prompt 16a §7. */
export const SETTING_SESSION_TTL = "session_ttl";
export const SETTING_OPERATOR_SESSION_TTL = "operator_session_ttl";
export const SETTING_TRUSTED_DEVICE_DAYS = "trusted_device_days";
export const SETTING_MFA_REQUIRED_ROLES = "mfa_required_roles";

/** Idle timeout for `full` sessions — separate from the absolute lifetime above (P0 security review). */
export const SETTING_SESSION_IDLE_TIMEOUT = "session_idle_timeout";
export const SETTING_OPERATOR_SESSION_IDLE_TIMEOUT = "operator_session_idle_timeout";

/** Cloudflare Access (prompt 16c). */
export const SETTING_CF_ACCESS_ENABLED = "cf_access_enabled";
export const SETTING_CF_ACCESS_TEAM_DOMAIN = "cf_access_team_domain";
export const SETTING_CF_ACCESS_AUD = "cf_access_aud";
export const SETTING_CF_ACCESS_PROTECTED_PREFIXES = "cf_access_protected_prefixes";

/** Runtime UI branding (CSS vars) — ADR 0020 / v0.4 foundation. */
export const SETTING_BRANDING_THEME = "branding_theme";

/** First-run onboarding wizard completed (v0.4.6). */
export const SETTING_SETUP_COMPLETE = "setup_complete";

/** Public instance URL for ticket links and mail asset absolutization (v0.4.9). */
export const SETTING_INSTANCE_URL = "instance_url";

export const SYSTEM_SETTING_KEYS = [
  SETTING_SESSION_TTL,
  SETTING_OPERATOR_SESSION_TTL,
  SETTING_SESSION_IDLE_TIMEOUT,
  SETTING_OPERATOR_SESSION_IDLE_TIMEOUT,
  SETTING_TRUSTED_DEVICE_DAYS,
  SETTING_MFA_REQUIRED_ROLES,
  SETTING_CF_ACCESS_ENABLED,
  SETTING_CF_ACCESS_TEAM_DOMAIN,
  SETTING_CF_ACCESS_AUD,
  SETTING_CF_ACCESS_PROTECTED_PREFIXES,
  SETTING_BRANDING_THEME,
  SETTING_SETUP_COMPLETE,
  SETTING_INSTANCE_URL,
] as const;
