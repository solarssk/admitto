import { PageHeader } from "@admitto/ui";
import { MailTransportPanel } from "../settings/MailTransportPanel.js";

/** Instance-level settings (superadmin). */
export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Instance mail transport and configuration."
      />
      <div className="settings-sections">
        <MailTransportPanel />
      </div>
    </>
  );
}
