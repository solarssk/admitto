import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Button, Card, PageHeader } from "@admitto/ui";
import type { EventDto } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { formatEventDate } from "../utils/event-dates.js";
import { CheckInPage } from "./CheckInPage.js";

function formatEventSubtitle(event: EventDto): string {
  const date = formatEventDate(event.date, event.timezone);
  return event.location ? `${event.title} · ${date} · ${event.location}` : `${event.title} · ${date}`;
}

/** Admin check-in: live scanner only when an Admitto session exists (CF-only cannot call scan API). */
export function AdminCheckInRoute() {
  const { hasAdmittoSession } = useAuth();
  const { event } = useOutletContext<{ event: EventDto }>();
  const [useCamera, setUseCamera] = useState(false);

  if (!hasAdmittoSession) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    return (
      <Card>
        <PageHeader
          title="Check-in"
          subtitle="Live scanning requires an Admitto session in addition to Cloudflare Access."
        />
        <p>
          <a href={`/login?next=${next}`}>Sign in to Admitto</a> to scan guests from the admin panel,
          or use the <a href="/operator">operator check-in</a> surface on event day.
        </p>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Check-in"
        subtitle={formatEventSubtitle(event)}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<i className="ti ti-camera" />}
            onClick={() => setUseCamera(true)}
          >
            Use camera
          </Button>
        }
      />
      <CheckInPage
        eventTitle={event.title}
        useCamera={useCamera}
        onUseCameraChange={setUseCamera}
      />
    </>
  );
}
