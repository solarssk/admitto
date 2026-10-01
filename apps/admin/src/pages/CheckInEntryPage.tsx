import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Card, EmptyState, PageHeader, SectionLoader } from "@admitto/ui";
import { ApiError, fetchCheckInEvents } from "../api/client.js";
import type { CheckInEventDto } from "../api/types.js";
import { EventCard, eventGridClassName } from "../components/EventCard.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useDelayedLoading, useLoadingGate } from "../hooks/useDelayedLoading.js";
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
  const [reloadToken, setReloadToken] = useState(0);
  const { reportApiError } = useConnectionState();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // A door operator is waiting on this screen: give up after LOAD_TIMEOUT_MS instead of spinning for good.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    void (async () => {
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
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [navigate, reportApiError, reloadToken]);

  // The loader appears only if the wait passes 200ms and then stays for at least 400ms, and the
  // space it needs is held from the first frame (AGENTS.md "Admin SPA loading and busy states").
  const gate = useLoadingGate(loading);
  const slow = useDelayedLoading(loading, SLOW_NOTICE_MS);

  if (!gate.showContent) {
    return (
      <SectionLoader
        label="Loading check-in events"
        caption={slow ? SLOW_NOTICE_TEXT : undefined}
        minHeight="16rem"
        className={gate.showIndicator ? undefined : "at-loading-hold"}
      />
    );
  }

  if (error) {
    return (
      <div className="at-fade-in">
        <EmptyState
          variant="error"
          title="Could not load check-in events"
          description={error}
          action={
            <Button type="button" variant="secondary" onClick={() => setReloadToken((t) => t + 1)}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <Card className="at-fade-in">
        <PageHeader title="Check-in" subtitle="No events with check-in access were found for your account." />
      </Card>
    );
  }

  return (
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
