import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, PageHeader, Tabs } from "@admitto/ui";
import { BrandingPanel } from "../settings/BrandingPanel.js";
import { MailTransportPanel } from "../settings/MailTransportPanel.js";
import { InstanceUrlPanel } from "../settings/InstanceUrlPanel.js";
import { SessionsPanel } from "../settings/SessionsPanel.js";
import { EventArchivingPanel } from "../settings/EventArchivingPanel.js";
import { SecurityPanel } from "../settings/SecurityPanel.js";
import { AuditLogPanel } from "../settings/AuditLogPanel.js";

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

/**
 * Identity overview teaser rendered inside the Settings Identity tab. The full
 * Identity & SSO section lives at /admin/settings/identity/* (IdentityLayout) —
 * this card just routes the operator there. Kept as an in-tab card so the tab
 * strip still has content for "identity" before the route hand-off (#266 slice 2).
 */
function IdentityProvidersCard({ onOpen }: { onOpen: () => void }) {
  return (
    <Card title="Identity providers">
      <div className="settings-row">
        <div className="settings-row__text">
          <strong>OIDC providers & Cloudflare Access</strong>
          <p>
            Manage OpenID Connect identity providers, group-to-role mapping, and Cloudflare Zero
            Trust access from the unified Identity & SSO section.
          </p>
        </div>
        <button type="button" className="at-btn at-btn--secondary" onClick={onOpen}>
          <span>Open Identity & SSO</span>
        </button>
      </div>
    </Card>
  );
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

/** Instance-level settings: grouped in-app tabs (branding, security, archiving, identity links). */
export function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<SettingsTab>("general");
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<SettingsTab>>(
    () => new Set(INITIAL_VISITED_TABS),
  );

  const openIdentity = useCallback(() => {
    navigate("/admin/settings/identity/providers");
  }, [navigate]);

  // Legacy entry: /admin/settings?tab=identity redirects to the canonical
  // Identity & SSO route (deep-linkable, lives under the SPA shell). #266.
  useEffect(() => {
    if (searchParams.get("tab") === "identity") {
      openIdentity();
    }
  }, [searchParams, openIdentity]);

  const handleTabChange = useCallback(
    (id: string) => {
      if (!isSettingsTab(id)) return;
      // Identity has its own routed sub-section (IdentityLayout) with canonical URLs
      // for deep-linking; clicking the tab hands off to that route instead of an
      // in-page panel (#266).
      if (id === "identity") {
        openIdentity();
        return;
      }
      setTab(id);
      setVisitedTabs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    },
    [openIdentity],
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
      <SettingsTabPanel tab="identity" activeTab={tab} visited={visitedTabs} label="Identity">
        <IdentityProvidersCard onOpen={openIdentity} />
      </SettingsTabPanel>
    </div>
  );
}
