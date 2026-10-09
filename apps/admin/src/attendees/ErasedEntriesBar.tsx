import { hiddenErasedLine, shownErasedLine } from "./erasedAttendee.js";
import "./attendees.css";

/**
 * The line under the Attendees list that keeps the numbers honest while erased entries are left out
 * of it (the list shows 118, Reports show 120), with the switch to show them. Nothing when the
 * event has no erased entries.
 */
export function ErasedEntriesBar({
  count,
  shown,
  onShownChange,
}: Readonly<{ count: number; shown: boolean; onShownChange: (shown: boolean) => void }>) {
  if (count === 0) return null;
  return (
    <div className="attendees-erased-bar">
      <span role="status">{shown ? shownErasedLine(count) : hiddenErasedLine(count)}</span>
      <button type="button" className="link-btn" onClick={() => onShownChange(!shown)}>
        {shown ? "Hide erased" : "Show erased"}
      </button>
    </div>
  );
}
