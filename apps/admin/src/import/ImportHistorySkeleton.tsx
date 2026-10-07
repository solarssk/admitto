import { Skeleton } from "@admitto/ui";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import "../attendees/attendees.css";
import "../pages/import.css";

/** The real column headings of the table, so they do not flicker when the rows arrive. */
const COLUMNS = ["Date", "File", "Status", "Created", "Updated", "Skipped"] as const;
const ROWS = 4;
/** The bar inside a row of the real history (42px with its cell padding, 41px with a bar of 20), measured in Chrome. */
const ROW_HEIGHT = 21;

/**
 * The import history while its first read runs: the table with the real column headings and rows as tall as real ones, in a
 * status region named after what is loading. `held` is the first 200ms, when the room is reserved and nothing is drawn; after
 * 8 seconds (`slow`) the region says it is taking longer than usual.
 */
export function ImportHistorySkeleton({ held, slow }: Readonly<{ held: boolean; slow: boolean }>) {
  return (
    <output aria-label="Loading import history" className={held ? "import-history-skeleton at-loading-hold" : "import-history-skeleton"}>
      <div className="attendees-table-wrap" aria-hidden="true">
        <table className="table import-history-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, row) => (
              <tr key={row}>
                <td colSpan={COLUMNS.length}>
                  <Skeleton variant="rect" height={ROW_HEIGHT} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {slow ? <span className="at-hint import-history-skeleton__note">{SLOW_NOTICE_TEXT}</span> : null}
    </output>
  );
}
