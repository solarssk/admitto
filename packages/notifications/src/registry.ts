import type { NotificationTypeDef } from "./types.js";

/**
 * Shared shape of every foundation type: org-staff audience, all 3 channels, the default 15-minute
 * throttle window, fully user/org configurable. Factored out so the 4 entries below only spell out
 * what actually differs between them (label, severity) - four near-identical object literals were
 * flagged as duplicated code otherwise.
 */
const ORG_STAFF_DEFAULTS: Omit<NotificationTypeDef, "label" | "defaultSeverity"> = {
  category: "system",
  availableChannels: ["email", "webhook", "in_app"],
  audience: "org-staff",
  throttleWindowMinutes: 15,
  userConfigurable: true,
  orgDisableable: true,
};

/**
 * Closed, developer-defined set of notification types (ADR 0038 §9 - no admin-configurable
 * rules/thresholds, no "subscribe to any System Log entry"). ADR 0044 §6 registry: 4 org-staff
 * security/ops alerts plus two self-audience types below - `account.auth_factor.changed`
 * (ASVS V2.5.5 + NIST SP 800-63-4 §4.1.2.1/§4.2.4/§4.4 - notify the account owner, and only the
 * account owner, whenever their own password/MFA/SSO changes, whether they made the change
 * themselves or an admin made it for them) and `account.login.new_location` (ASVS V2.2.3 -
 * notify the account owner themselves when their own account signs in from a location not seen
 * among its recent successful logins, alongside the existing org-staff `auth.login.new_country`
 * alert that tells the REST of the admins about the same event).
 */
export const NOTIFICATION_TYPES: Record<string, NotificationTypeDef> = {
  "auth.login.repeated_failures": {
    ...ORG_STAFF_DEFAULTS,
    label: "Repeated failed logins on an admin account",
    defaultSeverity: "error",
  },
  "auth.mfa.break_glass": {
    ...ORG_STAFF_DEFAULTS,
    label: "MFA break-glass used",
    defaultSeverity: "error",
  },
  "auth.settings.changed": {
    ...ORG_STAFF_DEFAULTS,
    label: "Login/security settings changed",
    defaultSeverity: "warn",
  },
  "auth.login.new_country": {
    ...ORG_STAFF_DEFAULTS,
    label: "Admin login from a new country",
    defaultSeverity: "warn",
  },
  "account.auth_factor.changed": {
    category: "system",
    label: "Your password or MFA method changed",
    defaultSeverity: "warn",
    // No webhook: that channel is one shared, team-wide URL per organization (see
    // NotificationChannelKey's own doc comment) - posting a self-audience event there would
    // broadcast "this specific person changed their MFA" to the whole org's Discord/Slack, the
    // exact exposure this type exists to avoid for every OTHER type's audience.
    availableChannels: ["email", "in_app"],
    audience: "self",
    // Never throttled (see NotificationTypeDef.throttleWindowMinutes's own doc comment): every
    // call site shares one per-user dedupeKey (the account owner), but each occurrence is its own
    // distinct, independently reportable change - a password change followed by a passkey removal
    // 2 minutes later are two different events the owner must see, not a repeat of one incident to
    // collapse into a single alert (bot review finding, PR #1304).
    throttleWindowMinutes: 0,
    // Mandatory: the whole point of ASVS V2.5.5 is catching an unauthorized change on your own
    // account, so neither the account owner nor the organization can silence the one alert meant
    // to let them catch it (see userConfigurable/orgDisableable's own doc comments in types.ts).
    userConfigurable: false,
    orgDisableable: false,
  },
  "account.login.new_location": {
    category: "system",
    label: "You signed in from a new location",
    defaultSeverity: "warn",
    // No webhook, same reasoning as account.auth_factor.changed - a shared org webhook would
    // broadcast "this specific person just signed in from X" to the whole team, not just the
    // account owner.
    availableChannels: ["email", "in_app"],
    audience: "self",
    // Mandatory, same reasoning as account.auth_factor.changed: this exists to catch a stolen
    // credential being used somewhere the real owner never has been (ASVS V2.2.3), so an attacker
    // who already has the account must not be able to silence the one alert meant to out them.
    // Fired from the same call site (checkNewCountryLogin/logLoginNewCountry) and same
    // hasElevatedRole gate as the existing org-staff auth.login.new_country - admin/superadmin
    // accounts only, not yet extended to operators (project_operator_no_mfa_by_design: operator
    // accounts are short-lived and supervised in person, a deliberately separate scope decision).
    userConfigurable: false,
    orgDisableable: false,
  },
};

export function getNotificationTypeDef(type: string): NotificationTypeDef | undefined {
  return Object.getOwnPropertyDescriptor(NOTIFICATION_TYPES, type)?.value as
    | NotificationTypeDef
    | undefined;
}
