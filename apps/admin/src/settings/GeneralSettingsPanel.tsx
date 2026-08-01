import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, HintLabel, Input, Notice, useToast, type ToastVariant } from "@admitto/ui";
import {
  fetchSecuritySettings,
  fetchSupportContact,
  patchSecuritySettings,
  patchSupportContact,
} from "../api/client.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  PatchSystemSettingsBody,
  SetupSupportContactDto,
  SettingSource,
  SystemSettingsDto,
} from "../api/types.js";
import { NO_AUTOFILL_PROPS, SettingsFooter } from "./mailTransportFormParts.js";

const EMPTY_SUPPORT_CONTACT: SetupSupportContactDto = {
  support_contact_name: null,
  support_contact_email: null,
};

const INSTANCE_URL_HINT =
  "Public HTTPS URL of this Admitto instance. Used for ticket links and to turn uploaded logo paths into absolute URLs in outbound email when the BASE_URL environment variable is not set.";
const SUPPORT_CONTACT_HINT =
  "Used to identify this instance to external services such as the geocoding provider used by the Location tab on event settings.";

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
 * ruled out. */
function describeSaveOutcome(
  urlResult: PromiseSettledResult<SystemSettingsDto>,
  contactResult: PromiseSettledResult<SetupSupportContactDto>,
): { message: string; variant: ToastVariant } {
  if (urlResult.status === "fulfilled" && contactResult.status === "fulfilled") {
    return { message: "Settings saved.", variant: "success" };
  }
  if (urlResult.status === "rejected" && contactResult.status === "rejected") {
    return { message: "Failed to save settings.", variant: "error" };
  }
  const rejected = urlResult.status === "rejected" ? urlResult : (contactResult as PromiseRejectedResult);
  return {
    message: operatorApiErrorMessage(rejected.reason, "Part of your settings failed to save - the rest was saved."),
    variant: "error",
  };
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

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const validationErrorsRef = useRef<HTMLUListElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [security, supportContact] = await Promise.all([
        fetchSecuritySettings(),
        fetchSupportContact(),
      ]);
      setSettings(security);
      setInstanceUrlDraft(security.instance_url.value ?? "");
      instanceUrlSavedRef.current = security.instance_url.value ?? "";
      setSupportContactDraft(supportContact);
      supportContactSavedRef.current = supportContact;
      setEmailError(null);
    } catch (err) {
      const message = operatorApiErrorMessage(err, "Failed to load organisation settings.");
      setLoadError(message);
      addToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const showLoading = useDelayedLoading(loading);

  if (loading) {
    if (!showLoading) return null;
    return (
      <Card title="Instance URL">
        <p className="sessions-status">Loading…</p>
      </Card>
    );
  }

  if (loadError || !settings) {
    return (
      <Card title="Instance URL">
        <div className="sessions-status">
          <p>{loadError}</p>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card
        title={<HintLabel hint={INSTANCE_URL_HINT}>Instance URL</HintLabel>}
        actions={
          !urlLocked ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving || clearing}
              onClick={() => void handleClearInstanceUrl()}
            >
              {clearing ? "Clearing…" : "Clear"}
            </Button>
          ) : undefined
        }
      >
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
      </Card>

      <Card title={<HintLabel hint={SUPPORT_CONTACT_HINT}>Support contact</HintLabel>}>
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
      </Card>

      <SettingsFooter
        validationErrors={[]}
        validationErrorsRef={validationErrorsRef}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving}
        onReset={handleReset}
        onSave={() => void handleSave()}
      />
    </>
  );
}
