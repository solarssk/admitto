import { Skeleton } from "@admitto/ui";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";

/**
 * The placeholder of a list of rows inside a card whose title and actions are already there (the identity providers, the
 * ticket types): rows of the height of the real ones, in a status region named after what is loading. `held` is the first
 * 200ms, when the room is reserved and nothing is drawn; after 8 seconds (`slow`) the region says it is taking longer than
 * usual.
 */
export function RowsSkeleton({
  label,
  held,
  slow,
  rows,
  rowHeight,
}: Readonly<{ label: string; held: boolean; slow: boolean; rows: number; rowHeight: number }>) {
  return (
    <output aria-label={label} className={held ? "rows-skeleton at-loading-hold" : "rows-skeleton"}>
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton key={row} height={rowHeight} />
      ))}
      {slow ? <span className="at-hint" style={{ textAlign: "center", color: "var(--text-secondary)" }}>{SLOW_NOTICE_TEXT}</span> : null}
    </output>
  );
}
