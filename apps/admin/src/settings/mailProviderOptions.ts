import type { MailProvider } from "../api/types.js";

export type MailProviderOption = { value: MailProvider; label: string };

export const MAIL_PROVIDER_LABELS: Record<MailProvider, string> = {
  smtp: "SMTP",
  graph: "Microsoft Graph",
  powerautomate: "Power Automate",
  export_only: "Export only",
};

/** Provider select options — wizard uses mockup order/labels; settings keeps legacy order. */
export function buildMailProviderOptions(
  surface: "wizard" | "settings",
  includeExportOnly: boolean,
): MailProviderOption[] {
  const options: MailProviderOption[] =
    surface === "wizard"
      ? [
          { value: "smtp", label: "SMTP (recommended)" },
          { value: "graph", label: "Microsoft Graph" },
          { value: "powerautomate", label: "Power Automate webhook" },
        ]
      : [
          { value: "smtp", label: "SMTP (DuoCircle)" },
          { value: "graph", label: "Microsoft Graph" },
          { value: "powerautomate", label: "Power Automate" },
        ];

  if (includeExportOnly) {
    options.push({ value: "export_only", label: "Export only (dev/test)" });
  }

  return options;
}
