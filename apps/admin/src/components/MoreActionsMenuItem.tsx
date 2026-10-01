import type { ReactNode } from "react";
import { Spinner, Tooltip } from "@admitto/ui";
import "./more-actions-menu.css";

/** One row in a More actions panel: icon, two-line label/hint, optional disabled-reason
 * tooltip, and an optional warning/danger text-color variant. Always wrapped in a Tooltip,
 * even when `tooltip` is undefined: Tooltip renders children unchanged with no tooltip
 * wiring in that case, and `.more-actions-menu__item-wrapper` keeps stacked list layout.
 *
 * `loading` is the busy state of the action the row starts (the same contract as `<Button loading>`):
 * the icon is replaced by a spinner in the same slot, the row is `aria-busy` and `aria-disabled` (a
 * click does nothing, but it keeps its focus, so arrow keys carry on from it), and the label becomes
 * `loadingLabel` ("Sending…"). Pass it (true or false) for every action that can be busy; a row that
 * never passes it renders exactly as before.
 *
 * `loadingLabel` swaps the text instead of reserving both, and the menu is as wide as its widest row,
 * so pass one only when it is not longer than `label` ("Send tickets" → "Sending…"); otherwise leave it
 * out and the spinner alone marks the row busy. */
export function MoreActionsMenuItem({
  icon,
  label,
  hint,
  disabled = false,
  tooltip,
  variant,
  loading,
  loadingLabel,
  onClick,
  className,
}: Readonly<{
  icon: string;
  label: ReactNode;
  hint: ReactNode;
  disabled?: boolean;
  tooltip?: string | null;
  variant?: "warning" | "danger";
  /** Busy state of this row's own action. `undefined` means the row is not busy-aware. */
  loading?: boolean;
  /** Label while `loading`: the verb of this action ("Sending…"). Defaults to `label`. */
  loadingLabel?: ReactNode;
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
        disabled={disabled && loading !== true}
        aria-disabled={loading === true || undefined}
        aria-busy={loading || undefined}
        onClick={(event) => {
          // Swallowed whole while busy, as `disabled` used to: no second run, nothing reaches the menu.
          if (loading === true) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onClick();
        }}
      >
        {loading === undefined ? (
          <i className={`ti ti-${icon}`} aria-hidden="true" />
        ) : (
          <span className="more-actions-menu__icon">
            <i className={`ti ti-${icon}`} aria-hidden="true" />
            <Spinner size="sm" aria-hidden="true" />
          </span>
        )}
        <span className="more-actions-menu__item-text">
          <span>{loading ? (loadingLabel ?? label) : label}</span>
          <span className="more-actions-menu__item-hint">{hint}</span>
        </span>
      </button>
    </Tooltip>
  );
}
