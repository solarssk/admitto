import { useSearchParams } from "react-router";
import { EmptyState, PageHeader, Tabs } from "@admitto/ui";
import { RegistrationFieldsTab } from "../registration/RegistrationFieldsTab.js";
import { RegistrationLegalTab } from "../registration/RegistrationLegalTab.js";
import { registrationTabFromSearch, registrationTabItems, type RegistrationTab } from "../registration/registrationTabs.js";

/** What each tab that is not built yet will hold. The PR that builds a tab takes its entry out and puts the tab's content in. */
const TAB_PLACEHOLDERS: Record<Exclude<RegistrationTab["id"], "fields" | "legal">, string> = {
  requests: "Registration requests from guests will be listed here.",
  access: "The registration mode and the ways guests can sign up will be set here.",
};

/** The content of a tab: what is built, or what the tab will hold. */
function TabPanel({ id }: Readonly<{ id: RegistrationTab["id"] }>) {
  if (id === "fields") return <RegistrationFieldsTab />;
  if (id === "legal") return <RegistrationLegalTab />;
  return <EmptyState title={TAB_PLACEHOLDERS[id]} />;
}

/** How people get into the event: their requests, the questions they answer and the way in. Not in the menu yet. */
export function RegistrationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = registrationTabFromSearch(searchParams);

  return (
    <div className="screen">
      <PageHeader title="Registration" subtitle="How people get into this event, and what you ask them." />
      <Tabs
        tabs={registrationTabItems()}
        value={tab.id}
        onChange={(id) => setSearchParams({ tab: id }, { replace: true })}
      />
      {/* Keyed by the tab, so the panel enters with the same fade as every other tab's content. */}
      <div key={tab.id} role="tabpanel" aria-label={tab.label}>
        <TabPanel id={tab.id} />
      </div>
    </div>
  );
}
