import type { SystemLogLevel } from "@admitto/shared/system-log";

export type NotificationSeverity = SystemLogLevel;

/** In-app is always available for self-audience mandatory types; webhook is a team-wide
 * resource (one URL per organization) never filtered per user — see NotificationTypeDef. */
export type NotificationChannelKey = "email" | "webhook" | "in_app";

/**
 * Who a notification type's candidates are resolved against (audience.ts):
 * - "org-staff": every active superadmin + org-admin of the organization (today's only real strategy).
 * - "event-staff": reserved for a future event-day-ops prompt — resolveAudienceCandidates throws
 *   NotImplementedError for it; no registry entry uses it yet.
 * - "self": exactly the event's targetUserId, validated as an active user of the organization.
 */
export type NotificationAudienceKey = "org-staff" | "event-staff" | "self";

export interface NotificationTypeDef {
  category: "system" | "ops";
  /** Shown in the preferences grid — a human label, not the technical registry key. */
  label: string;
  defaultSeverity: NotificationSeverity;
  availableChannels: NotificationChannelKey[];
  audience: NotificationAudienceKey;
  /** Throttle window for NotificationThrottle dedup. Dispatcher defaults to 15 when omitted. */
  throttleWindowMinutes?: number;
  /**
   * Whether a user may opt individual channels (email/in_app) in or out for this type via
   * NotificationPreference. false only for ASVS V2.5.5-mandated self-audience account-security
   * receipts (e.g. "your password changed") — letting the account owner silence the one alert
   * meant to let them catch an unauthorized change on their own account would defeat its purpose.
   */
  userConfigurable: boolean;
  /**
   * Whether an organization may disable this type entirely via NotificationSettings.disabled_types.
   * false for the same mandatory self-audience types as userConfigurable, for the same reason.
   */
  orgDisableable: boolean;
}

/**
 * One notification occurrence, as raised by a call site. `type` is supplied separately to
 * notify(db, type, event) — kept out of this shape so call sites can't accidentally construct
 * an event whose `type` doesn't match the registry key notify() looks up.
 */
export interface NotificationEvent {
  organizationId: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  /** Required when the type's audience is "self" — the one recipient. Ignored otherwise. */
  targetUserId?: string;
  /**
   * Throttle dedupe subject — e.g. the attacked account, the user who logged in, the admin who
   * performed break-glass or changed a setting. Kept distinct from targetUserId (which is only
   * about audience resolution for "self", not throttle scoping): an org-staff-audience event
   * still needs a per-incident subject so two different admins' incidents don't collapse into
   * one throttled notification. Falls back to a per-organization-only key when omitted.
   */
  dedupeKey?: string;
}

/**
 * What a NotificationChannel actually receives — the caller-supplied NotificationEvent plus the
 * `type` and `severity` resolved from the registry by dispatcher.ts. Kept separate from
 * NotificationEvent so call sites can't spoof severity (always registry-derived, never
 * call-site-supplied) and don't have to repeat `type` inside the event body they build.
 */
export type DispatchedNotification = NotificationEvent & {
  type: string;
  severity: NotificationSeverity;
};
