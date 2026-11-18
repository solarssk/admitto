import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router";
import { HintLabel } from "@admitto/ui";
import { ApiError, fetchRegistrationSettings } from "../api/client.js";
import type { EventDto, RegistrationSettingsDto } from "../api/types.js";
import { isEventArchived } from "../components/ArchivedGuard.js";
import { useOptionalAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { usePanelLoad } from "../hooks/usePanelLoad.js";
import { orLoginRedirect } from "../identity/loginRedirect.js";
import { PanelLoadError } from "../settings/PanelLoadError.js";
import { SettingsPanelSkeleton, type SettingsSkeletonCard } from "../settings/SettingsPanelSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";
import { checklistFromSettings, type ChecklistCheck } from "./accessReadiness.js";
import { chosenMethod } from "./accessSettings.js";
import { ReadinessChecklist } from "./ReadinessChecklist.js";

const CHECKLIST_HINT = "What registration still needs for this event, and who does each step.";

/** The cards of the tab as its placeholder draws them: the real titles over rows of the height of the real ones. */
const CHECKLIST_SKELETON_CARDS: ReadonlyArray<SettingsSkeletonCard> = [
  { id: "summary", title: "Registration checklist", rows: 1, rowHeight: 58 },
  { id: "for-you", title: "For you", rows: 3, rowHeight: 46 },
  { id: "done", title: "Done", rows: 1, rowHeight: 24 },
];

/** One event, one tab: a different `:eventId` is a fresh tab with its own read, never the previous one's. */
export function RegistrationChecklistTab({ onReadiness }: Readonly<{ onReadiness: (readiness: ChecklistCheck[]) => void }>) {
  const { eventId } = useParams();
  if (!eventId) return <p>Missing event.</p>;
  return <RegistrationChecklistBody key={eventId} eventId={eventId} onReadiness={onReadiness} />;
}

/**
 * The checklist of what registration needs, read each time the tab is opened (the tab panel is keyed by the tab), so it is the
 * truth of now: a key or an address can stop working while registration is on. It follows the settings-panel loading standard
 * (`usePanelLoad`): the cards grey with their real titles, an error with a Retry that stays until the answer is in. What it reads is
 * also told to the page, so that the number on the tab is the same as the list.
 */
function RegistrationChecklistBody({ eventId, onReadiness }: Readonly<{ eventId: string; onReadiness: (readiness: ChecklistCheck[]) => void }>) {
  const { reportApiError } = useConnectionState();
  const { event } = useOutletContext<{ event: EventDto }>();
  const superadmin = isSuperadmin(useOptionalAuth()?.assignments ?? []);
  const [settings, setSettings] = useState<RegistrationSettingsDto | null>(null);
  // A failure is told to the connection state when the answer is in; a 401 hands the browser to the login page, and no error flashes up first.
  const read = useMemo(
    () =>
      orLoginRedirect(async (signal: AbortSignal) => {
        try {
          return await fetchRegistrationSettings(eventId, signal);
        } catch (err) {
          if (err instanceof ApiError) reportApiError(err.status);
          throw err;
        }
      }),
    [eventId, reportApiError],
  );
  const panel = usePanelLoad({ fetch: read, apply: setSettings, fallback: "Could not load the checklist." });
  const checks = useMemo(() => (settings ? checklistFromSettings(settings) : null), [settings]);
  useEffect(() => {
    if (checks) onReadiness(checks);
  }, [checks, onReadiness]);

  if (!panel.gate.showContent) {
    return <SettingsPanelSkeleton label="Loading the checklist" held={!panel.gate.showIndicator} slow={panel.slow} cards={CHECKLIST_SKELETON_CARDS} footer={false} />;
  }
  if (panel.error !== null) {
    return (
      <PanelLoadError
        cardTitle={<HintLabel hint={CHECKLIST_HINT}>Checklist</HintLabel>}
        title="Could not load the checklist"
        message={panel.error}
        retrying={panel.retrying}
        onRetry={panel.retry}
      />
    );
  }
  // A load that worked has put its answer in `settings`; a failed one is `panel.error`, above.
  assertPresent(settings);
  assertPresent(checks);
  return (
    <div className="settings-sections at-fade-in">
      <ReadinessChecklist
        eventId={eventId}
        checks={checks}
        superadmin={superadmin}
        mode={settings.mode}
        archived={isEventArchived(event)}
        method={chosenMethod(settings.access_methods)}
        provider={settings.sso_provider}
        organisationBotProtection={settings.bot_protection}
        questionCount={settings.public_fields.length}
      />
    </div>
  );
}
