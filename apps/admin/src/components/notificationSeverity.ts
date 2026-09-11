/**
 * Matches the colored-circle severity badge the actual notification email renders (see
 * packages/notifications/src/channels/emailContent.ts) - same three severities, same meaning,
 * just a live Tabler icon here instead of a baked PNG. Shared by every place that lists
 * notification types by severity (organisation settings' type matrix, the personal preferences
 * grid, the topbar bell's inbox) rather than redefined per file.
 */
export const NOTIFICATION_SEVERITY_ICON: Record<string, string> = {
  info: "ti-info-circle",
  warn: "ti-alert-triangle",
  error: "ti-alert-circle",
};
