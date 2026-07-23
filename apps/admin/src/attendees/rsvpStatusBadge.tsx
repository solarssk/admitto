import { Badge } from "@admitto/ui";
import type { RsvpStatus } from "../api/types.js";

export const RSVP_LABELS: Record<RsvpStatus, string> = {
  confirmed: "Confirmed",
  tentative: "Tentative",
  declined: "Declined",
  cancelled: "Cancelled",
  none: "Registered",
};

const RSVP_VARIANTS: Record<RsvpStatus, "neutral" | "ok" | "error" | "warn"> = {
  none: "neutral",
  confirmed: "ok",
  declined: "error",
  tentative: "warn",
  cancelled: "error",
};

export function RsvpStatusBadge({ status }: Readonly<{ status: RsvpStatus }>) {
  return <Badge variant={RSVP_VARIANTS[status]}>{RSVP_LABELS[status]}</Badge>;
}
