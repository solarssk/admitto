import { useParams, useSearchParams } from "react-router";
import { PageHeader, Tabs } from "@admitto/ui";
import type { RegistrationCountsDto } from "../api/types.js";
import type { ListLoad } from "../hooks/useListLoad.js";
import { RegistrationAccessTab } from "../registration/RegistrationAccessTab.js";
import { RegistrationFieldsTab } from "../registration/RegistrationFieldsTab.js";
import { RegistrationLegalTab } from "../registration/RegistrationLegalTab.js";
import { RegistrationRequestsTab } from "../registration/RegistrationRequestsTab.js";
import { registrationTabFromSearch, registrationTabItems, type RegistrationTab } from "../registration/registrationTabs.js";
import { useRegistrationCounts } from "../registration/useRegistrationCounts.js";

/** The content of a tab. */
function TabPanel({ id, counts }: Readonly<{ id: RegistrationTab["id"]; counts: ListLoad<RegistrationCountsDto> }>) {
  if (id === "requests") return <RegistrationRequestsTab counts={counts} />;
  if (id === "fields") return <RegistrationFieldsTab />;
  if (id === "access") return <RegistrationAccessTab />;
  return <RegistrationLegalTab />;
}

/** How people get into the event: their requests, the questions they answer, the way in and the legal texts they read. */
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

  return (
    <div className="screen">
      <PageHeader title="Registration" subtitle="How people get into this event, and what you ask them." />
      <Tabs
        tabs={registrationTabItems(waiting || undefined)}
        value={tab.id}
        onChange={(id) => setSearchParams({ tab: id }, { replace: true })}
      />
      {/* Keyed by the tab, so the panel enters with the same fade as every other tab's content. */}
      <div key={tab.id} role="tabpanel" aria-label={tab.label}>
        <TabPanel id={tab.id} counts={counts} />
      </div>
    </div>
  );
}
