import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useParams, useSearchParams } from "react-router";
import { PageHeader, Tabs } from "@admitto/ui";
import type { RegistrationCountsDto, RegistrationSettingsDto } from "../api/types.js";
import { useOptionalAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { isEventArchived } from "../components/ArchivedGuard.js";
import type { ListLoad } from "../hooks/useListLoad.js";
import { checklistFromSettings, openStepCount } from "../registration/accessReadiness.js";
import { RegistrationChecklistTab } from "../registration/RegistrationChecklistTab.js";
import { RegistrationFieldsTab } from "../registration/RegistrationFieldsTab.js";
import { RegistrationLegalTab } from "../registration/RegistrationLegalTab.js";
import { RegistrationRequestsTab } from "../registration/RegistrationRequestsTab.js";
import {
  registrationHeaderStatus,
  RegistrationHeaderActions,
  RegistrationStatusBadge,
  RegistrationSwitchOverlays,
  useRegistrationSwitch,
  type RegistrationSwitchState,
} from "../registration/RegistrationSwitch.js";
import { registrationTabFromSearch, registrationTabItems, type RegistrationTab } from "../registration/registrationTabs.js";
import { useRegistrationCounts, useRegistrationSettings } from "../registration/useRegistrationCounts.js";

/** How long a burst of changes waits before the number on the Checklist tab is read again. */
const CHECKS_DEBOUNCE_MS = 400;

/** The content of a tab. */
function TabPanel({
  id,
  counts,
  settings,
  reg,
  onSettings,
  onChecksStale,
}: Readonly<{
  id: RegistrationTab["id"];
  counts: ListLoad<RegistrationCountsDto>;
  settings: RegistrationSettingsDto | null;
  reg: RegistrationSwitchState;
  onSettings: (settings: RegistrationSettingsDto) => void;
  onChecksStale: () => void;
}>) {
  if (id === "requests") return <RegistrationRequestsTab counts={counts} />;
  if (id === "fields") return <RegistrationFieldsTab onChecksStale={onChecksStale} />;
  if (id === "checklist") return <RegistrationChecklistTab settings={settings} reg={reg} onSettings={onSettings} />;
  return <RegistrationLegalTab onChecksStale={onChecksStale} />;
}

/** How people get into the event: their requests, the questions they answer, the legal texts they read, and what is still missing. Registration is switched on and off in its header. */
export function RegistrationPage() {
  const { eventId } = useParams();
  // One event, one page: another `:eventId` is a fresh page with its own numbers, never the previous event's.
  return <RegistrationPageBody key={eventId ?? ""} eventId={eventId} />;
}

function RegistrationPageBody({ eventId }: Readonly<{ eventId: string | undefined }>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const outlet = useOutletContext<{ event?: { archived_at?: string | null }; refreshEvent?: () => Promise<unknown> } | undefined>();
  const superadmin = isSuperadmin(useOptionalAuth()?.assignments ?? []);
  const tab = registrationTabFromSearch(searchParams);
  // The number on the Requests tab (D-B11) is the requests that wait for a decision, whichever tab is open. It is an extra:
  // while it is unknown, or zero, the tab has no number.
  const counts = useRegistrationCounts(eventId);
  const waiting = counts.data?.needs_decision;
  // The settings of the registration are one state for the page: the switch in the header, the number on the Checklist tab and the
  // banner of the Checklist all follow it. The Checklist tab reads the settings itself and tells the page what it found; on the other
  // tabs the page reads them (once for each visit to such a tab), and a save of the switch brings the answer.
  const [settings, setSettings] = useState<RegistrationSettingsDto | null>(null);
  const reportsItself = tab.id === "checklist";
  const reg = useRegistrationSwitch({ eventId, settings, onSettings: setSettings, refreshEvent: outlet?.refreshEvent });
  // An answer of a read that began before a save of the switch is not shown: it would put the old mode back.
  const { accept } = reg;
  const onRead = useCallback(
    (read: RegistrationSettingsDto) => {
      if (accept(read)) setSettings(read);
    },
    [accept],
  );
  const settingsLoad = useRegistrationSettings(reportsItself ? undefined : eventId, reg.readSettings, onRead);
  // The Fields and Legal tabs change what the checklist needs, and tell the page when their list changes: a burst of edits is one read.
  const stale = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadSettings = settingsLoad.reload;
  const onChecksStale = useCallback(() => {
    if (stale.current !== null) clearTimeout(stale.current);
    stale.current = setTimeout(() => void reloadSettings(), CHECKS_DEBOUNCE_MS);
  }, [reloadSettings]);
  useEffect(() => () => {
    if (stale.current !== null) clearTimeout(stale.current);
  }, []);
  // Coming back to a tab that does not read them itself, the number is read again: a text may have been published in the editor meanwhile.
  const lastTab = useRef(tab.id);
  useEffect(() => {
    if (lastTab.current === tab.id) return;
    lastTab.current = tab.id;
    onChecksStale();
  }, [tab.id, onChecksStale]);
  const checks = useMemo(() => (settings ? checklistFromSettings(settings) : null), [settings]);
  const openSteps = checks ? openStepCount(checks) : undefined;
  const archived = isEventArchived(outlet?.event);
  // A read that failed says nothing on the page (the Checklist tab has the error and its Retry): without a switch, the header has none.
  const switchUnavailable = settings === null && settingsLoad.error !== null && !reportsItself;
  const status = registrationHeaderStatus(reg, openSteps);

  return (
    <div className="screen">
      <PageHeader
        className="registration-pageheader"
        title={
          <>
            Registration
            {!switchUnavailable && <RegistrationStatusBadge status={status} />}
          </>
        }
        subtitle="Who gets in, and what you ask them."
        actions={eventId && !switchUnavailable ? <RegistrationHeaderActions reg={reg} eventId={eventId} archived={archived} status={status} onChecklist={tab.id === "checklist"} /> : undefined}
      />
      {eventId && <RegistrationSwitchOverlays reg={reg} eventId={eventId} superadmin={superadmin} />}
      <Tabs
        tabs={registrationTabItems(waiting || undefined, openSteps)}
        value={tab.id}
        onChange={(id) => setSearchParams({ tab: id }, { replace: true })}
      />
      {/* Keyed by the tab, so the panel enters with the same fade as every other tab's content. */}
      <div key={tab.id} role="tabpanel" aria-label={tab.label}>
        <TabPanel id={tab.id} counts={counts} settings={settings} reg={reg} onSettings={setSettings} onChecksStale={onChecksStale} />
      </div>
    </div>
  );
}
