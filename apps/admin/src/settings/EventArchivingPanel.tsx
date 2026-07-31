import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button, Card, EmptyState, Tooltip, useToast } from "@admitto/ui";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Segmented } from "../components/Segmented.js";
import { archiveEvent, fetchAdminEvents, unarchiveEvent } from "../api/client.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto } from "../api/types.js";
import { formatEventDateTime, formatUtcDateTime } from "../utils/event-dates.js";

type ConfirmAction = { type: "archive" | "unarchive"; event: EventDto };
type View = "active" | "archived";

const CARD_HINT = "Archive completed events to hide them from default lists and make them read-only. Data is preserved.";
const EVENT_HINT = "The line below the title is the event's URL slug, used in links — not an internal ID.";
const EVENT_DATE_HINT = "The event's own date and time, in its local timezone — not when it was created.";
const VIEW_OPTIONS = [
  { value: "active" as const, label: "Active" },
  { value: "archived" as const, label: "Archived" },
];
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

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

/** Date/time + "by <actor>" subline, shared by the desktop table cell and the mobile card row.
 * `showActor` hides the subline entirely rather than printing "by -" (e.g. an active event has
 * no archiver at all, which reads better as absent than as a dash). */
function actorCell(
  iso: string | null | undefined,
  timezone: string | null | undefined,
  displayName: string | null | undefined,
  email: string | null | undefined,
  showActor: boolean,
): ReactNode {
  return (
    <>
      {actorDateTime(iso, timezone)}
      {showActor && <div className="archiving-subdued">by {actorLabel(displayName, email)}</div>}
    </>
  );
}

/** Settings panel — archive/unarchive events (superadmin-only section). */
export function EventArchivingPanel() {
  const { addToast } = useToast();
  const isDesktop = useIsDesktop();
  const [events, setEvents] = useState<EventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [view, setView] = useState<View>("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAdminEvents({ includeArchived: true, signal });
      if (signal?.aborted) return;
      setEvents(list);
    } catch (err) {
      if (signal?.aborted) return;
      const message = operatorApiErrorMessage(err, "Failed to load events.");
      setError(message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

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
  const displayedRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  const handleConfirm = async () => {
    if (!confirmAction) return;
    setActing(true);
    setActionError(null);
    try {
      if (confirmAction.type === "archive") {
        await archiveEvent(confirmAction.event.id);
        addToast("Event archived.", "success");
      } else {
        await unarchiveEvent(confirmAction.event.id);
        addToast("Event unarchived.", "success");
      }
      setConfirmAction(null);
      await load();
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
        Unarchive
      </Button>
    );

  const emptyMessage = view === "active" ? "No active events" : "No archived events";
  const emptyDescription =
    view === "active" ? "Active events will appear here." : "Events you archive will appear here.";

  const restoreMessage = confirmAction
    ? `Restore "${confirmAction.event.title}" to active events? Edits will be allowed again.`
    : "";

  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // the "Loading…" text on and off faster than it can register as loading — show it only
  // once the fetch has genuinely taken a moment.
  const showLoading = useDelayedLoading(loading);

  return (
    <>
      <Card
        title={
          <Tooltip content={CARD_HINT} className="audit-log-scope-header">
            Event archiving <i className="ti ti-info-circle" aria-hidden="true" />
          </Tooltip>
        }
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
        {loading && showLoading && <p className="archiving-status">Loading…</p>}

        {!loading && error && (
          <div className="archiving-status">
            <p className="archiving-error">{error}</p>
            <Button type="button" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && (
          <>
            {displayedRows.length === 0 ? (
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
            ) : isDesktop ? (
              <div className="archiving-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">
                        <Tooltip content={EVENT_HINT} className="audit-log-scope-header">
                          Event <i className="ti ti-info-circle" aria-hidden="true" />
                        </Tooltip>
                      </th>
                      <th scope="col">
                        <Tooltip content={EVENT_DATE_HINT} className="audit-log-scope-header">
                          Event date <i className="ti ti-info-circle" aria-hidden="true" />
                        </Tooltip>
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
                            true,
                          )}
                        </td>
                        {view === "archived" && (
                          <td>
                            {actorCell(
                              event.archived_at,
                              event.archived_by_timezone,
                              event.archived_by_display_name,
                              event.archived_by_email,
                              !!event.archived_at,
                            )}
                          </td>
                        )}
                        <td>{renderAction(event)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
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
                          true,
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
                            !!event.archived_at,
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {rows.length > 0 && (
              <div className="audit-log-footer">
                <div className="audit-log-footer__summary">
                  <span className="audit-log-footer__info">
                    {`Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, rows.length)} of ${rows.length}`}
                  </span>
                  <div className="audit-log-pagesize">
                    <label htmlFor="archiving-pagesize-select">Rows per page</label>
                    <select
                      id="archiving-pagesize-select"
                      name="archiving-pagesize-select"
                      className="at-select audit-log-pagesize-select"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="audit-log-footer__pager">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.type === "archive" ? "Archive event" : "Unarchive event"}
        message={
          confirmAction?.type === "archive"
            ? "This event will be hidden and read-only. Data is preserved. A superadmin can unarchive later."
            : restoreMessage
        }
        confirmLabel={confirmAction?.type === "archive" ? "Archive" : "Unarchive"}
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
