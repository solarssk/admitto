import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button, EmptyState, PageHeader, SectionLoader, Tabs } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ApiError, fetchAdminEvents } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { EventCard, eventGridClassName } from "../components/EventCard.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { CreateEventModal } from "../events/CreateEventModal.js";
import { useDelayedLoading, useLoadingGate } from "../hooks/useDelayedLoading.js";
import { useRetryKeepingError } from "../hooks/useRetryKeepingError.js";
import { loadWithTimeout } from "../utils/load-timeout.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_MS, SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import "./events-picker-page.css";

type PickerTab = "active" | "archived";

/** What the list says when the events could not be read (and the API status goes to the connection banner). A request that the
 * 30 second limit gave up is a failure to retry, not a page that left. */
function eventsLoadError(err: unknown, timedOut: boolean, reportApiError: (status: number) => void): string {
  if (timedOut) return `Could not load events. ${LOAD_TIMEOUT_MESSAGE}`;
  if (!(err instanceof ApiError)) return "Could not load events.";
  reportApiError(err.status);
  return err.status === 403 ? "You do not have access to the admin panel." : "Could not load events.";
}

/** Event picker for org admins and superadmins at `/admin` (no event context). */
export function EventsPickerPage() {
  const navigate = useNavigate();
  const { assignments } = useAuth();
  const showInstanceSettings = isSuperadmin(assignments);
  const [tab, setTab] = useState<PickerTab>("active");
  const [tabTouched, setTabTouched] = useState(false);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const { reportApiError } = useConnectionState();

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    // The 30 second limit of AGENTS.md "Admin SPA loading and busy states": no answer ends in the error with its Retry, not in
    // a loader for ever. `ac` is the page's own signal (a newer request, or leaving the page, aborts it and stays silent).
    const limit = loadWithTimeout(ac.signal);
    setLoading(true);
    try {
      const list = await fetchAdminEvents({ includeArchived: true, signal: limit.signal });
      if (ac.signal.aborted) return;
      setEvents(list);
      // The error of an earlier try stays on screen, with its busy Retry, until this answer is in.
      setError(null);
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(eventsLoadError(err, limit.timedOut(), reportApiError));
    } finally {
      limit.done();
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [reportApiError]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  // The Retry of a failed list keeps the error and its busy button on screen until the answer is in (a Retry that disappears at
  // the click takes the keyboard focus with it), so a Retry is not a first load to cover with the loader.
  const failure = useRetryKeepingError(error, load);

  const activeEvents = useMemo(
    () => events.filter((e) => e.archived_at == null),
    [events],
  );
  const archivedEvents = useMemo(
    () => events.filter((e) => e.archived_at != null),
    [events],
  );
  const displayedEvents = tab === "archived" ? archivedEvents : activeEvents;
  const allEventsArchived = events.length > 0 && activeEvents.length === 0;

  const gridClass = eventGridClassName(displayedEvents.length);

  // The loader appears only if the wait passes 200ms and then stays for at least 400ms, and the space it needs is held from the
  // first frame; after 8 seconds it says it is taking longer than usual (AGENTS.md "Admin SPA loading and busy states").
  const waiting = loading && !failure.running;
  const gate = useLoadingGate(waiting);
  const slow = useDelayedLoading(waiting, SLOW_NOTICE_MS);

  useEffect(() => {
    if (!loading && !tabTouched && events.length > 0 && activeEvents.length === 0) {
      setTab("archived");
    }
  }, [loading, tabTouched, events.length, activeEvents.length]);

  let body: ReactNode;
  if (!gate.showContent) {
    body = (
      <SectionLoader
        label="Loading events"
        caption={slow ? SLOW_NOTICE_TEXT : undefined}
        minHeight="16rem"
        className={gate.showIndicator ? undefined : "at-loading-hold"}
      />
    );
  } else if (failure.error) {
    body = (
      <RetryEmptyState
        title="Could not load events"
        message={failure.error}
        retrying={failure.retrying}
        onRetry={failure.retry}
        landmark=".events-picker-body"
      />
    );
  } else {
    body = (
      // What replaces the loader fades in.
      <div className="at-fade-in">
        {tab === "active" && events.length === 0 && (
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
        {tab === "archived" && displayedEvents.length === 0 && events.length > 0 && (
          <EmptyState
            icon={<i className="ti ti-archive-off" aria-hidden="true" />}
            title="No archived events"
            description="Events you archive will appear here."
          />
        )}
        {tab === "active" && displayedEvents.length === 0 && allEventsArchived && (
          <EmptyState
            icon={<i className="ti ti-archive" aria-hidden="true" />}
            title="No active events"
            description={
              showInstanceSettings
                ? "All events are archived. Open the Archived events tab, then restore an event from Organisation settings → Event archiving (or Event settings)."
                : "All events are archived. Contact your administrator if you need help."
            }
            action={
              <Button type="button" variant="secondary" onClick={() => setTab("archived")}>
                View archived events
              </Button>
            }
          />
        )}

        <div className={gridClass}>
          {displayedEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              href={`/admin/events/${event.id}/overview`}
              showStatusBadge
              showAttendeeCount
            />
          ))}
        </div>
      </div>
    );
  }

  const handleCreated = (event: EventDto) => {
    // Pass the event we already hold so EventLayout can render the shell
    // immediately instead of re-fetching the events list (#274).
    void navigate(`/admin/events/${event.id}/overview`, { state: { event } });
  };

  return (
    <div className="events-picker-screen">
      <PageHeader
        className="events-picker-pageheader"
        title="Events"
        subtitle="Select an event to manage its lifecycle."
        actions={
          <Button
            type="button"
            variant="primary"
            icon={<i className="ti ti-calendar-plus" aria-hidden="true" />}
            onClick={() => setCreateOpen(true)}
          >
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

      <section className="events-picker-body" aria-label="Event list">
        {body}
      </section>

      <CreateEventModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
