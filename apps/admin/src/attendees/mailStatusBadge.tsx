import { Badge, resolveStatusMeta } from "@admitto/ui";

export function MailStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <Badge variant="neutral" dot={false}>
        Not sent
      </Badge>
    );
  }
  const meta = resolveStatusMeta(status);
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
