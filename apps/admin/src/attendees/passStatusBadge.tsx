import { Badge } from "@admitto/ui";
import type { AttendeeStatus } from "@admitto/db/status";

export const PASS_STATUS_LABELS: Record<AttendeeStatus, string> = {
  registered: "Active",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  revoked: "Revoked",
};

const PASS_STATUS_VARIANTS: Record<AttendeeStatus, "neutral" | "ok" | "error"> = {
  registered: "ok",
  confirmed: "ok",
  cancelled: "neutral",
  revoked: "error",
};

export function PassStatusBadge({ status }: Readonly<{ status: AttendeeStatus }>) {
  return <Badge variant={PASS_STATUS_VARIANTS[status]}>{PASS_STATUS_LABELS[status]}</Badge>;
}
