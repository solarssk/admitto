import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Card, PageHeader, SectionLoader } from "@admitto/ui";
import { ApiError, fetchCheckInEvents } from "../api/client.js";
import type { CheckInEventDto } from "../api/types.js";
import { EventCard, eventGridClassName } from "../components/EventCard.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useDelayedLoading, useLoadingGate } from "../hooks/useDelayedLoading.js";
import { useRetryKeepingError } from "../hooks/useRetryKeepingError.js";
import {
  LOAD_TIMEOUT_MESSAGE,
  LOAD_TIMEOUT_MS,
  SLOW_NOTICE_MS,
  SLOW_NOTICE_TEXT,
} from "../utils/loading-timing.js";

const LOAD_ERROR = "Could not load check-in events.";

export function CheckInEntryPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<CheckInEventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { reportApiError } = useConnectionState();

  const cancelRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    // A newer load replaces the one in flight (a Retry while an earlier try is still running, or the first load's cleanup).
    cancelRef.current?.();
    let cancelled = false;
    // A door operator is waiting on this screen: give up after LOAD_TIMEOUT_MS instead of spinning for good.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    cancelRef.current = () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
    setLoading(true);
    let redirecting = false;
    try {
      const list = await fetchCheckInEvents({ includeAttendeeCount: true, signal: controller.signal });
      if (cancelled) return;
      if (list.length === 1) {
        // Stays on the loader until the route changes: with loading switched off and no events yet,
        // the "No events with check-in access" notice would show for a moment before the redirect.
        redirecting = true;
        void navigate(`/operator/events/${list[0]!.id}/checkin`, { replace: true });
        return;
      }
      setEvents(list);
      // The error of an earlier try stays on screen, with its busy Retry, until this answer is in.
      setError(null);
    } catch (err) {
      if (cancelled) return;
      if (controller.signal.aborted) {
        setError(LOAD_TIMEOUT_MESSAGE);
        return;
      }
      if (err instanceof ApiError) reportApiError(err.status);
      setError(LOAD_ERROR);
    } finally {
      clearTimeout(timeout);
      if (!cancelled && !redirecting) setLoading(false);
    }
  }, [navigate, reportApiError]);

  useEffect(() => {
    void load();
    return () => cancelRef.current?.();
  }, [load]);

  // The Retry of a failed load keeps the error and its busy button on screen until the answer is in (a Retry that disappears at
  // the click takes the keyboard focus with it), so a Retry is not a first load to cover with the loader.
  const failure = useRetryKeepingError(error, load);

  // The loader appears only if the wait passes 200ms and then stays for at least 400ms, and the
  // space it needs is held from the first frame (AGENTS.md "Admin SPA loading and busy states").
  const waiting = loading && !failure.running;
  const gate = useLoadingGate(waiting);
  const slow = useDelayedLoading(waiting, SLOW_NOTICE_MS);

  let body: ReactNode;
  if (!gate.showContent) {
    body = (
      <SectionLoader
        label="Loading check-in events"
        caption={slow ? SLOW_NOTICE_TEXT : undefined}
        minHeight="16rem"
        className={gate.showIndicator ? undefined : "at-loading-hold"}
      />
    );
  } else if (failure.error) {
    body = (
      <div className="at-fade-in">
        <RetryEmptyState
          title="Could not load check-in events"
          message={failure.error}
          retrying={failure.retrying}
          onRetry={failure.retry}
          landmark=".checkin-entry-body"
        />
      </div>
    );
  } else if (events.length === 0) {
    body = (
      <Card className="at-fade-in">
        <PageHeader title="Check-in" subtitle="No events with check-in access were found for your account." />
      </Card>
    );
  } else {
    body = (
      <div className="at-fade-in">
        <PageHeader title="Check-in" subtitle="Choose an event to open the check-in surface." />
        <div className={eventGridClassName(events.length)}>
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              href={`/operator/events/${event.id}/checkin`}
              touch
              showAttendeeCount
            />
          ))}
        </div>
      </div>
    );
  }

  // One element for the loader, the error and the list, so that it stays when a Retry works and can take the keyboard focus.
  return (
    <section className="checkin-entry-body" aria-label="Check-in events">
      {body}
    </section>
  );
}
