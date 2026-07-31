import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip.js";

export interface HintLabelProps {
  /** One-line explanation shown on hover or focus. */
  hint: string;
  /** The label text the hint is attached to - a card title or a table column header. */
  children: ReactNode;
}

/**
 * Label with an info-circle icon that reveals a one-line explanation on hover or focus.
 * For a card title or column header whose purpose isn't obvious from the label alone.
 */
export function HintLabel({ hint, children }: Readonly<HintLabelProps>) {
  return (
    <Tooltip content={hint} className="at-hint-label">
      {children} <i className="ti ti-info-circle" aria-hidden="true" />
    </Tooltip>
  );
}
