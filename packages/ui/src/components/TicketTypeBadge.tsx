import type { HTMLAttributes } from "react";
import { Badge } from "./Badge.js";

export type TicketTypeColor = "gray" | "blue" | "green" | "yellow" | "red" | "azure" | "teal" | "purple";

/** Curated color palette for admin-assignable categories (a per-event ticket-type catalog,
 * batch 04 / #351) - deliberately not part of Badge's fixed `variant` union (status-map.ts),
 * since a type's color is admin data, not a fixed system enum. Every entry pairs a semantic
 * `-fg`/`-tint` token from tokens/colors.css, matching how the fixed status variants already do. */
export const TICKET_TYPE_COLORS: Record<TicketTypeColor, { label: string; solid: string; tint: string }> = {
  gray: { label: "Gray", solid: "var(--at-gray-600)", tint: "var(--at-gray-100)" },
  blue: { label: "Blue", solid: "var(--primary-active)", tint: "var(--primary-tint)" },
  green: { label: "Green", solid: "var(--status-ok-fg)", tint: "var(--status-ok-tint)" },
  yellow: { label: "Yellow", solid: "var(--status-warn-fg)", tint: "var(--status-warn-tint)" },
  red: { label: "Red", solid: "var(--status-error-fg)", tint: "var(--status-error-tint)" },
  azure: { label: "Azure", solid: "var(--status-info-fg)", tint: "var(--status-info-tint)" },
  teal: { label: "Teal", solid: "var(--status-confirmed-fg)", tint: "var(--status-confirmed-tint)" },
  purple: { label: "Purple", solid: "var(--status-vip-fg)", tint: "var(--status-vip-tint)" },
};

export interface TicketTypeBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
  /** @default "gray" */
  color?: TicketTypeColor;
}

/** Badge for an admin-defined ticket type - unlike StatusBadge (fixed system enum), both label
 * and color are data here, sourced from the event's TicketType catalog. */
export function TicketTypeBadge({ label, color = "gray", style, ...rest }: TicketTypeBadgeProps) {
  const c = TICKET_TYPE_COLORS[color] ?? TICKET_TYPE_COLORS.gray;
  return (
    <Badge style={{ background: c.tint, color: c.solid, ...style }} {...rest}>
      {label}
    </Badge>
  );
}
