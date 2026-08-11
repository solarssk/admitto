import type { ReactNode } from "react";
import { Tooltip } from "@admitto/ui";
import "./more-actions-menu.css";

/** One row in a More actions panel: icon, two-line label/hint, optional disabled-reason
 * tooltip, and an optional warning/danger text-color variant. Always wrapped in a Tooltip,
 * even when `tooltip` is undefined: Tooltip renders children unchanged with no tooltip
 * wiring in that case, and `.more-actions-menu__item-wrapper` keeps stacked list layout. */
export function MoreActionsMenuItem({
  icon,
  label,
  hint,
  disabled = false,
  tooltip,
  variant,
  onClick,
  className,
}: Readonly<{
  icon: string;
  label: ReactNode;
  hint: ReactNode;
  disabled?: boolean;
  tooltip?: string | null;
  variant?: "warning" | "danger";
  onClick: () => void;
  /** Extra class(es) on the item's wrapper, e.g. to show/hide a specific item at a breakpoint. */
  className?: string;
}>) {
  return (
    <Tooltip
      content={tooltip}
      className={["more-actions-menu__item-wrapper", className].filter(Boolean).join(" ")}
      axis="horizontal"
    >
      <button
        type="button"
        role="menuitem"
        className={["more-actions-menu__item", variant && `more-actions-menu__item--${variant}`]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        onClick={onClick}
      >
        <i className={`ti ti-${icon}`} aria-hidden="true" />
        <span className="more-actions-menu__item-text">
          <span>{label}</span>
          <span className="more-actions-menu__item-hint">{hint}</span>
        </span>
      </button>
    </Tooltip>
  );
}
