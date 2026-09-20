import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAttendeeDetail } from "../api/client.js";
import type { AttendeeDetailDto } from "../api/types.js";

export const ACTIVITY_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_ACTIVITY_PAGE_SIZE = 25;

export type ActivityLog = Pick<
  AttendeeDetailDto,
  "action_log" | "action_log_total" | "action_log_page" | "action_log_page_size" | "action_log_snapshot"
>;

function pickLog(dto: AttendeeDetailDto): ActivityLog {
  return {
    action_log: dto.action_log,
    action_log_total: dto.action_log_total,
    action_log_page: dto.action_log_page,
    action_log_page_size: dto.action_log_page_size,
    action_log_snapshot: dto.action_log_snapshot,
  };
}

/**
 * One attendee's paged Activity log, and the single place that decides which response may apply.
 *
 * - The log is seeded by every whole-detail response through `reset` (edit, note, wallet action,
 *   reload, another attendee). A reset counts as newer than any page request still in flight, so it
 *   invalidates those right away - success and failure alike.
 * - `goToPage` and `setPageSize` fetch only the log, so paging never reloads (and never discards
 *   unsaved edits in) the rest of the attendee page. Only the newest request may apply.
 * - The rows-per-page choice is kept here, not in the loaded log: whole-detail responses come back at
 *   the server's default size, and the choice is re-applied after each one.
 * - Page 1 is always the live log. Later pages are counted against the snapshot page 1 returned, so an
 *   entry added by a colleague meanwhile can't shift the boundaries.
 *
 * Call it before any early return; `eventId` and `attendeeId` are only used once a log exists, which
 * happens only after a detail has loaded for them.
 */
export function useActivityLog({
  eventId,
  attendeeId,
  onError,
}: Readonly<{
  eventId: string | undefined;
  attendeeId: string | undefined;
  onError: (err: unknown) => void;
}>) {
  const [log, setLog] = useState<ActivityLog | null>(null);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_ACTIVITY_PAGE_SIZE);
  const generation = useRef(0);
  const logRef = useRef(log);
  logRef.current = log;
  const selectionRef = useRef({ eventId, attendeeId });
  selectionRef.current = { eventId, attendeeId };
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const reset = useCallback((dto: AttendeeDetailDto) => {
    generation.current += 1;
    setLog(pickLog(dto));
  }, []);

  const load = useCallback(async (page: number, size: number) => {
    const target = selectionRef.current;
    // Later pages are counted against the snapshot the first page returned; page 1 is the live log.
    const snapshot = page > 1 ? logRef.current!.action_log_snapshot : undefined;
    const request = ++generation.current;
    const isCurrent = () =>
      selectionRef.current.eventId === target.eventId &&
      selectionRef.current.attendeeId === target.attendeeId &&
      request === generation.current;
    try {
      const fetched = await fetchAttendeeDetail(target.eventId!, target.attendeeId!, undefined, 1, page, size, snapshot);
      if (!isCurrent()) return;
      setLog(pickLog(fetched));
      // A server that answers with another size than asked (e.g. one that predates the parameter)
      // would otherwise be corrected again on every response; follow what it actually shows.
      if (fetched.action_log_page_size !== size) setPageSize(fetched.action_log_page_size);
    } catch (err) {
      if (!isCurrent()) return;
      // Fall back to the size the log is actually showing, so choosing the same size again retries.
      setPageSize(logRef.current!.action_log_page_size);
      onErrorRef.current(err);
    }
  }, []);

  // Re-apply the selected rows-per-page whenever the loaded log came back at a different size (the
  // server default after any reset, or right after the operator picks a new size). Keyed on the log's
  // identity as well as the size, so it re-runs after every reset even when consecutive logs carry
  // the same size and an earlier correction was dropped as stale.
  useEffect(() => {
    const loadedSize = log?.action_log_page_size;
    if (loadedSize === undefined || loadedSize === pageSize) return;
    void load(1, pageSize);
  }, [log, pageSize, load]);

  const goToPage = useCallback((page: number) => void load(page, pageSize), [load, pageSize]);

  return { log, pageSize, reset, goToPage, setPageSize };
}
