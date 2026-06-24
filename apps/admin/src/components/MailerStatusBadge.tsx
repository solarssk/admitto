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

  return (
    <span
      className="topbar__mailer"
      title={status.configured ? "Mailer configured" : "Mailer not configured"}
    >
      <span
        className={`topbar__mailer-dot${status.configured ? " topbar__mailer-dot--ok" : ""}`}
        aria-hidden="true"
      />
      <span className="topbar__mailer-label">Mailer: {name}</span>
    </span>
  );
}
