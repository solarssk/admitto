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
 * rules/thresholds, no "subscribe to any System Log entry"). ADR 0044 §6 registry, foundation
 * slice: the 4 org-staff security/ops alerts wired in this PR. A 5th, self-audience type
 * (`account.auth_factor.changed`, ASVS V2.5.5) is added by a later PR once the personal-account
 * wiring it needs exists - see the notifications-module-foundation plan.
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
};

export function getNotificationTypeDef(type: string): NotificationTypeDef | undefined {
  return Object.getOwnPropertyDescriptor(NOTIFICATION_TYPES, type)?.value as
    | NotificationTypeDef
    | undefined;
}
