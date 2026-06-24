import { Badge } from "@admitto/ui";
import type { RsvpStatus } from "../api/types.js";

export const RSVP_LABELS: Record<RsvpStatus, string> = {
  none: "Registered",
  confirmed: "Confirmed",
  declined: "Declined",
  tentative: "Tentative",
  cancelled: "Cancelled",
};

const RSVP_VARIANTS: Record<RsvpStatus, "neutral" | "ok" | "error" | "warn"> = {
  none: "neutral",
  confirmed: "ok",
  declined: "error",
  tentative: "warn",
  cancelled: "error",
};

export function RsvpStatusBadge({ status }: { status: RsvpStatus }) {
  return (
    <Badge variant={RSVP_VARIANTS[status]} dot>
      {RSVP_LABELS[status]}
    </Badge>
  );
}
