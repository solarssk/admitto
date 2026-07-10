import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Button, Card, PageHeader } from "@admitto/ui";
import type { EventDto } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useScanSoundMuted } from "../checkin/scanSoundFeedback.js";
import { CheckInPage } from "./CheckInPage.js";

/** Admin check-in: live scanner only when an Admitto session exists (CF-only cannot call scan API). */
export function AdminCheckInRoute() {
  const { hasAdmittoSession } = useAuth();
  const { event } = useOutletContext<{ event: EventDto }>();
  const [useCamera, setUseCamera] = useState(false);
  const [scanSoundMuted, toggleScanSoundMuted] = useScanSoundMuted();

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
        subtitle="Scan QR codes and admit guests on event day"
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<i className={`ti ti-camera${useCamera ? "-off" : ""}`} />}
              onClick={() => setUseCamera((v) => !v)}
            >
              {useCamera ? "Disable camera" : "Use camera"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-pressed={scanSoundMuted}
              aria-label={scanSoundMuted ? "Unmute scan sound" : "Mute scan sound"}
              icon={<i className={`ti ti-volume-${scanSoundMuted ? "off" : "2"}`} aria-hidden="true" />}
              onClick={toggleScanSoundMuted}
            />
          </>
        }
      />
      <CheckInPage
        eventTitle={event.title}
        eventTimezone={event.timezone}
        eventDate={event.date}
        eventOrganizationId={event.organization_id}
        useCamera={useCamera}
        onUseCameraChange={setUseCamera}
      />
    </>
  );
}
