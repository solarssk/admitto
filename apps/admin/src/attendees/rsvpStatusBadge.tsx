import { Badge } from "@admitto/ui";
import type { RsvpStatus } from "../api/types.js";
import type { SearchableSelectOption } from "../components/SearchableSelect.js";

export const RSVP_LABELS: Record<RsvpStatus, string> = {
  confirmed: "Confirmed",
  tentative: "Tentative",
  declined: "Declined",
  cancelled: "Cancelled",
  none: "Registered",
};

export const RSVP_VARIANTS: Record<RsvpStatus, "neutral" | "ok" | "error" | "warn"> = {
  none: "neutral",
  confirmed: "ok",
  declined: "error",
  tentative: "warn",
  cancelled: "error",
};

// Tabler icon names (without the `ti-` prefix) - same neutral/ok/warn/error grouping as
// RSVP_VARIANTS above, so the icon and the badge colour always agree.
export const RSVP_ICONS: Record<RsvpStatus, string> = {
  none: "user",
  confirmed: "circle-check",
  declined: "circle-x",
  tentative: "help-circle",
  cancelled: "ban",
};

// Display order shared by every attendance picker in the admin SPA (Edit attendee, the
// Attendees list filter, and Communication's "send to attendance status" filter) - not object
// key order, which doesn't match this UI order.
const RSVP_STATUS_ORDER: readonly RsvpStatus[] = ["none", "confirmed", "declined", "tentative", "cancelled"];

export const RSVP_STATUS_OPTIONS: SearchableSelectOption[] = RSVP_STATUS_ORDER.map((status) => ({
  id: status,
  label: RSVP_LABELS[status],
  icon: RSVP_ICONS[status],
}));

export function RsvpStatusBadge({ status }: Readonly<{ status: RsvpStatus }>) {
  return <Badge variant={RSVP_VARIANTS[status]}>{RSVP_LABELS[status]}</Badge>;
}
