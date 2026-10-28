import { useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router";
import { HintLabel } from "@admitto/ui";
import { ApiError, fetchLegalDocuments, fetchRegistrationSettings } from "../api/client.js";
import type { EventDto, LegalDocumentDto, RegistrationSettingsDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { usePanelLoad } from "../hooks/usePanelLoad.js";
import { orLoginRedirect } from "../identity/loginRedirect.js";
import { PanelLoadError } from "../settings/PanelLoadError.js";
import { SettingsPanelSkeleton, type SettingsSkeletonCard } from "../settings/SettingsPanelSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";
import { RegistrationAccessForm } from "./RegistrationAccessForm.js";

const ACCESS_HINT = "Whether guests can register for this event, how they get in, and what the form asks them.";

/** The cards of the tab as its placeholder draws them: the real titles, over rows of about the height of the real ones. */
const ACCESS_SKELETON_CARDS: ReadonlyArray<SettingsSkeletonCard> = [
  { id: "mode", title: "Guest registration", intro: 2, rows: 2, rowHeight: 40 },
  { id: "checklist", title: "Setup checklist", rows: 4, rowHeight: 52 },
  { id: "way-in", title: "Way in", intro: 1, rows: 1, rowHeight: 40 },
  { id: "form", title: "Form", rows: 5, rowHeight: 64 },
];

/** One event, one tab: a different `:eventId` is a fresh tab (its own read and its own draft), never the previous one's. */
export function RegistrationAccessTab() {
  const { eventId } = useParams();
  if (!eventId) return <p>Missing event.</p>;
  return <RegistrationAccessBody key={eventId} eventId={eventId} />;
}

/**
 * The first read of the tab: the settings of the event with what registration needs, and the event's legal texts, which the list of
 * consents is made from. It follows the loading standard of a settings panel (`usePanelLoad`): nothing for 200 ms, then the cards
 * grey with their real titles, an error with a busy Retry that stays on screen until the answer is in, and the form only when both
 * answers are. A loaded form is never read again under the person's hands.
 */
function RegistrationAccessBody({ eventId }: Readonly<{ eventId: string }>) {
  const { event, refreshEvent } = useOutletContext<{ event: EventDto; refreshEvent?: () => Promise<unknown> }>();
  const { reportApiError } = useConnectionState();
  const [loaded, setLoaded] = useState<{ settings: RegistrationSettingsDto; legalItems: LegalDocumentDto[] } | null>(null);
  // A failure is told to the connection state when the answer is in; a 401 hands the browser to the login page, and no error flashes up first.
  const fetchBoth = useMemo(
    () =>
      orLoginRedirect(async (signal: AbortSignal) => {
        try {
          return await Promise.all([fetchRegistrationSettings(eventId, signal), fetchLegalDocuments(eventId, signal)]);
        } catch (err) {
          if (err instanceof ApiError) reportApiError(err.status);
          throw err;
        }
      }),
    [eventId, reportApiError],
  );
  const panel = usePanelLoad({
    fetch: fetchBoth,
    apply: ([settings, legal]) => setLoaded({ settings, legalItems: legal.items }),
    fallback: "Could not load the registration settings.",
  });

  if (!panel.gate.showContent) {
    return <SettingsPanelSkeleton label="Loading registration settings" held={!panel.gate.showIndicator} slow={panel.slow} cards={ACCESS_SKELETON_CARDS} />;
  }
  if (panel.error !== null) {
    return (
      <PanelLoadError
        cardTitle={<HintLabel hint={ACCESS_HINT}>Guest registration</HintLabel>}
        title="Could not load the registration settings"
        message={panel.error}
        retrying={panel.retrying}
        onRetry={panel.retry}
      />
    );
  }
  // A load that worked has put its answer in `loaded`; a failed one is `panel.error`, above.
  assertPresent(loaded);
  return <RegistrationAccessForm eventId={eventId} event={event} settings={loaded.settings} legalItems={loaded.legalItems} refreshEvent={refreshEvent} />;
}
