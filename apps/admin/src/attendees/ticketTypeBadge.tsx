import { Badge, TicketTypeBadge as UiTicketTypeBadge } from "@admitto/ui";
import type { TicketTypeDto } from "../api/types.js";

/** Resolves an attendee's raw `ticket_type` key against the event's live catalog and renders the
 * shared DS badge - the single place ticket-type color is decided (batch 04 / #351). An
 * unmatched/legacy value (pre-catalog data, or a stale reference to a since-deleted type) still
 * renders, in neutral gray with the raw string, instead of silently disappearing. */
export function TicketTypeBadge({
  ticketType,
  catalog,
}: {
  ticketType: string | null;
  catalog: TicketTypeDto[];
}) {
  if (!ticketType) {
    return <Badge variant="neutral">—</Badge>;
  }
  const found = catalog.find((t) => t.key === ticketType);
  return <UiTicketTypeBadge label={found?.label ?? ticketType} color={found?.color ?? "gray"} />;
}
