import { useState } from "react";
import { useOutletContext } from "react-router";
import { Button, EmptyState, PageHeader } from "@admitto/ui";
import type { EventDto } from "../api/types.js";
import {
  scanSoundMuteIconClass,
  scanSoundMuteLabel,
  scanSoundMuteTitle,
  useScanSoundMuted,
} from "../checkin/scanSoundFeedback.js";
import { CheckInPage } from "./CheckInPage.js";

export function AdminCheckInRoute() {
  const { event } = useOutletContext<{ event: EventDto }>();
  const [useCamera, setUseCamera] = useState(false);
  const [scanSoundMuted, toggleScanSoundMuted] = useScanSoundMuted();

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
        className="checkin-pageheader"
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
