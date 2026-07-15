import type { MailerStatus } from "../api/types.js";

const PROVIDER_LABELS: Record<string, string> = {
  smtp: "SMTP",
  graph: "Graph",
  powerautomate: "Power Automate",
  export_only: "Export only",
};

export function MailerStatusBadge({ status }: { status: MailerStatus | null | undefined }) {
  if (!status) return null;

  const name = status.provider ? (PROVIDER_LABELS[status.provider] ?? status.provider) : "—";
  const message = status.configured ? `Mailer configured (${name})` : "Mailer not configured";

  return (
    <span
      className={`status-circle status-circle--${status.configured ? "ok" : "neutral"} at-tooltip at-tooltip--below at-tooltip--left`}
      data-tooltip={message}
      role="img"
      aria-label={message}
    >
      <i className={`ti ${status.configured ? "ti-mail" : "ti-mail-off"}`} aria-hidden="true" />
    </span>
  );
}
