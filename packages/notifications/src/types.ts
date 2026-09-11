import type { SystemLogLevel } from "@admitto/shared/system-log";

export type NotificationSeverity = SystemLogLevel;

/** In-app is always available for self-audience mandatory types; webhook is a team-wide
 * resource (one URL per organization) never filtered per user - see NotificationTypeDef. */
export type NotificationChannelKey = "email" | "webhook" | "in_app";

/**
 * Who a notification type's candidates are resolved against (audience.ts):
 * - "org-staff": every active superadmin + org-admin of the organization (today's only real strategy).
 * - "event-staff": reserved for a future event-day-ops prompt - resolveAudienceCandidates throws
 *   NotImplementedError for it; no registry entry uses it yet.
 * - "self": exactly the event's targetUserId, validated as an active user of the organization.
 */
export type NotificationAudienceKey = "org-staff" | "event-staff" | "self";

export interface NotificationTypeDef {
  category: "system" | "ops";
  /** Shown in the preferences grid - a human label, not the technical registry key. */
  label: string;
  defaultSeverity: NotificationSeverity;
  availableChannels: NotificationChannelKey[];
  audience: NotificationAudienceKey;
  /**
   * Throttle window for NotificationThrottle dedup. Dispatcher defaults to 15 when omitted.
   * Explicitly `0` means never throttled: every occurrence dispatches, even a different
   * occurrence of this same type for the same dedupeKey within what would otherwise be one
   * throttle window. Use this for a type whose own semantics require every distinct event to be
   * reported (e.g. account.auth_factor.changed, ASVS V2.5.5) - a shared per-user dedupeKey across
   * genuinely different underlying changes (password vs. TOTP vs. WebAuthn) would otherwise let
   * the dispatcher's normal same-subject throttling silently drop every occurrence after the
   * first one within the window, which is correct behavior for a repeated-incident alert
   * (e.g. auth.login.repeated_failures) but wrong for a type where each occurrence is its own,
   * independently reportable event (bot review finding, PR #1304).
   */
  throttleWindowMinutes?: number;
  /**
   * Whether a user may opt individual channels (email/in_app) in or out for this type via
   * NotificationPreference. false only for ASVS V2.5.5-mandated self-audience account-security
   * receipts (e.g. "your password changed") - letting the account owner silence the one alert
   * meant to let them catch an unauthorized change on their own account would defeat its purpose.
   */
  userConfigurable: boolean;
  /**
   * Whether an organization may disable this type's channels via
   * NotificationSettings.disabled_channels. false for the same mandatory self-audience types as
   * userConfigurable, for the same reason.
   */
  orgDisableable: boolean;
}

/**
 * One notification occurrence, as raised by a call site. `type` is supplied separately to
 * notify(db, type, event) - kept out of this shape so call sites can't accidentally construct
 * an event whose `type` doesn't match the registry key notify() looks up.
 */
export interface NotificationEvent {
  organizationId: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  /** Required when the type's audience is "self" - the one recipient. Ignored otherwise. */
  targetUserId?: string;
  /**
   * Throttle dedupe subject - e.g. the attacked account, the user who logged in, the admin who
   * performed break-glass or changed a setting. Kept distinct from targetUserId (which is only
   * about audience resolution for "self", not throttle scoping): an org-staff-audience event
   * still needs a per-incident subject so two different admins' incidents don't collapse into
   * one throttled notification. Falls back to a per-organization-only key when omitted.
   *
   * Persisted verbatim and indefinitely in NotificationThrottle.dedupe_key with no purge job, so
   * prefer a stable internal id over a raw free-text/PII value where the call site already has
   * one - not because it's redacted before storage (it isn't - nothing passed to notify() is, see
   * buildDispatchedNotification's own doc comment in dispatcher.ts), just because an id is a
   * smaller, more stable thing to keep around forever than an email that could change.
   */
  dedupeKey?: string;
}

/**
 * What a NotificationChannel actually receives - the caller-supplied NotificationEvent plus the
 * `type` and `severity` resolved from the registry by dispatcher.ts. Kept separate from
 * NotificationEvent so call sites can't spoof severity (always registry-derived, never
 * call-site-supplied) and don't have to repeat `type` inside the event body they build.
 */
export type DispatchedNotification = NotificationEvent & {
  type: string;
  severity: NotificationSeverity;
};
