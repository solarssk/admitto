import { useState } from "react";
import { useOutletContext } from "react-router";
import { Button, Card, EmptyState, PageHeader } from "@admitto/ui";
import type { EventDto } from "../api/types.js";
import { useAuth } from "../auth/AuthProvider.js";
import {
  scanSoundMuteIconClass,
  scanSoundMuteLabel,
  scanSoundMuteTitle,
  useScanSoundMuted,
} from "../checkin/scanSoundFeedback.js";
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

  if (event.archived_at) {
    return (
      <>
        <PageHeader title="Check-in" subtitle="Scan QR codes and admit guests on event day" />
        <EmptyState
          icon={<i className="ti ti-archive" aria-hidden="true" />}
          title="Check-in is disabled"
          description="This event is archived, so check-in is turned off to protect its data."
        />
      </>
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
              aria-label={scanSoundMuteLabel(scanSoundMuted)}
              title={scanSoundMuteTitle(scanSoundMuted)}
              icon={<i className={scanSoundMuteIconClass(scanSoundMuted)} aria-hidden="true" />}
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
