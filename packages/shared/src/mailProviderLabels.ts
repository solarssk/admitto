/** Mail transport provider identifiers - kept here (not @admitto/mailer, which is server-only
 * and unsafe to import from apps/admin) so the display label stays a single source of truth
 * between the transport-test diagnostic email (@admitto/mail-delivery) and the admin Settings
 * provider dropdown, instead of two independently hand-copied maps that could drift. */
export type MailProviderId = "smtp" | "graph" | "powerautomate" | "export_only";

export const MAIL_PROVIDER_LABELS: Record<MailProviderId, string> = {
  smtp: "SMTP",
  graph: "Microsoft Graph",
  powerautomate: "Power Automate",
  export_only: "Export only",
};
