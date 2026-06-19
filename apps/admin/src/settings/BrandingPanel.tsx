import { useCallback, useEffect, useRef, useState } from "react";
import { applyThemeVars, Badge, Button, Card, Input } from "@admitto/ui";
import { ApiError, fetchStaffTheme, saveStaffTheme } from "../api/client.js";
import type { BrandingThemeDto } from "../api/types.js";
import {
  brandingDraftForSave,
  primaryForColorInput,
  validateBrandingDraft,
} from "./brandingValidation.js";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** Superadmin branding editor with live theme preview and anti-lockout guards. */
export function BrandingPanel() {
  const [draft, setDraft] = useState<BrandingThemeDto>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedRef = useRef<BrandingThemeDto>({});

  const loadTheme = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { theme } = await fetchStaffTheme();
      savedRef.current = theme;
      setDraft(theme);
      setFieldErrors({});
    } catch {
      setLoadError(
        "Failed to load branding settings. Showing defaults — try again or save to reset.",
      );
      savedRef.current = {};
      setDraft({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTheme();
  }, [loadTheme]);

  useEffect(() => {
    applyThemeVars(draft);
  }, [draft]);

  useEffect(() => {
    return () => {
      applyThemeVars(savedRef.current);
    };
  }, []);

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
    setDraft(savedRef.current);
    setFieldErrors({});
    setSaveMessage(null);
    setSaveError(null);
  };

  const handleSave = async () => {
    const validation = validateBrandingDraft(draft);
    if (!validation.valid) {
      setFieldErrors(validation.errors as Record<string, string>);
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
      applyThemeVars(response.theme);
      setSaveMessage("Branding saved.");
      window.setTimeout(() => setSaveMessage(null), 2000);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save branding.");
    } finally {
      setSaving(false);
    }
  };

  const colorValue = primaryForColorInput(draft.primary);
  const displayHex = draft.primary && HEX_RE.test(draft.primary) ? draft.primary : "";

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
          <Button variant="secondary" disabled={loading || saving} onClick={handleReset}>
            Reset to saved
          </Button>
          <Button variant="primary" disabled={loading || saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save branding"}
          </Button>
        </div>
      }
    >
      {loading && <p>Loading branding…</p>}
      {loadError && (
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
      <div className="branding-form">
        <div className="branding-form__row">
          <label className="at-label" htmlFor="branding-primary-picker">
            Primary colour
          </label>
          <div className="branding-form__color">
            <input
              id="branding-primary-picker"
              type="color"
              value={colorValue}
              disabled={loading || saving}
              onChange={(e) => handleColorPickerChange(e.target.value)}
              aria-label="Primary colour picker"
            />
            <Input
              label="Hex value"
              value={displayHex}
              disabled={loading || saving}
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
          disabled={loading || saving}
          placeholder="e.g. Acme Sans"
          error={fieldErrors.font_family_name}
          hint="Used with the font URL below for @font-face injection."
          onChange={(e) => updateDraft({ font_family_name: e.target.value || undefined })}
        />

        <Input
          label="Font URL"
          value={draft.font_family_url ?? ""}
          disabled={loading || saving}
          placeholder="https://cdn.example.com/fonts/brand.woff2"
          error={fieldErrors.font_family_url}
          hint="HTTPS only. Provide both name and URL, or leave both empty."
          onChange={(e) => updateDraft({ font_family_url: e.target.value || undefined })}
        />

        <div className="branding-preview">
          <span className="overline">Live preview</span>
          <div className="branding-preview__swatch" style={{ background: "var(--primary)" }}>
            <span>Primary</span>
            <span>{displayHex || "default"}</span>
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
    </Card>
  );
}
