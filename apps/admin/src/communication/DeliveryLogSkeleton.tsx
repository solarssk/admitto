import { Skeleton } from "@admitto/ui";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import "../components/item-table.css";
import "./communication.css";
import "./delivery-log-table.css";

/** The real column headings of the table, so they do not flicker when the rows arrive. */
const COLUMNS = ["Recipient", "Template", "Purpose", "Status", "Sent / Queued"] as const;
/** The two that a screen under 1280px folds into the recipient's cell (delivery-log-table.css): the heading of a folded one has no width there either. */
const FOLDED = new Set<string>(["Template", "Purpose"]);
const ROWS = 6;
const CARDS = 3;
/**
 * The bar inside a row (65px with its cell padding, as a row of a recipient with an e-mail address is) and inside a card (131px with its padding and
 * border, 150px when it also has a local-time line) of the real log, measured in Chrome.
 */
const ROW_HEIGHT = 41;
const CARD_HEIGHT = 115;

/**
 * The delivery log while its first read runs: the table with the real column headings (or the stacked cards, for the narrow
 * layout the real list switches to), rows as tall as real ones, in a status region named after what is loading. `held` is
 * the first 200ms, when the room is reserved and nothing is drawn; after 8 seconds (`slow`) the region says it is taking
 * longer than usual.
 */
export function DeliveryLogSkeleton({ held, slow, desktop }: Readonly<{ held: boolean; slow: boolean; desktop: boolean }>) {
  return (
    <output aria-label="Loading delivery log" className={held ? "delivery-log-skeleton at-loading-hold" : "delivery-log-skeleton"}>
      {desktop ? (
        <div className="item-table delivery-log-box" aria-hidden="true">
          <div className="attendees-table-wrap">
            <table className="table communication-table">
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column} className={FOLDED.has(column) ? "delivery-log-table__from-1280" : undefined}>
                      {column}
                    </th>
                  ))}
                  <th className="communication-row-menu-cell" />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: ROWS }, (_, row) => (
                  <tr key={row}>
                    <td colSpan={COLUMNS.length + 1}>
                      <Skeleton variant="rect" height={ROW_HEIGHT} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="communication-cards" aria-hidden="true">
          {Array.from({ length: CARDS }, (_, card) => (
            <div key={card} className="communication-card">
              <Skeleton variant="rect" height={CARD_HEIGHT} />
            </div>
          ))}
        </div>
      )}
      {slow ? <span className="at-hint delivery-log-skeleton__note">{SLOW_NOTICE_TEXT}</span> : null}
    </output>
  );
}
