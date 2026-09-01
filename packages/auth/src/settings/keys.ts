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
/** Direct OIDC provider that owns the canonical subject forwarded by Cloudflare Access. */
export const SETTING_CF_ACCESS_SOURCE_PROVIDER_ID = "cf_access_source_provider_id";

/** Runtime UI branding (CSS vars) — ADR 0020 / v0.4 foundation. */
export const SETTING_BRANDING_THEME = "branding_theme";

/** First-run onboarding wizard completed (v0.4.6). */
export const SETTING_SETUP_COMPLETE = "setup_complete";

/** Public instance URL for ticket links and mail asset absolutization (v0.4.9). */
export const SETTING_INSTANCE_URL = "instance_url";

/** Passkey / security-key (WebAuthn) MFA method availability (#341/#342). */
export const SETTING_WEBAUTHN_ENABLED = "webauthn_enabled";

/** Whether the login page offers "Sign in with a passkey" as an alternative to the password,
 *  for accounts with a registered passkey. Password sign-in is never removed. Only takes effect
 *  when SETTING_WEBAUTHN_ENABLED is also on. */
export const SETTING_PASSKEY_LOGIN_ENABLED = "passkey_login_enabled";

/** Whether the login page also runs the passkey ceremony automatically via WebAuthn conditional
 *  mediation - the browser offers a saved passkey as an autofill suggestion directly in the
 *  email field, instead of requiring a click on "Sign in with a passkey" first. Only takes
 *  effect when SETTING_PASSKEY_LOGIN_ENABLED (and therefore SETTING_WEBAUTHN_ENABLED) is also
 *  on - it is a UX layer on top of that same ceremony, not a separate sign-in method. */
export const SETTING_PASSKEY_CONDITIONAL_UI_ENABLED = "passkey_conditional_ui_enabled";

/** Extra https:// origins trusted to run script / send data on the staff SPA and auth pages
 *  (e.g. an analytics beacon or a Turnstile-style login challenge widget). */
export const SETTING_CSP_TRUSTED_ORIGINS = "csp_trusted_origins";

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
  SETTING_CF_ACCESS_SOURCE_PROVIDER_ID,
  SETTING_BRANDING_THEME,
  SETTING_SETUP_COMPLETE,
  SETTING_INSTANCE_URL,
  SETTING_WEBAUTHN_ENABLED,
  SETTING_PASSKEY_LOGIN_ENABLED,
  SETTING_PASSKEY_CONDITIONAL_UI_ENABLED,
  SETTING_CSP_TRUSTED_ORIGINS,
] as const;
