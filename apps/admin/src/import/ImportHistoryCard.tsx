import type { ReactNode } from "react";
import { Card } from "@admitto/ui";
import type { ImportHistoryEntry } from "../api/client.js";
import { RefetchRegion } from "../components/RefetchRegion.js";
import { RefreshWarning } from "../components/RefreshWarning.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { useCardLoad } from "../hooks/useCardLoad.js";
import type { ListLoad } from "../hooks/useListLoad.js";
import { formatEventDateTime } from "../utils/event-dates.js";
import { ImportHistorySkeleton } from "./ImportHistorySkeleton.js";
import "../attendees/attendees.css";
import "../pages/import.css";

const NO_ENTRIES: ImportHistoryEntry[] = [];

function ImportHistoryTable({ entries, eventTimezone }: Readonly<{ entries: readonly ImportHistoryEntry[]; eventTimezone: string | undefined }>) {
  return (
    <div className="attendees-table-wrap">
      <table className="table import-history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>File</th>
            <th>Status</th>
            <th>Created</th>
            <th>Updated</th>
            <th>Skipped</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="import-history__date">{formatEventDateTime(entry.created_at, eventTimezone)}</td>
              <td className="import-history__file">{entry.filename ?? <span className="import-sample__empty">-</span>}</td>
              <td
                className={
                  entry.status === "failed" ? "import-history__num import-history__num--warn" : "import-history__num import-history__num--ok"
                }
              >
                {entry.status === "failed" ? (entry.error ?? "Failed") : "Succeeded"}
              </td>
              <td className="import-history__num import-history__num--ok">{entry.created}</td>
              <td className="import-history__num import-history__num--warn">{entry.updated}</td>
              <td className="import-history__num">{entry.skipped}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "Import history" card from the design mockup: recent commits with their outcome counts, read from the audit log (no
 * dedicated table). Timestamps render in the event's timezone via the central formatter, like other event-scoped tables.
 * It follows the loading standard of a list in a card (`useListLoad` and `useCardLoad`): a placeholder with the table's own
 * shape for the first read, an error with a busy Retry that stays on screen until the answer is in, and the rows kept,
 * blocked and dimmed, while the refresh that follows an import runs (a refresh that fails keeps them and says so).
 */
export function ImportHistoryCard({
  list,
  eventTimezone,
}: Readonly<{ list: ListLoad<ImportHistoryEntry[]>; eventTimezone: string | undefined }>) {
  const card = useCardLoad(list);
  const entries = list.data ?? NO_ENTRIES;
  let body: ReactNode;
  // Unpadded only when the table (or its placeholder) renders: it brings its own scroll wrapper, and every text state keeps
  // the normal card padding.
  let padded = true;
  if (!card.gate.showContent) {
    body = <ImportHistorySkeleton held={!card.gate.showIndicator} slow={card.slow} />;
    padded = false;
  } else if (card.failure.error) {
    body = (
      <RetryEmptyState
        title="Could not load import history"
        message={card.failure.error}
        retrying={card.failure.retrying}
        onRetry={card.failure.retry}
      />
    );
  } else {
    padded = entries.length === 0;
    body = (
      <RefetchRegion refreshing={list.refreshing} label="Refreshing import history">
        {entries.length === 0 ? (
          <p className="import-hint">No imports yet for this event.</p>
        ) : (
          <ImportHistoryTable entries={entries} eventTimezone={eventTimezone} />
        )}
      </RefetchRegion>
    );
  }
  return (
    <Card title="Import history" className="import-card" padded={padded}>
      {list.refreshError ? (
        <div className="import-history__warning">
          <RefreshWarning message={list.refreshError} onRetry={list.reload} />
        </div>
      ) : null}
      {body}
    </Card>
  );
}
