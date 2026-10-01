import { useEffect, useState } from "react";
import { Button, Notice } from "@admitto/ui";
import type { CheckInHistoryEntry, TicketTypeDto } from "../api/types.js";
import { readRememberedRowCount, rememberRowCount } from "../attendees/rememberedRowCount.js";
import { useLoadingGate, useMinimumBusy } from "../hooks/useDelayedLoading.js";
import { CkRecentScans } from "./CkRecentScans.js";
import { CkStats } from "./CkStats.js";

/** Max rows in the main check-in sidebar (prompt 50). Overlay uses its own cap. */
export const CK_RECENT_SCANS_SIDEBAR_LIMIT = 8;

/** Where the first load of the counts and the history stands. Later refreshes never go back to "loading". */
export type ScanHistoryStatus = "loading" | "ready" | "error";

type ScanHistoryListProps = {
  /** Lets the placeholder draw as many rows as this event's list had last time. */
  eventId?: string;
  admittedCount: number;
  totalCount: number;
  history: CheckInHistoryEntry[];
  eventDate?: string | null;
  compact?: boolean;
  ticketTypes?: TicketTypeDto[];
  onSelectAttendee?: (attendeeId: string) => void;
  status?: ScanHistoryStatus;
  /** A Retry is running; the error stays on screen, its button busy, until the answer is in. */
  retrying?: boolean;
  onRetry?: () => void;
};

/** The first load of the counts and the history failed: says so, with a Retry that stays busy for at
 * least 400ms so a retry that fails again at once still shows it ran. Shared by the sidebar and the
 * phone camera view. */
export function ScanHistoryError({
  retrying = false,
  onRetry,
  className,
}: Readonly<{ retrying?: boolean; onRetry?: () => void; className?: string }>) {
  const retryBusy = useMinimumBusy(retrying);
  return (
    <Notice
      variant="error"
      role="alert"
      className={className}
      actionBusy={retryBusy}
      action={
        onRetry && (
          <Button type="button" variant="secondary" size="sm" loading={retryBusy} onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      Could not load the counts and recent scans.
    </Notice>
  );
}

export function ScanHistoryList({
  eventId,
  admittedCount,
  totalCount,
  history,
  eventDate = null,
  compact = false,
  ticketTypes = [],
  onSelectAttendee,
  status = "ready",
  retrying = false,
  onRetry,
}: Readonly<ScanHistoryListProps>) {
  // Placeholders appear after 200ms and stay at least 400ms; until then they are in the page but
  // invisible, so the card does not change size when the real numbers arrive.
  const gate = useLoadingGate(status === "loading");
  // Only a list that started out waiting has something to fade in.
  const [startedLoading] = useState(status === "loading");
  const [rememberedRows] = useState(() => (eventId ? readRememberedRowCount(eventId, "checkin_scans") : null));
  const limit = compact ? 3 : CK_RECENT_SCANS_SIDEBAR_LIMIT;
  const shownRows = Math.min(history.length, limit);
  useEffect(() => {
    if (eventId && status === "ready") rememberRowCount(eventId, shownRows, "checkin_scans");
  }, [eventId, status, shownRows]);
  const placeholder = !gate.showContent;

  if (!placeholder && status === "error") {
    return <ScanHistoryError className="at-fade-in" retrying={retrying} onRetry={onRetry} />;
  }

  return (
    <div className={!placeholder && startedLoading ? "at-fade-in" : undefined}>
      <CkStats admitted={admittedCount} total={totalCount} loading={placeholder} held={!gate.showIndicator} />
      <CkRecentScans
        history={history}
        eventDate={eventDate}
        compact={compact}
        limit={limit}
        ticketTypes={ticketTypes}
        onSelectAttendee={onSelectAttendee}
        loading={placeholder}
        held={!gate.showIndicator}
        skeletonRows={rememberedRows === null ? undefined : Math.min(rememberedRows, limit)}
      />
    </div>
  );
}
