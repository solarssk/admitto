import { TicketTypeBadge as UiTicketTypeBadge } from "@admitto/ui";
import type { TicketTypeDto } from "../api/types.js";

/** Resolves a raw `ticket_type` catalog key to its current display label - fail-open, so an
 * unmatched/legacy value (pre-catalog data, or a stale reference to a since-deleted type) still
 * renders as the raw string instead of disappearing. Shared by every ticket-type surface that
 * renders plain text rather than the full `TicketTypeBadge` chip below (e.g. a compact row that
 * joins the label with another field into one line). */
export function resolveTicketTypeLabel(
  ticketType: string | null,
  catalog: TicketTypeDto[],
): string | null {
  if (!ticketType) return ticketType;
  return catalog.find((t) => t.key === ticketType)?.label ?? ticketType;
}

/** Resolves an attendee's raw `ticket_type` key against the event's live catalog and renders the
 * shared DS badge - the single place ticket-type color is decided (batch 04 / #351). An
 * unmatched/legacy value (pre-catalog data, or a stale reference to a since-deleted type) still
 * renders, in neutral gray with the raw string, instead of silently disappearing. */
export function TicketTypeBadge({
  ticketType,
  catalog = [],
}: {
  ticketType: string | null;
  catalog?: TicketTypeDto[];
}) {
  if (!ticketType) {
    return <span className="attendee-readonly">—</span>;
  }
  const found = catalog.find((t) => t.key === ticketType);
  return <UiTicketTypeBadge label={found?.label ?? ticketType} color={found?.color ?? "gray"} />;
}
