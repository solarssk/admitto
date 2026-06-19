import { Badge, Card, PageHeader } from "@admitto/ui";
import { BrandingPanel } from "../settings/BrandingPanel.js";

interface SettingsPlaceholderProps {
  title: string;
  description: string;
  badge: string;
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
        <a className="at-btn at-btn--secondary" href="/admin/auth/providers">
          Manage
        </a>
      </div>
      <div className="settings-row">
        <div className="settings-row__text">
          <strong>Cloudflare Access</strong>
          <p>Protect admin paths with Cloudflare Zero Trust while keeping a local break-glass path.</p>
        </div>
        <a className="at-btn at-btn--secondary" href="/admin/auth/cf-access">
          Manage
        </a>
      </div>
    </Card>
  );
}

/** Instance-level settings shell content (branding + roadmap placeholders + identity links). */
export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Instance branding, mail transport, sessions, and identity."
      />
      <div className="settings-sections">
        <BrandingPanel />
        <SettingsPlaceholderCard
          title="Mail transport"
          description="Configure Microsoft Graph, SMTP, or Power Automate for outbound event mail."
          badge="Coming in v0.4.5b"
        />
        <SettingsPlaceholderCard
          title="Sessions"
          description="Review and revoke active staff sessions across admin and operator surfaces."
          badge="Coming in v0.4.5c"
        />
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
