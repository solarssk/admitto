import { Badge, resolveStatusMeta } from "@admitto/ui";

export function MailStatusBadge({ status }: Readonly<{ status: string | null }>) {
  if (!status) {
    return (
      <Badge variant="neutral" dot={false}>
        Not sent
      </Badge>
    );
  }
  // "cancelled" here is always an EmailDelivery status, not the unrelated attendee/RSVP
  // "cancelled" that owns that key in the shared STATUS_MAP (a red error badge) - remap so a
  // deliberately-stopped send doesn't render as a delivery failure.
  const meta = resolveStatusMeta(status === "cancelled" ? "mail_cancelled" : status);
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
