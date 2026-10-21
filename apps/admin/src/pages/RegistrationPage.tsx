import { useSearchParams } from "react-router";
import { EmptyState, PageHeader, Tabs } from "@admitto/ui";
import { registrationTabFromSearch, registrationTabItems, type RegistrationTab } from "../registration/registrationTabs.js";

/** What each tab will hold. The PR that builds a tab replaces its entry with the tab's content. */
const TAB_PLACEHOLDERS: Record<RegistrationTab["id"], string> = {
  requests: "Registration requests from guests will be listed here.",
  fields: "The questions guests answer on the registration form will be managed here.",
  access: "The registration mode and the ways guests can sign up will be set here.",
};

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
        <EmptyState title={TAB_PLACEHOLDERS[tab.id]} />
      </div>
    </div>
  );
}
