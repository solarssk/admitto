import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { PageHeader, Tabs } from "@admitto/ui";
import type { RegistrationCountsDto } from "../api/types.js";
import type { ListLoad } from "../hooks/useListLoad.js";
import { openStepCount, type ChecklistCheck } from "../registration/accessReadiness.js";
import { RegistrationAccessTab } from "../registration/RegistrationAccessTab.js";
import { RegistrationChecklistTab } from "../registration/RegistrationChecklistTab.js";
import { RegistrationFieldsTab } from "../registration/RegistrationFieldsTab.js";
import { RegistrationLegalTab } from "../registration/RegistrationLegalTab.js";
import { RegistrationRequestsTab } from "../registration/RegistrationRequestsTab.js";
import { registrationTabFromSearch, registrationTabItems, type RegistrationTab } from "../registration/registrationTabs.js";
import { useRegistrationChecks, useRegistrationCounts } from "../registration/useRegistrationCounts.js";

/** The content of a tab. */
function TabPanel({
  id,
  counts,
  onReadiness,
}: Readonly<{ id: RegistrationTab["id"]; counts: ListLoad<RegistrationCountsDto>; onReadiness: (readiness: ChecklistCheck[]) => void }>) {
  if (id === "requests") return <RegistrationRequestsTab counts={counts} />;
  if (id === "fields") return <RegistrationFieldsTab />;
  if (id === "access") return <RegistrationAccessTab onReadiness={onReadiness} />;
  if (id === "checklist") return <RegistrationChecklistTab onReadiness={onReadiness} />;
  return <RegistrationLegalTab />;
}

/** How people get into the event: their requests, the questions they answer, the way in, the legal texts they read, and what is still missing. */
export function RegistrationPage() {
  const { eventId } = useParams();
  // One event, one page: another `:eventId` is a fresh page with its own numbers, never the previous event's.
  return <RegistrationPageBody key={eventId ?? ""} eventId={eventId} />;
}

function RegistrationPageBody({ eventId }: Readonly<{ eventId: string | undefined }>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = registrationTabFromSearch(searchParams);
  // The number on the Requests tab (D-B11) is the requests that wait for a decision, whichever tab is open. It is an extra:
  // while it is unknown, or zero, the tab has no number.
  const counts = useRegistrationCounts(eventId);
  const waiting = counts.data?.needs_decision;
  // The number on the Checklist tab is the steps that are still open, whichever tab is open. The Access tab (after a save) and the
  // Checklist tab read the checks themselves and tell the page what they found, so that the number is never older than the list; on
  // the other tabs the page reads them (once for each visit to such a tab).
  const [checks, setChecks] = useState<ChecklistCheck[] | null>(null);
  const reportsItself = tab.id === "access" || tab.id === "checklist";
  useRegistrationChecks(reportsItself ? undefined : eventId, setChecks);
  const openSteps = checks ? openStepCount(checks) : undefined;

  return (
    <div className="screen">
      <PageHeader title="Registration" subtitle="How people get into this event, and what you ask them." />
      <Tabs
        tabs={registrationTabItems(waiting || undefined, openSteps)}
        value={tab.id}
        onChange={(id) => setSearchParams({ tab: id }, { replace: true })}
      />
      {/* Keyed by the tab, so the panel enters with the same fade as every other tab's content. */}
      <div key={tab.id} role="tabpanel" aria-label={tab.label}>
        <TabPanel id={tab.id} counts={counts} onReadiness={setChecks} />
      </div>
    </div>
  );
}
