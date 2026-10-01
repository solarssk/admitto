import { describe, expect, it } from "vitest";
import { RULES, RULE_HINTS, scanLoadingViolations, type Counts, type Rule } from "./loadingStandardScan.js";

/**
 * Drift guard for the admin SPA's loading, busy and failed-load states (AGENTS.md "Admin SPA loading and busy states").
 *
 * This is a ratchet: the table below is every place that still uses an old idiom when the
 * standard was introduced. A file may not gain a violation, and the count for a file may only go
 * down. When a migration PR removes an old idiom, lower (or delete) its entry in the same PR; this
 * test fails with "lower the allowlist" until you do, so the debt can only shrink. The final
 * migration PR leaves each table empty, and the tables can then be replaced by a plain
 * `expect(found).toEqual({})`.
 */
const ALLOWED: Record<Rule, Counts> = {
  "hand-rolled-spinner-css": {
    "apps/admin/src/pages/setup-wizard.css": 2,
    "apps/admin/src/settings/health-check.css": 1,
    "apps/admin/src/staff.css": 2,
  },
  "bare-loading-text": {
    "apps/admin/src/account/AccountPage.tsx": 1,
    "apps/admin/src/communication/DeliveryDetailsModal.tsx": 1,
    "apps/admin/src/communication/DeliveryLogTable.tsx": 1,
    "apps/admin/src/communication/SentMessagePreviewModal.tsx": 1,
    "apps/admin/src/components/EventImageAssetLibrary.tsx": 1,
    "apps/admin/src/identity/IdentityMappingRepeater.tsx": 1,
    "apps/admin/src/pages/CommunicationPage.tsx": 1,
    "apps/admin/src/pages/CustomFieldsReportsTab.tsx": 1,
    "apps/admin/src/pages/EventOverviewPage.tsx": 4,
    "apps/admin/src/pages/EventSettingsPage.tsx": 1,
    "apps/admin/src/pages/ImportPage.tsx": 1,
    "apps/admin/src/pages/MailReportsTab.tsx": 1,
    "apps/admin/src/pages/RequirementsPage.tsx": 1,
    "apps/admin/src/pages/WalletsReportsTab.tsx": 1,
    "apps/admin/src/pages/users/ActiveSessionsTab.tsx": 1,
    "apps/admin/src/pages/wizard/WizardStep2Mail.tsx": 1,
    "apps/admin/src/pages/wizard/WizardStep3Branding.tsx": 1,
    "apps/admin/src/requirements/EventCustomFieldsCard.tsx": 1,
    "apps/admin/src/settings/BrandingSettingsPanel.tsx": 1,
    "apps/admin/src/settings/CheckInBehaviourPanel.tsx": 1,
    "apps/admin/src/settings/EventArchivingPanel.tsx": 1,
    "apps/admin/src/settings/EventBounceIngestPanel.tsx": 1,
    "apps/admin/src/settings/EventMailSettingsCard.tsx": 1,
    "apps/admin/src/settings/EventWalletPanel.tsx": 3,
    "apps/admin/src/settings/ExternalServicesPanel.tsx": 1,
    "apps/admin/src/settings/GeneralSettingsPanel.tsx": 1,
    "apps/admin/src/settings/HealthCheckPanel.tsx": 1,
    "apps/admin/src/settings/LocationSettingsPanel.tsx": 1,
    "apps/admin/src/settings/MailTransportPanel.tsx": 1,
    "apps/admin/src/settings/NotificationsPanel.tsx": 1,
    "apps/admin/src/settings/SecurityPanel.tsx": 1,
    "apps/admin/src/settings/SystemLogsPanel.tsx": 1,
    "apps/admin/src/settings/TicketTypesCard.tsx": 1,
  },
  "busy-label-swap": {
    "apps/admin/src/communication/CommunicationSendPanel.tsx": 2,
    "apps/admin/src/communication/CreateTemplateDialog.tsx": 1,
    "apps/admin/src/communication/DeliveryLogTable.tsx": 1,
    "apps/admin/src/communication/EditTemplateModal.tsx": 1,
    "apps/admin/src/communication/WalletsSendPanel.tsx": 2,
    "apps/admin/src/components/ConfirmDialog.tsx": 1,
    "apps/admin/src/components/EventImageAssetLibrary.tsx": 1,
    "apps/admin/src/components/LogoUploadZone.tsx": 1,
    "apps/admin/src/components/VenueAutocomplete.tsx": 1,
    "apps/admin/src/components/crop/CropImageModal.tsx": 1,
    "apps/admin/src/events/CreateEventModal.tsx": 1,
    "apps/admin/src/identity/CfAccessEditor.tsx": 2,
    "apps/admin/src/identity/IdentityMappingRepeater.tsx": 1,
    "apps/admin/src/identity/IdentityProviderEditor.tsx": 2,
    "apps/admin/src/pages/CommunicationPage.tsx": 2,
    "apps/admin/src/pages/DeviceLabelStep.tsx": 1,
    "apps/admin/src/pages/EventOverviewPage.tsx": 3,
    "apps/admin/src/pages/ImportPage.tsx": 3,
    "apps/admin/src/pages/ReportsPage.tsx": 1,
    "apps/admin/src/pages/RequirementsPage.tsx": 1,
    "apps/admin/src/pages/SetupWizardPage.tsx": 3,
    "apps/admin/src/pages/users/DeviceLabelEditModal.tsx": 1,
    "apps/admin/src/pages/users/InviteUserModal.tsx": 1,
    "apps/admin/src/pages/users/UserEditModal.tsx": 2,
    "apps/admin/src/pages/wizard/WizardStep2Mail.tsx": 1,
    "apps/admin/src/requirements/EventItemDrawer.tsx": 1,
    "apps/admin/src/settings/AuditLogPanel.tsx": 2,
    "apps/admin/src/settings/BrandingSettingsPanel.tsx": 1,
    "apps/admin/src/settings/EventBounceIngestPanel.tsx": 1,
    "apps/admin/src/settings/EventDangerZonePanel.tsx": 1,
    "apps/admin/src/settings/EventWalletPanel.tsx": 1,
    "apps/admin/src/settings/ExternalServicesPanel.tsx": 2,
    "apps/admin/src/settings/FontFamilyModal.tsx": 1,
    "apps/admin/src/settings/GeneralSettingsPanel.tsx": 1,
    "apps/admin/src/settings/NotificationsPanel.tsx": 1,
    "apps/admin/src/settings/mailTransportFormParts.tsx": 2,
  },
  "error-state-not-an-alert": {},
  "retry-outside-an-alert": {},
  // A Retry drawn as a raw <button>, each to move to <Button loading> with the screen that owns it.
  "retry-in-a-raw-button": {
    "apps/admin/src/components/NotificationBell.tsx": 1,
    "apps/admin/src/settings/EventBounceIngestPanel.tsx": 1,
  },
  // Hand-made busy states on a raw <button>, each to move to <Button loading> with the screen that owns it.
  "raw-button-busy-disabled": {
    "apps/admin/src/checkin/CameraOverlayItemIssuing.tsx": 1,
    "apps/admin/src/components/NotificationBell.tsx": 2,
    "apps/admin/src/pages/AttendeeDetailPage.tsx": 3,
    "apps/admin/src/pages/CheckInPage.tsx": 2,
    "apps/admin/src/pages/ImportPage.tsx": 1,
    "apps/admin/src/pages/ReportsPage.tsx": 1,
    "apps/admin/src/pages/users/UserEditModal.tsx": 2,
    "apps/admin/src/settings/LocationSettingsPanel.tsx": 1,
  },
};

describe("loading standard drift (apps/admin/src)", () => {
  const found = scanLoadingViolations();

  it.each(RULES)("%s: no new violations, and the allowlist only shrinks", (rule) => {
    const actual = found[rule];
    const allowed = ALLOWED[rule];

    const grew = Object.entries(actual)
      .filter(([file, n]) => n > (allowed[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} (allowed ${allowed[file] ?? 0})`);
    expect(grew, `New "${rule}" violation. ${RULE_HINTS[rule]}`).toEqual([]);

    const shrank = Object.entries(allowed)
      .filter(([file, n]) => (actual[file] ?? 0) < n)
      .map(([file, n]) => `${file}: ${actual[file] ?? 0} (allowlist says ${n})`);
    expect(shrank, `Nice: "${rule}" debt went down. Lower or remove these entries in ALLOWED.`).toEqual([]);
  });
});
