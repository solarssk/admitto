import { Badge } from "@admitto/ui";

const MAIL_LABELS: Record<string, { label: string; variant: "neutral" | "ok" | "error" | "warn" }> = {
  delivered: { label: "Sent", variant: "ok" },
  sent: { label: "Sent", variant: "ok" },
  failed: { label: "Failed", variant: "error" },
  rejected: { label: "Failed", variant: "error" },
  bounced: { label: "Bounced", variant: "error" },
  pending: { label: "Pending", variant: "warn" },
  queued: { label: "Pending", variant: "warn" },
  accepted: { label: "Pending", variant: "warn" },
};

export function MailStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <Badge variant="neutral" dot={false}>—</Badge>;
  }
  const mapped = MAIL_LABELS[status] ?? { label: status, variant: "neutral" as const };
  return (
    <Badge variant={mapped.variant} dot>
      {mapped.label}
    </Badge>
  );
}
