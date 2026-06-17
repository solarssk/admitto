import { Badge } from "@admitto/ui";

export function TicketTypeBadge({ ticketType }: { ticketType: string | null }) {
  if (!ticketType) {
    return <Badge variant="neutral">—</Badge>;
  }
  if (ticketType.toLowerCase() === "vip") {
    return <Badge variant="vip">VIP</Badge>;
  }
  return <Badge variant="neutral">{ticketType}</Badge>;
}
