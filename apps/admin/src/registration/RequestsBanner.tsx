import { Notice } from "@admitto/ui";
import type { RegistrationCountsDto } from "../api/types.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import { pluralize } from "../utils/pluralize.js";
import "./registration-requests.css";

/**
 * The line over the table that says how many requests wait for a decision, and when the oldest came in (in UTC, the same text for
 * every viewer). It stands while somebody waits and is gone when nobody does. The state and the age are chosen in the Filters.
 */
export function RequestsBanner({ counts }: Readonly<{ counts: RegistrationCountsDto | null }>) {
  const waiting = counts?.needs_decision ?? 0;
  if (waiting < 1) return null;
  const oldest = counts?.oldest_waiting_at;
  return (
    <div className="registration-requests__banner">
      <Notice variant="warning" icon="hourglass">
        <strong>
          {waiting} {pluralize(waiting, "request")} {waiting === 1 ? "waits" : "wait"} for your decision.
        </strong>
        {oldest ? (
          <>
            {" "}
            The oldest came in on <time dateTime={oldest}>{formatUtcDateTime(oldest)}</time>.
          </>
        ) : null}
      </Notice>
    </div>
  );
}
