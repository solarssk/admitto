/** SystemSettings keys — must match prompt 16a §7. */
export const SETTING_SESSION_TTL = "session_ttl";
export const SETTING_OPERATOR_SESSION_TTL = "operator_session_ttl";
export const SETTING_TRUSTED_DEVICE_DAYS = "trusted_device_days";
export const SETTING_MFA_REQUIRED_ROLES = "mfa_required_roles";

export const SYSTEM_SETTING_KEYS = [
  SETTING_SESSION_TTL,
  SETTING_OPERATOR_SESSION_TTL,
  SETTING_TRUSTED_DEVICE_DAYS,
  SETTING_MFA_REQUIRED_ROLES,
] as const;
