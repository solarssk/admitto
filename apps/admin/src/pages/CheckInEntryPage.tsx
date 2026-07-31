import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Card, PageHeader } from "@admitto/ui";
import { ApiError, fetchCheckInEvents } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { EventCard, eventGridClassName } from "../components/EventCard.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";

export function CheckInEntryPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { reportApiError } = useConnectionState();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchCheckInEvents({ includeAttendeeCount: true });
        if (cancelled) return;
        if (list.length === 1) {
          navigate(`/operator/events/${list[0]!.id}/checkin`, { replace: true });
          return;
        }
        setEvents(list);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          reportApiError(err.status);
          setError("Failed to load check-in events.");
        } else {
          setError("Failed to load check-in events.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, reportApiError]);

  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // the "Loading…" text on and off faster than it can register as loading — show it only
  // once the fetch has genuinely taken a moment.
  const showLoading = useDelayedLoading(loading);

  if (loading) {
    return showLoading ? <p>Loading check-in events…</p> : null;
  }

  if (error) {
    return <p className="text-error">{error}</p>;
  }

  if (events.length === 0) {
    return (
      <Card>
        <PageHeader title="Check-in" subtitle="No events with check-in access were found for your account." />
      </Card>
    );
  }

  return (
    <>
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
    </>
  );
}
