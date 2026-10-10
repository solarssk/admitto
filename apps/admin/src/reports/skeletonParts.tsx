import { Skeleton } from "@admitto/ui";
import { assertPresent } from "../utils/assert-present.js";

/** The widths of the names in a breakdown, one after the other (a placeholder has no data to take them from). */
const NAME_WIDTHS = [120, 96, 140, 104, 88, 112] as const;

/** One row of a breakdown card: a dot, a name and its figures over the track of a bar. */
function BreakdownRowSkeleton({ nameWidth }: Readonly<{ nameWidth: number }>) {
  return (
    <div className="reports-breakdown-row">
      <div className="reports-breakdown-row__head">
        <Skeleton variant="circle" width={9} height={9} />
        <span className="reports-breakdown-row__name">
          <Skeleton variant="rect" width={nameWidth} height={14} />
        </span>
        <Skeleton variant="rect" width={48} height={12} />
      </div>
      <Skeleton variant="rect" height={7} />
    </div>
  );
}

/** A breakdown card's list: `rows` rows, with names of varying width. */
export function BreakdownSkeleton({ rows }: Readonly<{ rows: number }>) {
  return (
    <div className="reports-breakdown-list">
      {Array.from({ length: rows }, (_, row) => {
        const nameWidth = NAME_WIDTHS[row % NAME_WIDTHS.length];
        assertPresent(nameWidth);
        return <BreakdownRowSkeleton key={row} nameWidth={nameWidth} />;
      })}
    </div>
  );
}
