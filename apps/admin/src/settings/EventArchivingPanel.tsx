import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button, Card, EmptyState, HintLabel, useToast } from "@admitto/ui";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { PaginationFooter } from "../components/PaginationFooter.js";
import { RefetchRegion } from "../components/RefetchRegion.js";
import { RefreshWarning } from "../components/RefreshWarning.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { Segmented } from "../components/Segmented.js";
import { ApiError, archiveEvent, fetchAdminEvents, unarchiveEvent } from "../api/client.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useCardLoad } from "../hooks/useCardLoad.js";
import { useListLoad } from "../hooks/useListLoad.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto } from "../api/types.js";
import { formatEventDateTime, formatUtcDateTime } from "../utils/event-dates.js";
import { UsersListSkeleton, type SkeletonColumn } from "../pages/users/UsersListSkeleton.js";

type ConfirmAction = { type: "archive" | "unarchive"; event: EventDto };
type View = "active" | "archived";

const CARD_HINT =
  "Archiving does not delete attendees, tickets, or delivery history.";
const CARD_INTRO =
  "Archive completed events to hide them from default lists and make them read-only.";
const EVENT_HINT = "The line below the title is the event's URL slug, used in links — not an internal ID.";
const EVENT_DATE_HINT = "The event's own date and time, in its local timezone — not when it was created.";
const VIEW_OPTIONS = [
  { value: "active" as const, label: "Active" },
  { value: "archived" as const, label: "Archived" },
];
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
/** The columns of the table, for its placeholder (the Archived column only exists in the Archived view). */
const ARCHIVING_COLUMNS: ReadonlyArray<SkeletonColumn> = [
  { id: "event", label: "Event" },
  { id: "date", label: "Event date" },
  { id: "attendees", label: "Attendees" },
  { id: "created", label: "Created" },
  { id: "action", label: <span className="sr-only">Action</span> },
];
const NO_EVENTS: EventDto[] = [];

/** Best-effort "who" label for created_by/archived_by — display name, falling back to email,
 * falling back to "-" for events predating this attribution (or a deleted user). */
function actorLabel(displayName: string | null | undefined, email: string | null | undefined): string {
  return displayName || email || "-";
}

/** Created/archived date+time in the acting admin's own timezone when known — a regular admin
 * cares when they themselves did it, not the UTC instant. Falls back to UTC only when the
 * actor's timezone wasn't captured (events predating this attribution, or a non-browser actor). */
function actorDateTime(iso: string | null | undefined, timezone: string | null | undefined): string {
  if (!iso) return "-";
  return timezone ? formatEventDateTime(iso, timezone) : formatUtcDateTime(iso);
}

/** Date/time + "by <actor>" subline, shared by the desktop table cell and the mobile card row. */
function actorCell(
  iso: string | null | undefined,
  timezone: string | null | undefined,
  displayName: string | null | undefined,
  email: string | null | undefined,
): ReactNode {
  return (
    <>
      {actorDateTime(iso, timezone)}
      <span className="archiving-subdued archiving-subdued--block">by {actorLabel(displayName, email)}</span>
    </>
  );
}

/** Settings panel — archive/unarchive events (superadmin-only section). */
export function EventArchivingPanel() {
  const { addToast } = useToast();
  const { reportApiError } = useConnectionState();
  const isDesktop = useIsDesktop();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [view, setView] = useState<View>("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);

  const fetchEvents = useCallback(
    async (signal: AbortSignal) => {
      try {
        return await fetchAdminEvents({ includeArchived: true, signal });
      } catch (err) {
        if (err instanceof ApiError) reportApiError(err.status);
        throw err;
      }
    },
    [reportApiError],
  );
  const list = useListLoad({ fetcher: fetchEvents, fallback: "Could not load events." });
  const events = list.data ?? NO_EVENTS;
  // The placeholder: after 200ms, "Taking longer than usual" after 8 seconds. A refresh after an action keeps the rows,
  // and a Retry keeps the error on screen, busy, until the answer is in (`failure`).
  const { gate, slow, failure } = useCardLoad(list);

  const activeEvents = useMemo(
    () => events.filter((e) => !e.archived_at),
    [events],
  );
  const archivedEvents = useMemo(
    () => events.filter((e) => e.archived_at),
    [events],
  );
  const rows = view === "active" ? activeEvents : archivedEvents;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  // A row can disappear from the current view under the current page (e.g. archiving the only
  // event on the last page) without page itself changing - clamp instead of rendering an empty
  // slice as "no events at all".
  const currentPage = Math.min(page, totalPages);
  const displayedRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize],
  );

  const handleConfirm = async () => {
    if (!confirmAction) return;
    setActing(true);
    setActionError(null);
    try {
      const { id } = confirmAction.event;
      if (confirmAction.type === "archive") {
        await archiveEvent(id);
        addToast("Event archived.", "success");
        // It moves to the other view at once, whatever the refresh that follows says (who archived it comes with it).
        list.update((current) => current.map((e) => (e.id === id ? { ...e, archived_at: new Date().toISOString() } : e)));
      } else {
        await unarchiveEvent(id);
        addToast("Event restored.", "success");
        list.update((current) =>
          current.map((e) =>
            e.id === id ? { ...e, archived_at: null, archived_by_display_name: null, archived_by_email: null, archived_by_timezone: null } : e,
          ),
        );
      }
      setConfirmAction(null);
      void list.reload();
    } catch (err) {
      setActionError(operatorApiErrorMessage(err, "Action failed."));
    } finally {
      setActing(false);
    }
  };

  const renderAction = (event: EventDto) =>
    view === "active" ? (
      <Button type="button" variant="danger" size="sm" onClick={() => setConfirmAction({ type: "archive", event })}>
        Archive
      </Button>
    ) : (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setConfirmAction({ type: "unarchive", event })}
      >
        Restore
      </Button>
    );

  const emptyMessage = view === "active" ? "No active events" : "No archived events";
  const emptyDescription =
    view === "active" ? "Active events will appear here." : "Events you archive will appear here.";

  const restoreMessage = confirmAction
    ? `"${confirmAction.event.title}" will become active again. Editing and check-in will be allowed, and it will show up in default event lists.`
    : "";

  let content: ReactNode;
  if (displayedRows.length === 0) {
    content = (
      <EmptyState
        icon={
          <i
            className={`ti ${view === "active" ? "ti-archive" : "ti-archive-off"}`}
            aria-hidden="true"
          />
        }
        title={emptyMessage}
        description={emptyDescription}
      />
    );
  } else if (isDesktop) {
    content = (
      <div className="archiving-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">
                <HintLabel hint={EVENT_HINT}>Event</HintLabel>
              </th>
              <th scope="col">
                <HintLabel hint={EVENT_DATE_HINT}>Event date</HintLabel>
              </th>
              <th scope="col">Attendees</th>
              <th scope="col">Created</th>
              {view === "archived" && <th scope="col">Archived</th>}
              <th scope="col">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((event) => (
              <tr key={event.id}>
                <td>
                  <Link to={`/admin/events/${event.id}/overview`}>{event.title}</Link>
                  <div className="archiving-subdued">{event.slug}</div>
                </td>
                <td>{formatEventDateTime(event.date, event.timezone)}</td>
                <td>{event.attendee_count ?? "-"}</td>
                <td>
                  {actorCell(
                    event.created_at,
                    event.created_by_timezone,
                    event.created_by_display_name,
                    event.created_by_email,
                  )}
                </td>
                {view === "archived" && (
                  <td>
                    {actorCell(
                      event.archived_at,
                      event.archived_by_timezone,
                      event.archived_by_display_name,
                      event.archived_by_email,
                    )}
                  </td>
                )}
                <td>{renderAction(event)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else {
    content = (
      <div className="archiving-cards">
        {displayedRows.map((event) => (
          <div className="archiving-card" key={event.id}>
            <div className="archiving-card__head">
              <div>
                <Link to={`/admin/events/${event.id}/overview`}>{event.title}</Link>
                <div className="archiving-subdued">{event.slug}</div>
              </div>
              {renderAction(event)}
            </div>
            <div className="archiving-card__row">
              <span className="archiving-card__label">Event date</span>
              <span>{formatEventDateTime(event.date, event.timezone)}</span>
            </div>
            <div className="archiving-card__row">
              <span className="archiving-card__label">Attendees</span>
              <span>{event.attendee_count ?? "-"}</span>
            </div>
            <div className="archiving-card__row">
              <span className="archiving-card__label">Created</span>
              <span>
                {actorCell(
                  event.created_at,
                  event.created_by_timezone,
                  event.created_by_display_name,
                  event.created_by_email,
                )}
              </span>
            </div>
            {view === "archived" && (
              <div className="archiving-card__row">
                <span className="archiving-card__label">Archived</span>
                <span>
                  {actorCell(
                    event.archived_at,
                    event.archived_by_timezone,
                    event.archived_by_display_name,
                    event.archived_by_email,
                  )}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <Card
        title={<HintLabel hint={CARD_HINT}>Event archiving</HintLabel>}
        actions={
          <Segmented
            ariaLabel="Event view"
            value={view}
            onChange={(next) => {
              setView(next);
              setPage(1);
            }}
            options={VIEW_OPTIONS}
            className="archiving-view-toggle"
          />
        }
      >
        <div className="settings-card-stack">
          <p className="settings-card-intro">{CARD_INTRO}</p>
        {!gate.showContent && (
          <UsersListSkeleton
            label="Loading events"
            held={!gate.showIndicator}
            slow={slow}
            columns={ARCHIVING_COLUMNS}
            rows={5}
            rowHeight={62}
            cards={3}
            cardHeight={170}
          />
        )}

        {gate.showContent && failure.error && (
          // Fades in with what it replaces, once: the wrapper stays through a Retry.
          <div className="at-fade-in">
            <RetryEmptyState title="Could not load events" message={failure.error} retrying={failure.retrying} onRetry={failure.retry} />
          </div>
        )}

        {gate.showContent && !failure.error && list.refreshError && (
          <RefreshWarning message={list.refreshError} onRetry={list.reload} />
        )}

        {gate.showContent && !failure.error && list.data !== null && (
          <RefetchRegion refreshing={list.refreshing} label="Refreshing events">
            {content}

            {rows.length > 0 && (
              <PaginationFooter
                idPrefix="archiving"
                page={currentPage}
                pageSize={pageSize}
                totalPages={totalPages}
                totalRows={rows.length}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                onPrevious={() => setPage(Math.max(1, currentPage - 1))}
                onNext={() => setPage(Math.min(totalPages, currentPage + 1))}
              />
            )}
          </RefetchRegion>
        )}
        </div>
      </Card>

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.type === "archive" ? "Archive event" : "Restore event"}
        message={
          confirmAction?.type === "archive"
            ? "This event will become fully read-only, including check-in, and hidden from default event lists. Attendee data is kept. Only a superadmin can undo this."
            : restoreMessage
        }
        confirmLabel={confirmAction?.type === "archive" ? "Archive" : "Restore"}
        confirmVariant={confirmAction?.type === "archive" ? "danger" : "primary"}
        loading={acting}
        errorMessage={actionError}
        onConfirm={() => void handleConfirm()}
        onCancel={() => {
          if (!acting) {
            setConfirmAction(null);
            setActionError(null);
          }
        }}
      />
    </>
  );
}
