import type { CheckInHistoryEntry } from "../api/types.js";
import { formatAdmissionDisplay } from "../utils/event-dates.js";

function statusLabel(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "admitted" || normalized === "valid") return "Checked in";
  if (normalized === "already_checked_in") return "Already c-in";
  if (normalized === "revoked") return "Ticket rev.";
  if (normalized === "invalid") return "Invalid";
  return status.replace(/_/g, " ");
}

function dotClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "admitted" || normalized === "valid") return "rec-dot--admitted";
  if (normalized === "already_checked_in") return "rec-dot--already_checked_in";
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
            <li key={row.id} className="ck-recent__row">
              <span className={`rec-dot ${dotClass(row.status)}`} aria-hidden="true" />
              <div className="ck-recent__body">
                <div className="ck-recent__line">
                  <strong>{row.attendee.name}</strong>
                  <span className="ck-recent__status">{statusLabel(row.status)}</span>
                  <time>{formatAdmissionDisplay(row.checked_in_at, eventDate, eventTimezone)}</time>
                </div>
                {row.attendee.ticket_type && (
                  <span className="ck-recent__ticket">{row.attendee.ticket_type}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
