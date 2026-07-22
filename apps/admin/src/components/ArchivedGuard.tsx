import type { ReactNode } from "react";
import { Tooltip } from "@admitto/ui";

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
  /** Render prop — spread the returned props onto the single interactive control (Button/IconButton/Switch/input/select). */
  children: (guard: ArchivedGuardRenderProps) => ReactNode;
}

/**
 * Wraps a single interactive control (Button/IconButton/Switch/input/select) so it
 * becomes disabled with a hover/focus tooltip (`Tooltip`, @admitto/ui) once the
 * event is archived — archived events are fully read-only, so any control that
 * could change something on the event stops working and explains why on hover.
 */
export function ArchivedGuard({
  event,
  reasonId,
  disabled: fallbackDisabled = false,
  tooltip: fallbackTooltip,
  children,
}: Readonly<ArchivedGuardProps>) {
  const archived = isEventArchived(event);
  const disabled = archived || fallbackDisabled;
  const tooltip = archived ? ARCHIVED_ACTION_TOOLTIP : fallbackTooltip;
  const showTooltip = disabled && !!tooltip;

  return (
    <Tooltip content={showTooltip ? tooltip : undefined}>
      {showTooltip && (
        <span id={reasonId} className="sr-only">
          {tooltip}
        </span>
      )}
      {children({ disabled, "aria-describedby": showTooltip ? reasonId : undefined })}
    </Tooltip>
  );
}
