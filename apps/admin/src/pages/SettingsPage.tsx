import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { BrandingPanel } from "../settings/BrandingPanel.js";
import { OrganisationBrandingPanel } from "../settings/OrganisationBrandingPanel.js";
import { MailTransportPanel } from "../settings/MailTransportPanel.js";
import { InstanceUrlPanel } from "../settings/InstanceUrlPanel.js";
import { SessionsPanel } from "../settings/SessionsPanel.js";
import { EventArchivingPanel } from "../settings/EventArchivingPanel.js";
import { SecurityPanel } from "../settings/SecurityPanel.js";
import { AuditLogPanel } from "../settings/AuditLogPanel.js";
import { inPageTabFromSearch, type SettingsTab } from "../settings/settingsTabs.js";

interface SettingsTabPanelProps {
  tab: SettingsTab;
  activeTab: SettingsTab;
  visited: ReadonlySet<SettingsTab>;
  label: string;
  className?: string;
  children: ReactNode;
}

/** Mount on first visit; stay mounted so drafts and filter state survive tab switches. */
function SettingsTabPanel({
  tab,
  activeTab,
  visited,
  label,
  className,
  children,
}: Readonly<SettingsTabPanelProps>) {
  if (!visited.has(tab)) return null;
  return (
    <div role="tabpanel" aria-label={label} hidden={activeTab !== tab} className={className}>
      {children}
    </div>
  );
}

/** In-page Settings panels for General / Mail / Security / Archiving (index route). */
export function SettingsTabContent() {
  const [searchParams] = useSearchParams();

  const initialTab = inPageTabFromSearch(searchParams);
  const [tab, setTab] = useState<Exclude<SettingsTab, "identity">>(initialTab);
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<Exclude<SettingsTab, "identity">>>(
    () => new Set([initialTab]),
  );

  // The URL is the source of truth for the active in-page tab. On any param change
  // (Back from Identity, sidebar Settings link clearing the query, or a deep link)
  // realign React state to what the URL says.
  useEffect(() => {
    const target = inPageTabFromSearch(searchParams);
    if (target !== tab) {
      setTab(target);
      setVisitedTabs((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
    }
  }, [searchParams, tab]);

  return (
    <>
      <SettingsTabPanel
        tab="general"
        activeTab={tab}
        visited={visitedTabs}
        label="General"
        className="settings-sections"
      >
        <OrganisationBrandingPanel />
        <BrandingPanel />
        <InstanceUrlPanel />
      </SettingsTabPanel>
      <SettingsTabPanel
        tab="mail"
        activeTab={tab}
        visited={visitedTabs}
        label="Mail"
        className="settings-sections"
      >
        <MailTransportPanel />
      </SettingsTabPanel>
      <SettingsTabPanel
        tab="security"
        activeTab={tab}
        visited={visitedTabs}
        label="Security"
        className="settings-sections"
      >
        <SecurityPanel />
        <SessionsPanel />
        <AuditLogPanel />
      </SettingsTabPanel>
      <SettingsTabPanel tab="archiving" activeTab={tab} visited={visitedTabs} label="Archiving">
        <EventArchivingPanel />
      </SettingsTabPanel>
    </>
  );
}
