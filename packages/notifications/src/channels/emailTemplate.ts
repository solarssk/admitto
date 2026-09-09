/**
 * Severity color/label maps shared by the email channel's HTML content builder
 * (emailContent.ts, consumed by email.ts) and the Discord embed color in webhook.ts. Every
 * notification type renders through the same shared system-email shell
 * (@admitto/mail-templates's emailShell.ts, also used by the mail transport test) - no per-type
 * visual design.
 */

/** Same 3 severities as NotificationSeverity/SystemLogLevel - hex values match
 * packages/ui/src/styles/tokens/colors.css (--status-error/--status-warn/--status-info), the
 * same source ADR 0038 §4 already draws Discord embed colors from. */
export const SEVERITY_COLOR: Record<"info" | "warn" | "error", string> = {
  info: "#4299e1",
  warn: "#f59f00",
  error: "#d63939",
};

export const SEVERITY_LABEL: Record<"info" | "warn" | "error", string> = {
  info: "Info",
  warn: "Warning",
  error: "Alert",
};
