import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, Tabs } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ApiError, fetchAdminEvents, unarchiveEvent } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { CreateEventModal } from "../events/CreateEventModal.js";
import { formatEventDate, formatEventDateTime } from "../utils/event-dates.js";
import { filterEventsBySearch } from "../utils/event-search.js";

type PickerTab = "active" | "archived";

type UnarchiveTarget = { event: EventDto };

const SEARCH_DEBOUNCE_MS = 300;

/** Event picker for org admins and superadmins at `/admin` (no event context). */
export function EventsPickerPage() {
  const navigate = useNavigate();
  const { assignments } = useAuth();
  const showInstanceSettings = isSuperadmin(assignments);
  const canUnarchive = showInstanceSettings;
  const [tab, setTab] = useState<PickerTab>("active");
  const [tabTouched, setTabTouched] = useState(false);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [unarchiveTarget, setUnarchiveTarget] = useState<UnarchiveTarget | null>(null);
  const [unarchiving, setUnarchiving] = useState(false);
  const [unarchiveError, setUnarchiveError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const { reportApiError } = useConnectionState();

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAdminEvents({ includeArchived: true, signal });
      if (signal?.aborted) return;
      setEvents(list);
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ApiError) {
        reportApiError(err.status);
        setError(err.status === 403 ? "You do not have access to the admin panel." : "Failed to load events.");
      } else {
        setError("Failed to load events.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [reportApiError]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const activeEvents = useMemo(
    () => events.filter((e) => e.archived_at == null),
    [events],
  );
  const archivedEvents = useMemo(
    () => events.filter((e) => e.archived_at != null),
    [events],
  );
  const displayedEvents = tab === "archived" ? archivedEvents : activeEvents;
  const filteredEvents = useMemo(
    () => filterEventsBySearch(displayedEvents, searchQuery),
    [displayedEvents, searchQuery],
  );
  const otherTabEvents = tab === "archived" ? activeEvents : archivedEvents;
  const otherTabMatchCount = useMemo(
    () => (searchQuery ? filterEventsBySearch(otherTabEvents, searchQuery).length : 0),
    [otherTabEvents, searchQuery],
  );
  const allEventsArchived = events.length > 0 && activeEvents.length === 0;

  const gridClass =
    displayedEvents.length >= 4
      ? "event-grid event-grid--cols-3"
      : displayedEvents.length > 0
        ? "event-grid event-grid--cols-2"
        : "event-grid";

  useEffect(() => {
    if (!loading && !tabTouched && events.length > 0 && activeEvents.length === 0) {
      setTab("archived");
    }
  }, [loading, tabTouched, events.length, activeEvents.length]);

  const handleCreated = (event: EventDto) => {
    navigate(`/admin/events/${event.id}/attendees`);
  };

  const handleUnarchive = async () => {
    if (!unarchiveTarget) return;
    setUnarchiving(true);
    setUnarchiveError(null);
    try {
      await unarchiveEvent(unarchiveTarget.event.id);
      setUnarchiveTarget(null);
      await load();
    } catch (err) {
      setUnarchiveError(err instanceof ApiError ? err.message : "Failed to unarchive event.");
    } finally {
      setUnarchiving(false);
    }
  };

  return (
    <div className="events-picker-screen">
      <PageHeader
        title="Events"
        subtitle="Select an event to manage its lifecycle."
        actions={
          <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
            New event
          </Button>
        }
      />

      <Tabs
        value={tab}
        onChange={(id) => {
          setTabTouched(true);
          setTab(id as PickerTab);
        }}
        tabs={[
          { id: "active", label: "Active events", count: activeEvents.length || undefined },
          { id: "archived", label: "Archived events", count: archivedEvents.length || undefined },
        ]}
      />

      {loading && (
        <div className="picker-loading" role="status">
          <Spinner label="Loading events" />
        </div>
      )}
      {error && <p className="text-error">{error}</p>}

      {!loading && !error && displayedEvents.length > 0 && (
        <div className="events-picker-toolbar">
          <label className="at-field events-picker-search">
            <span className="at-label">Search events</span>
            <input
              className="at-input"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Title or location"
              autoComplete="off"
            />
          </label>
        </div>
      )}

      {!loading && !error && displayedEvents.length > 0 && filteredEvents.length === 0 && (
        <Card>
          <p>No events match &quot;{searchQuery}&quot;.</p>
          {otherTabMatchCount > 0 && (
            <p className="at-hint">
              No results on this tab — try the{" "}
              <button
                type="button"
                className="picker-inline-link"
                onClick={() => {
                  setTabTouched(true);
                  setTab(tab === "archived" ? "active" : "archived");
                }}
              >
                {tab === "archived" ? "Active events" : "Archived events"}
              </button>{" "}
              tab ({otherTabMatchCount} {otherTabMatchCount === 1 ? "match" : "matches"}).
            </p>
          )}
        </Card>
      )}

      {!loading && !error && tab === "active" && events.length === 0 && (
        <EmptyState
          icon={<i className="ti ti-calendar-off" />}
          title="No events yet"
          description="Create your first event to start managing attendees and check-in."
          action={
            <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
              Create event
            </Button>
          }
        />
      )}

      {!loading && !error && displayedEvents.length === 0 && events.length > 0 && (
        <Card>
          <p>{tab === "archived" ? "No archived events." : "No active events in your scope."}</p>
          {tab === "active" && allEventsArchived && (
            <p className="at-hint">
              All events are archived. Open the{" "}
              <button type="button" className="picker-inline-link" onClick={() => setTab("archived")}>
                Archived events
              </button>{" "}
              tab to unarchive.
              {!showInstanceSettings && <> Contact your administrator if you need help.</>}
            </p>
          )}
        </Card>
      )}

      <div className={gridClass}>
        {filteredEvents.map((event) => {
          const showUnarchive = tab === "archived" && canUnarchive;
          const cardBody = (
            <>
              {!event.archived_at && (
                <Badge variant="ok" className="event-card__status">
                  Active
                </Badge>
              )}
              <h2 className="event-card__title">{event.title}</h2>
              <p className="event-card__meta">
                <i className="ti ti-calendar" aria-hidden="true" />
                <span>{formatEventDate(event.date)}</span>
                {event.location && (
                  <>
                    <span aria-hidden="true">·</span>
                    <i className="ti ti-map-pin" aria-hidden="true" />
                    <span>{event.location}</span>
                  </>
                )}
              </p>
              {event.attendee_count != null && (
                <div className="event-card__stats">
                  <div className="event-card__stat">
                    <i className="ti ti-users" aria-hidden="true" />
                    <strong>{event.attendee_count}</strong>
                    <span>attendees</span>
                  </div>
                </div>
              )}
              {event.archived_at && (
                <p className="event-card__archived">
                  <Badge variant="neutral">Archived · read-only</Badge>
                  <span>{formatEventDateTime(event.archived_at)}</span>
                </p>
              )}
            </>
          );

          if (showUnarchive) {
            return (
              <Card key={event.id} className="event-card event-card--static">
                {cardBody}
                <p className="event-card__actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setUnarchiveError(null);
                      setUnarchiveTarget({ event });
                    }}
                  >
                    Unarchive
                  </Button>
                </p>
              </Card>
            );
          }

          return (
            <Link key={event.id} to={`/admin/events/${event.id}/overview`} className="event-card-link">
              <Card className="event-card event-card--active">{cardBody}</Card>
            </Link>
          );
        })}
      </div>

      <CreateEventModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />

      <ConfirmDialog
        open={!!unarchiveTarget}
        title="Unarchive event"
        message={
          unarchiveTarget
            ? `Restore "${unarchiveTarget.event.title}" to active events? Edits will be allowed again.`
            : ""
        }
        errorMessage={unarchiveError}
        confirmLabel="Unarchive"
        confirmVariant="primary"
        loading={unarchiving}
        onConfirm={() => void handleUnarchive()}
        onCancel={() => {
          if (!unarchiving) {
            setUnarchiveTarget(null);
            setUnarchiveError(null);
          }
        }}
      />
    </div>
  );
}
