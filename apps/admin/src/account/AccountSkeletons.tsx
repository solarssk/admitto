import type { ReactNode } from "react";
import { Skeleton } from "@admitto/ui";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import "./account-page.css";

interface SkeletonRegionProps {
  /** What is loading ("Loading sessions"): the region's accessible name. The shapes are decoration. */
  label: string;
  /** After 8 seconds the region says it is taking longer than usual. */
  slow: boolean;
  /** Not painted yet (the 200ms before a placeholder shows): the space is in the page, nothing is drawn. */
  held?: boolean;
  className?: string;
  children: ReactNode;
}

/** A status region around placeholder shapes, with the 8 second message as its last line. */
function SkeletonRegion({ label, slow, held = false, className, children }: Readonly<SkeletonRegionProps>) {
  const cls = [className, held ? "at-loading-hold" : undefined].filter(Boolean).join(" ");
  return (
    <output aria-label={label} className={cls || undefined}>
      {children}
      {/* gridColumn: a full row when the region is the two-column profile grid, ignored in a stack. */}
      {slow ? (
        <span className="at-hint" style={{ gridColumn: "1 / -1" }}>
          {SLOW_NOTICE_TEXT}
        </span>
      ) : null}
    </output>
  );
}

/**
 * The profile form while the account loads: a label, a control and a hint per field, four rows of two,
 * laid out by the form's own grid (`account-profile-editable`) and field gap, so the form that replaces
 * it is about as tall and nothing below it jumps. The controls are the real 36px.
 */
export function ProfileFieldsSkeleton({ slow }: Readonly<{ slow: boolean }>) {
  return (
    <SkeletonRegion label="Loading account" slow={slow} className="account-profile-editable">
      {Array.from({ length: 8 }, (_, i) => (
        <div className="at-field" key={i}>
          <Skeleton variant="rect" width="28%" height={14} />
          <Skeleton variant="rect" height={36} />
          <Skeleton variant="rect" width="45%" height={12} />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** A card's list or table while it loads: one bar per row. */
export function RowsSkeleton({
  label,
  slow,
  held,
  rows,
  rowHeight,
}: Readonly<{ label: string; slow: boolean; held: boolean; rows: number; rowHeight: number }>) {
  return (
    <SkeletonRegion label={label} slow={slow} held={held} className="at-skeleton-stack">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} variant="rect" height={rowHeight} />
      ))}
    </SkeletonRegion>
  );
}
