import type { NotificationTypeDef } from "./types.js";

/**
 * Closed, developer-defined set of notification types (ADR 0038 §9 - no admin-configurable
 * rules/thresholds, no "subscribe to any System Log entry"). ADR 0044 §6 registry, foundation
 * slice: the 4 org-staff security/ops alerts wired in this PR. A 5th, self-audience type
 * (`account.auth_factor.changed`, ASVS V2.5.5) is added by a later PR once the personal-account
 * wiring it needs exists - see the notifications-module-foundation plan.
 */
export const NOTIFICATION_TYPES: Record<string, NotificationTypeDef> = {
  "auth.login.repeated_failures": {
    category: "system",
    label: "Repeated failed logins on an admin account",
    defaultSeverity: "error",
    availableChannels: ["email", "webhook", "in_app"],
    audience: "org-staff",
    throttleWindowMinutes: 15,
    userConfigurable: true,
    orgDisableable: true,
  },
  "auth.mfa.break_glass": {
    category: "system",
    label: "MFA break-glass used",
    defaultSeverity: "error",
    availableChannels: ["email", "webhook", "in_app"],
    audience: "org-staff",
    throttleWindowMinutes: 15,
    userConfigurable: true,
    orgDisableable: true,
  },
  "auth.settings.changed": {
    category: "system",
    label: "Login/security settings changed",
    defaultSeverity: "warn",
    availableChannels: ["email", "webhook", "in_app"],
    audience: "org-staff",
    throttleWindowMinutes: 15,
    userConfigurable: true,
    orgDisableable: true,
  },
  "auth.login.new_country": {
    category: "system",
    label: "Admin login from a new country",
    defaultSeverity: "warn",
    availableChannels: ["email", "webhook", "in_app"],
    audience: "org-staff",
    throttleWindowMinutes: 15,
    userConfigurable: true,
    orgDisableable: true,
  },
};

export function getNotificationTypeDef(type: string): NotificationTypeDef | undefined {
  return Object.getOwnPropertyDescriptor(NOTIFICATION_TYPES, type)?.value as
    | NotificationTypeDef
    | undefined;
}
