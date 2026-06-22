import type { ReactNode } from "react";
import { Badge, Card, PageHeader } from "@admitto/ui";
import { BrandingPanel } from "../settings/BrandingPanel.js";
import { MailTransportPanel } from "../settings/MailTransportPanel.js";
import { SessionsPanel } from "../settings/SessionsPanel.js";
import { SecurityPanel } from "../settings/SecurityPanel.js";

interface SettingsPlaceholderProps {
  title: string;
  description: string;
  badge: string;
}

/** Secondary action link — Button primitive has no native href support yet. */
function SettingsManageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="at-btn at-btn--secondary" href={href}>
      <span>{children}</span>
    </a>
  );
}

function SettingsPlaceholderCard({ title, description, badge }: SettingsPlaceholderProps) {
  return (
    <Card title={title} actions={<Badge variant="neutral">{badge}</Badge>}>
      <p>{description}</p>
    </Card>
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

/** Instance-level settings shell content (branding, mail transport, roadmap placeholders, identity links). */
export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Instance branding, mail transport, sessions, security policies, and identity providers."
      />
      <div className="settings-sections">
        <BrandingPanel />
        <MailTransportPanel />
        <SessionsPanel />
        <SecurityPanel />
        <SettingsPlaceholderCard
          title="Event archiving"
          description="Archive completed events and control post-event data retention."
          badge="Coming in v0.4.5d"
        />
        <IdentityProvidersCard />
      </div>
    </>
  );
}
