import type { CheckInHistoryEntry } from "../api/types.js";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

type ScanHistoryListProps = {
  admittedCount: number;
  history: CheckInHistoryEntry[];
};

export function ScanHistoryList({ admittedCount, history }: ScanHistoryListProps) {
  return (
    <>
      <p className="checkin-aside__count">
        <strong>{admittedCount}</strong> checked in
      </p>
      <h3 className="checkin-aside__title">Recent scans</h3>
      <ul className="checkin-history">
        {history.map((row) => (
          <li
            key={row.id}
            className={`checkin-history__row checkin-history__row--${row.status.toLowerCase()}`}
          >
            <div>
              <strong>{row.attendee.name}</strong>
              <span>{row.status}</span>
            </div>
            <time>{formatTime(row.checked_in_at)}</time>
          </li>
        ))}
      </ul>
    </>
  );
}
