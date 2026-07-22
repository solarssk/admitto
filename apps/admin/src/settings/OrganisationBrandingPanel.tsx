import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Input, useToast } from "@admitto/ui";
import { fetchOrgBranding, patchOrgBranding } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { SetupOrgBrandingDto } from "../api/types.js";
import { LogoUploadZone } from "../components/LogoUploadZone.js";
import { safeBrandingLogoHref } from "../utils/safeBrandingLogoHref.js";

const EMPTY_DRAFT: SetupOrgBrandingDto = { org_name: "", logo_url: "" };

/**
 * Superadmin editor for the organisation's name and logo — the primary place to
 * change branding after the setup wizard (which only sets these once, at onboarding).
 * Reuses the same GET/PATCH org-branding API and LogoUploadZone as the wizard (#396).
 */
export function OrganisationBrandingPanel() {
  const { addToast } = useToast();
  const [draft, setDraft] = useState<SetupOrgBrandingDto>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const savedRef = useRef<SetupOrgBrandingDto>(EMPTY_DRAFT);
  const loadAbortRef = useRef<AbortController | null>(null);

  const loadedOk = !loading && !loadError;

  const loadBranding = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    const { signal } = ac;

    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchOrgBranding(signal);
      if (signal.aborted) return;
      savedRef.current = data;
      setDraft(data);
      setNameError(null);
    } catch {
      if (signal.aborted) return;
      setLoadError("Failed to load organisation branding. Use Retry to reload.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBranding();
    return () => loadAbortRef.current?.abort();
  }, [loadBranding]);

  const handleReset = () => {
    if (!loadedOk) return;
    setDraft(savedRef.current);
    setNameError(null);
  };

  const handleSave = async () => {
    if (!loadedOk || loadError) return;
    const name = (draft.org_name ?? "").trim();
    if (!name) {
      setNameError("Organisation name is required.");
      return;
    }
    const logo = (draft.logo_url ?? "").trim();
    if (logo && !safeBrandingLogoHref(logo)) {
      addToast("Logo must be a valid HTTPS URL or uploaded image.", "error");
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      const data = await patchOrgBranding({ org_name: name, logo_url: logo || null });
      savedRef.current = data;
      setDraft(data);
      addToast("Organisation branding saved.", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save organisation branding."), "error");
    } finally {
      setSaving(false);
    }
  };

  const formDisabled = saving;

  let saveButtonLabel: string;
  if (saving) {
    saveButtonLabel = "Saving…";
  } else if (uploading) {
    saveButtonLabel = "Uploading…";
  } else {
    saveButtonLabel = "Save branding";
  }

  return (
    <Card
      title="Organisation branding"
      footer={
        <div className="foot-actions">
          <Button
            variant="secondary"
            disabled={!loadedOk || formDisabled || uploading}
            onClick={handleReset}
          >
            Reset to saved
          </Button>
          <Button
            variant="primary"
            disabled={!loadedOk || formDisabled || uploading}
            onClick={() => void handleSave()}
          >
            {saveButtonLabel}
          </Button>
        </div>
      }
    >
      <p className="at-hint branding-scope-hint">
        Name and logo shown on tickets and emails for every event in this organisation. This is the
        primary place to manage your logo after completing the setup wizard.
      </p>
      {loading && <p>Loading organisation branding…</p>}
      {loadError && !loading && (
        <p className="text-error" role="alert">
          {loadError}{" "}
          <button type="button" className="settings-retry-link" onClick={() => void loadBranding()}>
            Retry
          </button>
        </p>
      )}
      {loadedOk && (
        <div className="branding-form">
          <Input
            label="Organisation name"
            value={draft.org_name ?? ""}
            disabled={formDisabled}
            placeholder="e.g. Acme Corp"
            error={nameError ?? undefined}
            hint="Used as fallback when no logo is set. Shown in the ticket header."
            onChange={(e) => setDraft((prev) => ({ ...prev, org_name: e.target.value }))}
          />
          <LogoUploadZone
            value={draft.logo_url ?? ""}
            disabled={formDisabled}
            onChange={(url) => setDraft((prev) => ({ ...prev, logo_url: url }))}
            onUploadingChange={setUploading}
          />
        </div>
      )}
    </Card>
  );
}
