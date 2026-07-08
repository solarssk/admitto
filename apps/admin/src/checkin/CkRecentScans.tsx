import type { CheckInHistoryEntry } from "../api/types.js";
import { formatAdmissionDisplay } from "../utils/event-dates.js";

// A CheckIn row with status UNDO is a reversal, not an admission — source
// tells us whether the operator undid their own scan or an admin revoked the
// attendee's check-in later (#449 review); both need their own label/dot so
// the sidebar doesn't keep showing a reversed admission as still "Checked in".
function statusLabel(status: string, source: string | null): string {
  const normalized = status.toLowerCase();
  if (normalized === "admitted" || normalized === "valid") return "Checked in";
  if (normalized === "already_checked_in") return "Already c-in";
  if (normalized === "undo") return source === "admin_revoke" ? "Revoked" : "Undone";
  if (normalized === "revoked") return "Ticket rev.";
  if (normalized === "invalid") return "Invalid";
  return status.replace(/_/g, " ");
}

function dotClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "admitted" || normalized === "valid") return "rec-dot--admitted";
  if (normalized === "already_checked_in") return "rec-dot--already_checked_in";
  if (normalized === "undo") return "rec-dot--undo";
  if (normalized === "revoked") return "rec-dot--revoked";
  return "rec-dot--invalid";
}

type CkRecentScansProps = {
  history: CheckInHistoryEntry[];
  eventTimezone: string;
  eventDate?: string | null;
  compact?: boolean;
  limit?: number;
};

export function CkRecentScans({
  history,
  eventTimezone,
  eventDate = null,
  compact = false,
  limit,
}: CkRecentScansProps) {
  const rows = limit != null ? history.slice(0, limit) : history;
  const count = history.length;

  return (
    <div className={`ck-recent${compact ? " ck-recent--compact" : ""}`}>
      <div className="ck-recent__header">
        <span className="ck-recent__title">Recent scans</span>
        <span className="ck-recent__count">{count}</span>
      </div>
      {rows.length === 0 ? (
        <p className="ck-recent__empty">No scans yet</p>
      ) : (
        <ul className="ck-recent__list">
          {rows.map((row) => (
            // Mockup ci-row: dot | info (name + ticket, left) | right (status + time).
            <li key={row.id} className="ck-recent__row">
              <span className={`rec-dot ${dotClass(row.status)}`} aria-hidden="true" />
              <div className="ck-recent__info">
                <strong className="ck-recent__name">{row.attendee.name}</strong>
                {row.attendee.ticket_type && (
                  <span className="ck-recent__ticket">{row.attendee.ticket_type}</span>
                )}
              </div>
              <div className="ck-recent__right">
                <span className="ck-recent__status">{statusLabel(row.status, row.source)}</span>
                <time>{formatAdmissionDisplay(row.checked_in_at, eventDate, eventTimezone)}</time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
