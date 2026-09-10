export type {
  NotificationSeverity,
  NotificationChannelKey,
  NotificationAudienceKey,
  NotificationTypeDef,
  NotificationEvent,
  DispatchedNotification,
} from "./types.js";
export type { NotificationChannel, NotificationSendResult } from "./channel.js";
export { NOTIFICATION_TYPES, getNotificationTypeDef } from "./registry.js";
export {
  resolveAudienceCandidates,
  NotImplementedError,
  type AudienceContext,
} from "./audience.js";
export {
  resolveEnabledChannels,
  resolvePersonalPreferences,
  setNotificationPreference,
} from "./preferences.js";
export { notify, type DispatchDeps } from "./dispatcher.js";
export { EmailChannel, type EmailChannelOptions } from "./channels/email.js";
export {
  WebhookChannel,
  assertSafeWebhookUrl,
  BlockedWebhookUrlError,
  type WebhookChannelOptions,
  type WebhookKind,
} from "./channels/webhook.js";
export { InAppChannel } from "./channels/inApp.js";
export {
  describeNotificationSettings,
  patchNotificationSettings,
  type NotificationEmailRecipient,
  type NotificationSettingsPublic,
  type NotificationSettingsPatch,
} from "./settings.js";
export {
  describePersonalNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type PersonalNotification,
} from "./inbox.js";
