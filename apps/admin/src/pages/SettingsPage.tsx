import { useState, type ReactNode } from "react";
import { Badge, Card, PageHeader, Tabs } from "@admitto/ui";
import { BrandingPanel } from "../settings/BrandingPanel.js";
import { MailTransportPanel } from "../settings/MailTransportPanel.js";
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

/** Instance-level settings: grouped in-app tabs (branding, security, archiving, identity links). */
export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("general");

  return (
    <div className="settings-page">
      <PageHeader
        title="Settings"
        subtitle="Instance configuration, security policies, and identity providers."
      />
      <Tabs
        value={tab}
        onChange={(id) => setTab(id as SettingsTab)}
        tabs={[...SETTINGS_TABS]}
      />
      {tab === "general" && (
        <div className="settings-sections" role="tabpanel" aria-label="General">
          <BrandingPanel />
          <MailTransportPanel />
          <SessionsPanel />
        </div>
      )}
      {tab === "security" && (
        <div className="settings-sections" role="tabpanel" aria-label="Security">
          <SecurityPanel />
          <AuditLogPanel />
        </div>
      )}
      {tab === "archiving" && (
        <div role="tabpanel" aria-label="Archiving">
          <EventArchivingPanel />
        </div>
      )}
      {tab === "identity" && (
        <div role="tabpanel" aria-label="Identity">
          <IdentityProvidersCard />
        </div>
      )}
    </div>
  );
}
