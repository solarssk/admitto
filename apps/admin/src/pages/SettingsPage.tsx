import { useCallback, useState, type ReactNode } from "react";
import { Card, PageHeader, Tabs } from "@admitto/ui";
import { BrandingPanel } from "../settings/BrandingPanel.js";
import { MailTransportPanel } from "../settings/MailTransportPanel.js";
import { InstanceUrlPanel } from "../settings/InstanceUrlPanel.js";
import { SessionsPanel } from "../settings/SessionsPanel.js";
import { EventArchivingPanel } from "../settings/EventArchivingPanel.js";
import { SecurityPanel } from "../settings/SecurityPanel.js";
import { AuditLogPanel } from "../settings/AuditLogPanel.js";

type SettingsTab = "general" | "security" | "archiving" | "identity";

const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "security", label: "Security" },
  { id: "archiving", label: "Archiving" },
  { id: "identity", label: "Identity" },
] as const;

const INITIAL_VISITED_TABS: SettingsTab[] = ["general"];

function isSettingsTab(id: string): id is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.id === id);
}

/** Secondary action link — Button primitive has no native href support yet. */
function SettingsManageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="at-btn at-btn--secondary" href={href}>
      <span>{children}</span>
    </a>
  );
}

function IdentityProvidersCard() {
  return (
    <Card title="Identity providers">
      <div className="settings-row">
        <div className="settings-row__text">
          <strong>OIDC providers</strong>
          <p>Configure external OpenID Connect identity providers and group-to-role mapping.</p>
        </div>
        <SettingsManageLink href="/admin/auth/providers">Manage</SettingsManageLink>
      </div>
      <div className="settings-row">
        <div className="settings-row__text">
          <strong>Cloudflare Access</strong>
          <p>Protect admin paths with Cloudflare Zero Trust while keeping a local break-glass path.</p>
        </div>
        <SettingsManageLink href="/admin/auth/cf-access">Manage</SettingsManageLink>
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
  const [tab, setTab] = useState<SettingsTab>("general");
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<SettingsTab>>(
    () => new Set(INITIAL_VISITED_TABS),
  );

  const handleTabChange = useCallback((id: string) => {
    if (!isSettingsTab(id)) return;
    setTab(id);
    setVisitedTabs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

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
        <MailTransportPanel />
        <InstanceUrlPanel />
        <SessionsPanel />
      </SettingsTabPanel>
      <SettingsTabPanel
        tab="security"
        activeTab={tab}
        visited={visitedTabs}
        label="Security"
        className="settings-sections"
      >
        <SecurityPanel />
        <AuditLogPanel />
      </SettingsTabPanel>
      <SettingsTabPanel tab="archiving" activeTab={tab} visited={visitedTabs} label="Archiving">
        <EventArchivingPanel />
      </SettingsTabPanel>
      <SettingsTabPanel tab="identity" activeTab={tab} visited={visitedTabs} label="Identity">
        <IdentityProvidersCard />
      </SettingsTabPanel>
    </div>
  );
}
