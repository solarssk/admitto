import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader, Tabs } from "@admitto/ui";
import { BrandingPanel } from "../settings/BrandingPanel.js";
import { MailTransportPanel } from "../settings/MailTransportPanel.js";
import { InstanceUrlPanel } from "../settings/InstanceUrlPanel.js";
import { SessionsPanel } from "../settings/SessionsPanel.js";
import { EventArchivingPanel } from "../settings/EventArchivingPanel.js";
import { SecurityPanel } from "../settings/SecurityPanel.js";
import { AuditLogPanel } from "../settings/AuditLogPanel.js";
import { IDENTITY_PROVIDERS_ROUTE } from "../identity/routes.js";

type SettingsTab = "general" | "mail" | "security" | "archiving" | "identity";

const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "mail", label: "Mail" },
  { id: "security", label: "Security" },
  { id: "archiving", label: "Archiving" },
  { id: "identity", label: "Identity" },
] as const;

const INITIAL_VISITED_TABS: SettingsTab[] = ["general"];

function isSettingsTab(id: string): id is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.id === id);
}

interface SettingsTabPanelProps {
  tab: SettingsTab;
  activeTab: SettingsTab;
  visited: ReadonlySet<SettingsTab>;
  label: string;
  className?: string;
  children: ReactNode;
}

/** Mount on first visit; stay mounted so drafts and filter state survive tab switches. */
function SettingsTabPanel({ tab, activeTab, visited, label, className, children }: SettingsTabPanelProps) {
  if (!visited.has(tab)) return null;
  return (
    <div role="tabpanel" aria-label={label} hidden={activeTab !== tab} className={className}>
      {children}
    </div>
  );
}

const IDENTITY_ROUTE = IDENTITY_PROVIDERS_ROUTE;

/** Instance-level settings: grouped in-app tabs (branding, security, archiving, identity links). */
export function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab: SettingsTab = (() => {
    const t = searchParams.get("tab");
    return t && t !== "identity" && isSettingsTab(t) ? t : "general";
  })();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<SettingsTab>>(
    () => new Set<SettingsTab>([...INITIAL_VISITED_TABS, initialTab]),
  );

  const openIdentity = useCallback(() => {
    navigate(IDENTITY_ROUTE);
  }, [navigate]);

  // Legacy entry: /admin/settings?tab=identity redirects (replace, not push) to the
  // canonical Identity & SSO route. Using replace avoids a Back-button loop back into
  // ?tab=identity, which would re-fire this effect and bounce the user forward again.
  useEffect(() => {
    if (searchParams.get("tab") === "identity") {
      navigate(IDENTITY_ROUTE, { replace: true });
    }
  }, [searchParams, navigate]);

  // Restore the active in-page tab from the URL when navigating back from the Identity
  // sub-section (or any external param change). Replaces the slice-5 TODO(#266): the
  // operator returns to the tab they were on (e.g. Security) instead of resetting to
  // General.
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && t !== "identity" && isSettingsTab(t) && t !== tab) {
      setTab(t);
      setVisitedTabs((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
    }
  }, [searchParams, tab]);

  const handleTabChange = useCallback(
    (id: string) => {
      if (!isSettingsTab(id)) return;
      // Identity has its own routed sub-section (IdentityLayout) with canonical URLs
      // for deep-linking; clicking the tab hands off to that route instead of an
      // in-page panel (#266). Push (not replace) so Back returns to Settings.
      if (id === "identity") {
        openIdentity();
        return;
      }
      setTab(id);
      setVisitedTabs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      // Reflect the active tab in the URL (replace, so we don't stack one history
      // entry per tab click); Back still crosses from Identity → Settings tab.
      setSearchParams({ tab: id }, { replace: true });
    },
    [openIdentity, setSearchParams],
  );

  return (
    <div className="settings-page">
      <PageHeader
        title="Settings"
        subtitle="Instance configuration, security policies, and identity providers."
      />
      <Tabs value={tab} onChange={handleTabChange} tabs={[...SETTINGS_TABS]} />
      <SettingsTabPanel
        tab="general"
        activeTab={tab}
        visited={visitedTabs}
        label="General"
        className="settings-sections"
      >
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
    </div>
  );
}

