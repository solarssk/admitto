import { Skeleton } from "@admitto/ui";
import type { CheckInHistoryEntry, TicketTypeDto } from "../api/types.js";
import { resolveTicketTypeLabel } from "../attendees/ticketTypeBadge.js";
import { SlowNote } from "../components/SlowNote.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { formatRelativeAdmissionDisplay, getBrowserTimeZone } from "../utils/event-dates.js";
import { SLOW_NOTICE_MS } from "../utils/loading-timing.js";

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
  return status.replaceAll("_", " ");
}

function dotClass(status: string, source: string | null): string {
  const normalized = status.toLowerCase();
  if (normalized === "admitted" || normalized === "valid") return "rec-dot--admitted";
  if (normalized === "already_checked_in") return "rec-dot--already_checked_in";
  if (normalized === "undo") return source === "admin_revoke" ? "rec-dot--revoked" : "rec-dot--undo";
  if (normalized === "revoked") return "rec-dot--revoked";
  return "rec-dot--invalid";
}


type CkRecentScansProps = {
  history: CheckInHistoryEntry[];
  eventDate?: string | null;
  compact?: boolean;
  limit?: number;
  /** Event's ticket-type catalog, for resolving each row's raw ticket_type key to its current
   * label. Defaults to [] so an unresolved key still renders (fail-open) instead of disappearing. */
  ticketTypes?: TicketTypeDto[];
  /** When set, a row's name+ticket area becomes a button that reopens that
   * attendee's card — lets an operator revisit a recent scan (e.g. to hand
   * out a missed item) without re-scanning the QR (PO review). */
  onSelectAttendee?: (attendeeId: string) => void;
  /** The history has not arrived: rows of placeholder instead of a "No scans yet" that would be untrue. */
  loading?: boolean;
  /** The placeholder is in the page but not painted yet (the loading gate's 200ms), so its space is reserved. */
  held?: boolean;
  /** How many placeholder rows to draw (the number this list had last time); defaults to a few. */
  skeletonRows?: number;
};

/** How many placeholder rows stand in for a history that is on its way. */
const SKELETON_ROWS = 4;

function RecentScansSkeleton({ rows }: Readonly<{ rows: number }>) {
  return (
    <ul className="ck-recent__list" aria-hidden="true">
      {Array.from({ length: Math.max(rows, 1) }, (_, i) => (
        <li key={i} className="ck-recent__row ck-recent__row--skeleton">
          <Skeleton variant="circle" width={8} height={8} />
          <div className="ck-recent__info">
            <Skeleton variant="rect" width="55%" height={14} />
            <Skeleton variant="rect" width="35%" height={11} />
          </div>
          <div className="ck-recent__right">
            <Skeleton variant="rect" width={56} height={11} />
            <Skeleton variant="rect" width={40} height={11} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CkRecentScans({
  history,
  eventDate = null,
  compact = false,
  limit,
  ticketTypes = [],
  onSelectAttendee,
  loading = false,
  held = false,
  skeletonRows,
}: Readonly<CkRecentScansProps>) {
  const rows = limit != null ? history.slice(0, limit) : history;
  // "Taking longer than usual" once the first load has been on its way for 8 seconds, in the placeholder's status region below.
  const slow = useDelayedLoading(loading, SLOW_NOTICE_MS);
  // Matches what's actually rendered below (`rows`), not the raw fetched
  // total — with the overlay's limit=6 slicing an 8-entry fetch, the count
  // badge previously said "8" while only 6 rows were visible, which read as
  // a bug rather than the fetch cap it actually was (PO review).
  const count = rows.length;

  return (
    <div
      className={`ck-recent${compact ? " ck-recent--compact" : ""}${loading && held ? " at-loading-hold" : ""}`}
      aria-busy={loading || undefined}
    >
      <div className="ck-recent__header">
        <span className="ck-recent__title">Recent scans</span>
        {loading ? (
          <Skeleton variant="rect" width={28} height={23.5} />
        ) : (
          <span className="ck-recent__count">{count}</span>
        )}
      </div>
      {loading && (
        <RecentScansSkeleton rows={skeletonRows ?? (limit == null ? SKELETON_ROWS : Math.min(limit, SKELETON_ROWS))} />
      )}
      {loading && (
        <output className="ck-recent__loading-status">
          <span className="sr-only">Loading recent scans</span>
          {slow ? <SlowNote /> : null}
        </output>
      )}
      {!loading && rows.length === 0 && <p className="ck-recent__empty">No scans yet</p>}
      {!loading && rows.length > 0 && (
        <ul className="ck-recent__list at-scroll">
          {rows.map((row) => {
            const ticketTypeLabel = resolveTicketTypeLabel(row.attendee.ticket_type, ticketTypes);
            const info = (
              <>
                <strong className="ck-recent__name">{row.attendee.name}</strong>
                {/* device_id is actually the operator's session device_label
                    (e.g. "Entrance A", or a detected device name) — the only
                    "who/which station scanned this" signal recorded today,
                    useful once more than one operator is working the door at
                    once (PO review). Shares the ticket line instead of
                    adding a third row, since it's often absent (device
                    labeling is optional at login). */}
                {(ticketTypeLabel || row.device_id) && (
                  <span className="ck-recent__ticket">
                    {[ticketTypeLabel, row.device_id].filter(Boolean).join(" · ")}
                  </span>
                )}
              </>
            );
            return (
              // Mockup ci-row: dot | info (name + ticket, left) | right (status + time).
              <li key={row.id} className="ck-recent__row">
                <span className={`rec-dot ${dotClass(row.status, row.source)}`} aria-hidden="true" />
                {onSelectAttendee ? (
                  // A real <button>, not a <li onClick>/role+tabIndex workaround
                  // — same accessibility pattern as CameraOverlayManualSearch's
                  // .ms__row-btn (SonarCloud S6847/S1082).
                  <button
                    type="button"
                    className="ck-recent__info ck-recent__info-btn"
                    onClick={() => onSelectAttendee(row.attendee_id)}
                  >
                    {info}
                  </button>
                ) : (
                  <div className="ck-recent__info">{info}</div>
                )}
                <div className="ck-recent__right">
                  <span className="ck-recent__status">{statusLabel(row.status, row.source)}</span>
                  {/* Viewer's own browser timezone, not the event's — an operator watching this
                   * feed reads "Today HH:MM" against their own clock, not the event's (PO report:
                   * scanning from Europe/Warsaw still showed the event's +5:30). */}
                  <time>{formatRelativeAdmissionDisplay(row.checked_in_at, eventDate, getBrowserTimeZone())}</time>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
