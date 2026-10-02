import { useRef, useState } from "react";
import { Button, Card, HintLabel, Input, Notice, useToast, type ToastVariant } from "@admitto/ui";
import {
  fetchSecuritySettings,
  fetchSupportContact,
  patchSecuritySettings,
  patchSupportContact,
} from "../api/client.js";
import { usePanelLoad } from "../hooks/usePanelLoad.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  PatchSystemSettingsBody,
  SetupSupportContactDto,
  SettingSource,
  SystemSettingsDto,
} from "../api/types.js";
import { NO_AUTOFILL_PROPS, EnvBadge, SettingsFooter } from "./mailTransportFormParts.js";
import { PanelLoadError } from "./PanelLoadError.js";
import { SettingsPanelSkeleton } from "./SettingsPanelSkeleton.js";

const EMPTY_SUPPORT_CONTACT: SetupSupportContactDto = {
  support_contact_name: null,
  support_contact_email: null,
};

const INSTANCE_URL_HINT =
  "Must be HTTPS with no trailing slash. Overridden when BASE_URL is set in the environment.";
const INSTANCE_URL_INTRO =
  "Public base URL used for ticket links and absolute logo URLs in outbound email.";
const SUPPORT_CONTACT_HINT =
  "Also identifies this instance to the geocoding provider used on the Location tab.";
const SUPPORT_CONTACT_INTRO =
  "Name and email for the organisation that runs this Admitto instance.";

/** The cards of the panel, for its placeholder: Instance URL has one field, Support contact two. */
const GENERAL_SKELETON_CARDS = [
  { id: "instance-url", title: "Instance URL", intro: true, fields: 1, controlHeight: 42 },
  { id: "support-contact", title: "Support contact", intro: true, fields: 2, columns: 2 as const, controlHeight: 64 },
];

function fieldLocked(source: SettingSource): boolean {
  return source === "env";
}

function isValidInstanceUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("https://")) return false;
  if (trimmed.endsWith("/")) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.search || parsed.hash) return false;
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value);
}

/** Both/neither rejected are the unambiguous cases; when exactly one side failed, "reject" is
 * whichever settled result wasn't fulfilled - there's no third option once the first two are
 * ruled out. Each failure names its own part (Instance URL vs Support contact) rather than
 * falling back to one generic "something failed" message for both, mirroring
 * `toastExternalServicesSaveResult`'s per-resource join in ExternalServicesPanel.tsx. */
function describeSaveOutcome(
  urlResult: PromiseSettledResult<SystemSettingsDto>,
  contactResult: PromiseSettledResult<SetupSupportContactDto>,
): { message: string; variant: ToastVariant } {
  if (urlResult.status === "fulfilled" && contactResult.status === "fulfilled") {
    return { message: "Settings saved.", variant: "success" };
  }
  const failures: string[] = [];
  if (urlResult.status === "rejected") {
    failures.push(operatorApiErrorMessage(urlResult.reason, "Failed to save instance URL."));
  }
  if (contactResult.status === "rejected") {
    failures.push(operatorApiErrorMessage(contactResult.reason, "Failed to save support contact."));
  }
  return { message: failures.join(" "), variant: "error" };
}

/** General tab: Instance URL + Support contact, one shared Save/Reset (mirrors
 * BrandingSettingsPanel's org-branding + theme consolidation - see that file for the same
 * combined-load / combined-save-with-partial-failure-toast shape). Superadmin only
 * (route-gated by SettingsLayout's SuperadminGuard). */
export function GeneralSettingsPanel() {
  const { addToast } = useToast();

  const [settings, setSettings] = useState<SystemSettingsDto | null>(null);
  const [instanceUrlDraft, setInstanceUrlDraft] = useState("");
  const instanceUrlSavedRef = useRef("");

  const [supportContactDraft, setSupportContactDraft] =
    useState<SetupSupportContactDto>(EMPTY_SUPPORT_CONTACT);
  const supportContactSavedRef = useRef<SetupSupportContactDto>(EMPTY_SUPPORT_CONTACT);

  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const validationErrorsRef = useRef<HTMLUListElement>(null);

  const panel = usePanelLoad({
    fetch: async (signal) => {
      const [security, supportContact] = await Promise.all([fetchSecuritySettings(signal), fetchSupportContact(signal)]);
      return { security, supportContact };
    },
    apply: ({ security, supportContact }) => {
      setSettings(security);
      setInstanceUrlDraft(security.instance_url.value ?? "");
      instanceUrlSavedRef.current = security.instance_url.value ?? "";
      setSupportContactDraft(supportContact);
      supportContactSavedRef.current = supportContact;
      setEmailError(null);
    },
    fallback: "Could not load organisation settings.",
  });

  const hasConfiguredUrl = Boolean(settings?.instance_url.value?.trim());
  const urlLocked = settings ? fieldLocked(settings.instance_url.source) : false;
  const showUrlWarning = settings && !urlLocked && !hasConfiguredUrl;

  const hasUnsavedChanges =
    instanceUrlDraft.trim() !== instanceUrlSavedRef.current.trim() ||
    JSON.stringify(supportContactDraft) !== JSON.stringify(supportContactSavedRef.current);

  const handleClearInstanceUrl = async () => {
    setClearing(true);
    try {
      const updated = await patchSecuritySettings({ instance_url: null });
      setSettings(updated);
      setInstanceUrlDraft("");
      instanceUrlSavedRef.current = "";
      addToast("Instance URL cleared.", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to clear Instance URL."), "error");
    } finally {
      setClearing(false);
    }
  };

  const handleReset = () => {
    setInstanceUrlDraft(instanceUrlSavedRef.current);
    setSupportContactDraft(supportContactSavedRef.current);
    setEmailError(null);
  };

  const handleSave = async () => {
    const trimmedUrl = instanceUrlDraft.trim();
    if (!urlLocked && trimmedUrl && !isValidInstanceUrl(trimmedUrl)) {
      addToast(
        "Instance URL must use https://, must not end with a trailing slash, and must not include credentials, a query, or a fragment.",
        "error",
      );
      return;
    }

    const contactName = (supportContactDraft.support_contact_name ?? "").trim();
    const contactEmail = (supportContactDraft.support_contact_email ?? "").trim();
    if (contactEmail && !isValidEmail(contactEmail)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);

    setSaving(true);
    try {
      const urlSave: Promise<SystemSettingsDto> = urlLocked
        // Save only renders once settings has loaded, so this is never actually null here -
        // asserted rather than an unreachable `if (!settings) return` guard up top.
        ? Promise.resolve(settings!)
        : patchSecuritySettings({ instance_url: trimmedUrl.length > 0 ? trimmedUrl : null } satisfies PatchSystemSettingsBody);
      const contactChanged =
        contactName !== (supportContactSavedRef.current.support_contact_name ?? "") ||
        contactEmail !== (supportContactSavedRef.current.support_contact_email ?? "");
      const contactSave: Promise<SetupSupportContactDto> = contactChanged
        ? patchSupportContact({ support_contact_name: contactName, support_contact_email: contactEmail })
        : Promise.resolve(supportContactSavedRef.current);

      const [urlResult, contactResult] = await Promise.allSettled([urlSave, contactSave]);

      if (urlResult.status === "fulfilled") {
        setSettings(urlResult.value);
        setInstanceUrlDraft(urlResult.value.instance_url.value ?? "");
        instanceUrlSavedRef.current = urlResult.value.instance_url.value ?? "";
      }
      if (contactResult.status === "fulfilled") {
        setSupportContactDraft(contactResult.value);
        supportContactSavedRef.current = contactResult.value;
      }

      const outcome = describeSaveOutcome(urlResult, contactResult);
      addToast(outcome.message, outcome.variant);
    } finally {
      setSaving(false);
    }
  };

  if (!panel.gate.showContent) {
    return (
      <SettingsPanelSkeleton
        label="Loading organisation settings"
        held={!panel.gate.showIndicator}
        slow={panel.slow}
        cards={GENERAL_SKELETON_CARDS}
      />
    );
  }

  if (panel.error) {
    return (
      <PanelLoadError
        cardTitle="Instance URL"
        title="Could not load organisation settings"
        message={panel.error}
        retrying={panel.retrying}
        onRetry={panel.retry}
      />
    );
  }

  // Successful load always populates settings; failures always set loadError above.
  /* v8 ignore if */
  if (!settings) return null;

  return (
    <div className="settings-sections at-fade-in">
      <Card
        title={<HintLabel hint={INSTANCE_URL_HINT}>Instance URL</HintLabel>}
        actions={
          urlLocked ? (
            <EnvBadge locked />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={clearing}
              disabled={saving}
              onClick={() => void handleClearInstanceUrl()}
            >
              Clear
            </Button>
          )
        }
      >
        <div className="settings-card-stack">
          <p className="settings-card-intro">{INSTANCE_URL_INTRO}</p>
          <div className="mail-transport-section">
            <div className="mail-field-row">
              <Input
                label="URL"
                type="url"
                value={instanceUrlDraft}
                disabled={urlLocked || saving}
                placeholder="https://tickets.example.com"
                onChange={(e) => setInstanceUrlDraft(e.target.value)}
              />
            </div>

            {showUrlWarning && (
              <Notice variant="warning" role="alert">
                No instance URL configured. Email previews and sends may use localhost in development,
                or fail in production until you set this value or BASE_URL in the environment.
              </Notice>
            )}
          </div>
        </div>
      </Card>

      <Card title={<HintLabel hint={SUPPORT_CONTACT_HINT}>Support contact</HintLabel>}>
        <div className="settings-card-stack">
          <p className="settings-card-intro">{SUPPORT_CONTACT_INTRO}</p>
          <div className="mail-transport-section">
            <Input
              label="Contact name"
              value={supportContactDraft.support_contact_name ?? ""}
              disabled={saving}
              placeholder="e.g. Acme Events"
              hint="Company name, or a person's first and last name."
              onChange={(e) =>
                setSupportContactDraft((prev) => ({ ...prev, support_contact_name: e.target.value }))
              }
            />
            <Input
              label="Contact email"
              type="text"
              inputMode="email"
              value={supportContactDraft.support_contact_email ?? ""}
              disabled={saving}
              placeholder="support@example.com"
              error={emailError ?? undefined}
              hint="An email address for questions about this instance."
              {...NO_AUTOFILL_PROPS}
              onChange={(e) =>
                setSupportContactDraft((prev) => ({ ...prev, support_contact_email: e.target.value }))
              }
            />
          </div>
        </div>
      </Card>

      <SettingsFooter
        validationErrors={[]}
        validationErrorsRef={validationErrorsRef}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving}
        onReset={handleReset}
        onSave={() => void handleSave()}
      />
    </div>
  );
}
