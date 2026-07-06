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
    () => new Set<SettingsTab>([initialTab]),
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

  // The URL is the source of truth for the active in-page tab. On any param change
  // (Back from the Identity sub-section, sidebar Settings link clearing the query, or
  // an external deep link) realign React state to what the URL says — restoring the
  // operator's tab instead of resetting to General (closes the #296 TODO).
  useEffect(() => {
    const raw = searchParams.get("tab");
    const valid = raw && raw !== "identity" && isSettingsTab(raw) ? raw : null;
    const target: SettingsTab = valid ?? "general";
    if (target !== tab) {
      setTab(target);
      setVisitedTabs((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
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
      // entry per tab click); merge into existing params so unrelated query keys
      // survive a tab switch.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", id);
          return next;
        },
        { replace: true },
      );
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

