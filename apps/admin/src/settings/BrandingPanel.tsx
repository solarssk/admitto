import { useCallback, useEffect, useRef, useState } from "react";
import { applyThemeVars, Badge, Button, Card, Input } from "@admitto/ui";
import { ApiError, fetchStaffTheme, saveStaffTheme } from "../api/client.js";
import type { BrandingThemeDto } from "../api/types.js";
import {
  brandingDraftForSave,
  type BrandingFieldErrors,
  isValidHex,
  primaryForColorInput,
  validateBrandingDraft,
} from "./brandingValidation.js";

/** Superadmin branding editor with live theme preview and anti-lockout guards. */
export function BrandingPanel() {
  const [draft, setDraft] = useState<BrandingThemeDto>({});
  const [loading, setLoading] = useState(true);
  const [loadedOk, setLoadedOk] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<BrandingFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedRef = useRef<BrandingThemeDto>({});
  const loadAbortRef = useRef<AbortController | null>(null);

  const loadTheme = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    const { signal } = ac;

    setLoading(true);
    setLoadError(null);
    setLoadedOk(false);
    try {
      const { theme } = await fetchStaffTheme(signal);
      if (signal.aborted) return;
      savedRef.current = theme;
      setDraft(theme);
      setFieldErrors({});
      setLoadedOk(true);
    } catch {
      if (signal.aborted) return;
      setLoadError("Failed to load branding settings. Use Retry to reload.");
      setDraft({});
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTheme();
    return () => loadAbortRef.current?.abort();
  }, [loadTheme]);

  useEffect(() => {
    if (!loadedOk) return;
    applyThemeVars(draft);
  }, [draft, loadedOk]);

  useEffect(() => {
    return () => {
      if (loadedOk) {
        applyThemeVars(savedRef.current);
      }
    };
  }, [loadedOk]);

  useEffect(() => {
    if (!saveMessage) return;
    const id = window.setTimeout(() => setSaveMessage(null), 2000);
    return () => clearTimeout(id);
  }, [saveMessage]);

  const updateDraft = (patch: Partial<BrandingThemeDto>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setSaveMessage(null);
    setSaveError(null);
  };

  const handlePrimaryHexChange = (value: string) => {
    updateDraft({ primary: value || undefined });
  };

  const handleColorPickerChange = (value: string) => {
    updateDraft({ primary: value });
  };

  const handleReset = () => {
    if (!loadedOk) return;
    setDraft(savedRef.current);
    setFieldErrors({});
    setSaveMessage(null);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!loadedOk || loadError) return;
    const validation = validateBrandingDraft(draft);
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const body = brandingDraftForSave(draft);
      const response = await saveStaffTheme(body);
      savedRef.current = response.theme;
      setDraft(response.theme);
      setSaveMessage("Branding saved.");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save branding.");
    } finally {
      setSaving(false);
    }
  };

  const formDisabled = saving;
  const colorValue = primaryForColorInput(draft.primary);
  const displayHex = draft.primary ?? "";
  const previewLabel =
    displayHex && isValidHex(displayHex) ? displayHex : displayHex ? "invalid" : "default";

  return (
    <Card
      title="Branding"
      footer={
        <div className="foot-actions">
          {saveMessage && (
            <span className="settings-save-hint" role="status">
              {saveMessage}
            </span>
          )}
          <Button variant="secondary" disabled={!loadedOk || formDisabled} onClick={handleReset}>
            Reset to saved
          </Button>
          <Button
            variant="primary"
            disabled={!loadedOk || formDisabled}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save branding"}
          </Button>
        </div>
      }
    >
      <p className="at-hint branding-scope-hint">
        Instance-wide accent colour and custom font for staff UI and public ticket pages. Ticket logos
        are configured per organization, not here.
      </p>
      {loading && <p>Loading branding…</p>}
      {loadError && !loading && (
        <p className="text-error" role="alert">
          {loadError}{" "}
          <button type="button" className="settings-retry-link" onClick={() => void loadTheme()}>
            Retry
          </button>
        </p>
      )}
      {saveError && (
        <p className="text-error" role="alert">
          {saveError}
        </p>
      )}
      {loadedOk && (
        <div className="branding-form">
          <div className="branding-form__row">
            <span className="at-label" id="branding-primary-label">
              Primary colour
            </span>
            <div className="branding-form__color" aria-labelledby="branding-primary-label">
              <input
                type="color"
                value={colorValue}
                disabled={formDisabled}
                onChange={(e) => handleColorPickerChange(e.target.value)}
                aria-label="Primary colour picker"
              />
              <Input
                id="branding-primary-hex"
                label="Hex value"
                value={displayHex}
                disabled={formDisabled}
                placeholder="#066fd1"
                error={fieldErrors.primary}
                onChange={(e) => handlePrimaryHexChange(e.target.value)}
              />
            </div>
            <span className="at-hint">Leave empty to use the default Admitto blue.</span>
          </div>

          <Input
            label="Font family name"
            value={draft.font_family_name ?? ""}
            disabled={formDisabled}
            placeholder="e.g. Acme Sans"
            error={fieldErrors.font_family_name}
            hint="Used with the font URL below for @font-face injection."
            onChange={(e) => updateDraft({ font_family_name: e.target.value || undefined })}
          />

          <Input
            label="Font URL"
            value={draft.font_family_url ?? ""}
            disabled={formDisabled}
            placeholder="https://cdn.example.com/fonts/brand.woff2"
            error={fieldErrors.font_family_url}
            hint="HTTPS only. Provide both name and URL, or leave both empty."
            onChange={(e) => updateDraft({ font_family_url: e.target.value || undefined })}
          />

          <div className="branding-preview">
            <span className="overline">Live preview</span>
            <div className="branding-preview__swatch" style={{ background: "var(--primary)" }}>
              <span>Primary</span>
              <span>{previewLabel}</span>
            </div>
            <div className="branding-preview__tokens">
              <span className="branding-preview__token" style={{ background: "var(--primary-hover)" }}>
                Hover
              </span>
              <span className="branding-preview__token" style={{ background: "var(--primary-tint)" }}>
                Tint
              </span>
            </div>
            <div className="branding-preview__components">
              <Button variant="primary" type="button">
                Primary action
              </Button>
              <Button variant="secondary" type="button">
                Secondary
              </Button>
              <Badge variant="neutral">Neutral badge</Badge>
            </div>
            <p className="branding-preview__sample" style={{ fontFamily: "var(--font-sans, inherit)" }}>
              Sample text with the configured font family.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
