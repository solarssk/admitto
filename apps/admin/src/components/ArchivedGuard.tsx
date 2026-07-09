import type { ReactNode } from "react";

/** Standard tooltip copy shown on any control disabled because its event is archived. */
export const ARCHIVED_ACTION_TOOLTIP = "This event is archived — editing is disabled.";

export interface ArchivedGuardEvent {
  archived_at?: string | Date | null;
}

/** True once the event has been archived — archived events are fully read-only everywhere in admin. */
export function isEventArchived(event: ArchivedGuardEvent | null | undefined): boolean {
  return event?.archived_at != null;
}

export interface ArchivedGuardRenderProps {
  disabled: boolean;
  "aria-describedby"?: string;
}

export interface ArchivedGuardProps {
  /** The event to check — disables children and shows a tooltip once `archived_at` is set. */
  event: ArchivedGuardEvent | null | undefined;
  /** Unique id for the hidden screen-reader description span. Must be unique per rendered instance — include a row/item id in list contexts. */
  reasonId: string;
  /** An existing, unrelated disabled condition (e.g. a save-in-flight state) to combine with the archived lock. */
  disabled?: boolean;
  /** Tooltip shown when disabled for a reason other than archiving. Ignored once the event is archived — the archived reason always wins. */
  tooltip?: string;
  /**
   * Tooltip growth direction. Defaults to `"above"` (pops upward, the usual case).
   * Use `"below"` for controls that sit near the very top of a scrollable page
   * (e.g. a toolbar right under the header) — there, the default upward placement
   * gets visually clipped by the scroll container's overflow boundary before it
   * can render.
   */
  placement?: "above" | "below";
  /** Render prop — spread the returned props onto the single interactive control (Button/IconButton/Switch/input/select). */
  children: (guard: ArchivedGuardRenderProps) => ReactNode;
}

/**
 * Wraps a single interactive control (Button/IconButton/Switch/input/select) so it
 * becomes disabled with a dark hover tooltip (`.at-tooltip`, staff.css) once the
 * event is archived — archived events are fully read-only, so any control that
 * could change something on the event stops working and explains why on hover.
 *
 * The tooltip lives on a wrapping `<span>`, not the control itself: disabled
 * buttons/icon-buttons dim via `opacity`, which would otherwise wash out the
 * tooltip's own dark background (same reasoning as the Requirements page's
 * existing "Delete item" tooltip on the default Badge item).
 */
export function ArchivedGuard({
  event,
  reasonId,
  disabled: fallbackDisabled = false,
  tooltip: fallbackTooltip,
  placement = "above",
  children,
}: ArchivedGuardProps) {
  const archived = isEventArchived(event);
  const disabled = archived || fallbackDisabled;
  const tooltip = archived ? ARCHIVED_ACTION_TOOLTIP : fallbackTooltip;
  const showTooltip = disabled && !!tooltip;
  const tooltipClass = showTooltip
    ? `at-tooltip${placement === "below" ? " at-tooltip--below" : ""}`
    : undefined;

  // Always render the same wrapping <span>, even when there's nothing to show right
  // now: some callers' fallback disabled/tooltip condition (e.g. "badge item is
  // inactive") can flip on and off while the page stays mounted. Conditionally
  // rendering the wrapper only when a tooltip is needed would swap the child
  // control's parent element type between renders, which makes React unmount and
  // remount the control (losing focus/DOM identity) every time the reason
  // appears or disappears — keeping the wrapper stable avoids that entirely.
  return (
    <span className={tooltipClass} data-tooltip={showTooltip ? tooltip : undefined}>
      {showTooltip && (
        <span id={reasonId} className="sr-only">
          {tooltip}
        </span>
      )}
      {children({ disabled, "aria-describedby": showTooltip ? reasonId : undefined })}
    </span>
  );
}
