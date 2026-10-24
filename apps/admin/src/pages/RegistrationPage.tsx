import { useParams, useSearchParams } from "react-router";
import { EmptyState, PageHeader, Tabs } from "@admitto/ui";
import type { RegistrationCountsDto } from "../api/types.js";
import type { ListLoad } from "../hooks/useListLoad.js";
import { RegistrationFieldsTab } from "../registration/RegistrationFieldsTab.js";
import { RegistrationLegalTab } from "../registration/RegistrationLegalTab.js";
import { RegistrationRequestsTab } from "../registration/RegistrationRequestsTab.js";
import { registrationTabFromSearch, registrationTabItems, type RegistrationTab } from "../registration/registrationTabs.js";
import { useRegistrationCounts } from "../registration/useRegistrationCounts.js";

/** What each tab that is not built yet will hold. The PR that builds a tab takes its entry out and puts the tab's content in. */
const TAB_PLACEHOLDERS: Record<Exclude<RegistrationTab["id"], "requests" | "fields" | "legal">, string> = {
  access: "The registration mode and the ways guests can sign up will be set here.",
};

/** The content of a tab: what is built, or what the tab will hold. */
function TabPanel({ id, counts }: Readonly<{ id: RegistrationTab["id"]; counts: ListLoad<RegistrationCountsDto> }>) {
  if (id === "requests") return <RegistrationRequestsTab counts={counts} />;
  if (id === "fields") return <RegistrationFieldsTab />;
  if (id === "legal") return <RegistrationLegalTab />;
  return <EmptyState title={TAB_PLACEHOLDERS[id]} />;
}

/** How people get into the event: their requests, the questions they answer and the way in. Not in the menu yet. */
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
