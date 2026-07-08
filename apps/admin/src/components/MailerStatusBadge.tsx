import { Badge } from "@admitto/ui";
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
    <Badge
      variant={status.configured ? "ok" : "neutral"}
      title={status.configured ? "Mailer configured" : "Mailer not configured"}
    >
      <span className="topbar__mailer-label">Mailer: {name}</span>
    </Badge>
  );
}
