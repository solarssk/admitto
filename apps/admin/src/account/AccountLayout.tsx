import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "@admitto/ui";
import { ScrollFadeTabs } from "../components/ScrollFadeTabs.js";
import { AccountPage } from "./AccountPage.js";
import { ACCOUNT_TABS, inPageTabFromSearch, isAccountTab } from "./accountTabs.js";
import "./account-page.css";

export function AccountLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = inPageTabFromSearch(searchParams);

  const handleTabChange = useCallback(
    (id: string) => {
      if (!isAccountTab(id)) return;
      setSearchParams({ tab: id });
    },
    [setSearchParams],
  );

  return (
    <>
      <PageHeader
        title="My account"
        subtitle="Profile, password, two-factor authentication, sessions, and notifications."
      />
      <ScrollFadeTabs tabs={[...ACCOUNT_TABS]} value={activeTab} onChange={handleTabChange} />
      <AccountPage activeTab={activeTab} />
    </>
  );
}
