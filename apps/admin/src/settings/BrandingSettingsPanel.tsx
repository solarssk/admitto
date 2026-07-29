import { useCallback, useEffect, useRef, useState } from "react";
import { applyThemeVars, Button, Card, IconButton, Input, useToast } from "@admitto/ui";
import { fetchOrgBranding, fetchStaffTheme, patchOrgBranding, saveStaffTheme } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { BrandingCustomFontFamilyDto, BrandingThemeDto, SetupOrgBrandingDto } from "../api/types.js";
import { LogoUploadZone } from "../components/LogoUploadZone.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { safeBrandingLogoHref } from "../utils/safeBrandingLogoHref.js";
import {
  brandingDraftForSave,
  isValidHex,
  primaryForColorInput,
  validateBrandingDraft,
  type BrandingFieldErrors,
} from "./brandingValidation.js";
import { FontFamilyModal, styleLabel } from "./FontFamilyModal.js";

const EMPTY_ORG_DRAFT: SetupOrgBrandingDto = { org_name: "", logo_url: "" };
const EMPTY_THEME_DRAFT: BrandingThemeDto = {};

const THEME_COLORS = [
  { key: "blue", hex: "#066fd1", label: "Admitto blue" },
  { key: "indigo", hex: "#4f46e5", label: "Indigo" },
  { key: "violet", hex: "#7c3aed", label: "Violet" },
  { key: "purple", hex: "#9333ea", label: "Purple" },
  { key: "pink", hex: "#db2777", label: "Pink" },
  { key: "red", hex: "#dc2626", label: "Red" },
  { key: "orange", hex: "#ea580c", label: "Orange" },
  { key: "amber", hex: "#d97706", label: "Amber" },
  { key: "green", hex: "#16a34a", label: "Green" },
  { key: "teal", hex: "#0d9488", label: "Teal" },
  { key: "cyan", hex: "#0891b2", label: "Cyan" },
  { key: "slate", hex: "#475569", label: "Slate" },
] as const;

const FULL_STYLE_SET = ["Regular", "Italic", "Bold", "Bold italic"];
const NO_ITALIC_STYLE_SET = ["Regular", "Bold"];

// Self-hosted (@fontsource, see packages/ui/src/styles/tokens/fonts.css) so every one renders
// identically for every visitor regardless of what's installed on their own OS - none of these
// are real "web-safe" OS fonts, incl. the default (Inter). "styles" lists only what's genuinely
// backed by a real @font-face - Manrope and Space Grotesk ship no italic at all on Google Fonts,
// so the picker says so honestly instead of claiming a browser-synthesized fake is real.
const FONT_OPTIONS = [
  { key: "default", label: "Admitto Sans", hint: "Default", name: undefined, previewStack: "var(--font-sans)", styles: FULL_STYLE_SET },
  { key: "manrope", label: "Manrope", hint: "Modern sans", name: "Manrope", previewStack: '"Manrope", sans-serif', styles: NO_ITALIC_STYLE_SET },
  { key: "space-grotesk", label: "Space Grotesk", hint: "Geometric sans", name: "Space Grotesk", previewStack: '"Space Grotesk", sans-serif', styles: NO_ITALIC_STYLE_SET },
  { key: "ibm-plex-sans", label: "IBM Plex Sans", hint: "Corporate sans", name: "IBM Plex Sans", previewStack: '"IBM Plex Sans", sans-serif', styles: FULL_STYLE_SET },
] as const;

function darken(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.max(0, (n >> 16) - amount);
  const g = Math.max(0, ((n >> 8) & 0xff) - amount);
  const b = Math.max(0, (n & 0xff) - amount);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

type ColorMode = "palette" | "custom";

interface ColorPaletteFieldProps {
  readonly mode: ColorMode;
  readonly colorKey: string;
  readonly customHex: string;
  readonly disabled: boolean;
  readonly onPick: (key: string, hex: string) => void;
  readonly onCustomChange: (hex: string) => void;
}

/** 12-color curated palette + a custom picker tile, replacing a bare hex input box. */
function ColorPaletteField({
  mode,
  colorKey,
  customHex,
  disabled,
  onPick,
  onCustomChange,
}: Readonly<ColorPaletteFieldProps>) {
  return (
    <div className="theme-swatch-grid">
      {THEME_COLORS.map((c) => {
        const active = mode === "palette" && colorKey === c.key;
        return (
          <button
            key={c.key}
            type="button"
            className={`theme-swatch${active ? " theme-swatch--active" : ""}`}
            style={{ background: c.hex }}
            title={c.label}
            aria-label={c.label}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onPick(c.key, c.hex)}
          >
            {active && <i className="ti ti-check" aria-hidden="true" />}
          </button>
        );
      })}
      <label
        className={`theme-swatch theme-swatch--custom${mode === "custom" ? " theme-swatch--active" : ""}`}
        style={mode === "custom" ? { background: customHex } : undefined}
        title="Custom colour"
      >
        {mode === "custom" ? (
          <i className="ti ti-check" aria-hidden="true" />
        ) : (
          <i className="ti ti-color-picker" aria-hidden="true" />
        )}
        <input
          type="color"
          value={isValidHex(customHex) ? customHex : "#066fd1"}
          disabled={disabled}
          aria-label="Custom colour picker"
          className="theme-swatch__color-input"
          onChange={(e) => onCustomChange(e.target.value)}
        />
      </label>
    </div>
  );
}

/** Small "N styles" pill — click reveals the exact list in a popover instead of inlining chips
 * into the card (keeps every font tile the same height). */
function FontStylesPill({ styles, active }: Readonly<{ styles: readonly string[]; active: boolean }>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="font-styles-pill-wrap" ref={ref}>
      <button
        type="button"
        className={`font-styles-pill${active ? " font-styles-pill--active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {styles.length} style{styles.length === 1 ? "" : "s"} <i className="ti ti-chevron-down" aria-hidden="true" />
      </button>
      {open && (
        <div className="font-styles-popover" role="menu" onClick={(e) => e.stopPropagation()}>
          {styles.map((s) => (
            <span key={s} className="font-styles-popover__item">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface FontPickerFieldProps {
  readonly activeName: string | undefined;
  readonly customFamilies: readonly BrandingCustomFontFamilyDto[];
  readonly disabled: boolean;
  readonly onPickBuiltIn: (name: string | undefined) => void;
  readonly onSelectCustom: (name: string) => void;
  readonly onDeleteCustom: (name: string) => void;
  readonly onOpenFamilyModal: () => void;
}

/** 4 built-in fonts (each shown rendered in itself) + every saved custom family + a tile that
 * opens the font-family upload modal to add another custom brand font. */
function FontPickerField({
  activeName,
  customFamilies,
  disabled,
  onPickBuiltIn,
  onSelectCustom,
  onDeleteCustom,
  onOpenFamilyModal,
}: Readonly<FontPickerFieldProps>) {
  return (
    <div className="font-option-grid">
      {FONT_OPTIONS.map((f) => (
        <button
          key={f.key}
          type="button"
          className={`font-option-card${activeName === f.name ? " font-option-card--active" : ""}`}
          disabled={disabled}
          onClick={() => onPickBuiltIn(f.name)}
        >
          <span className="font-option-card__sample" style={{ fontFamily: f.previewStack }}>
            Aa
          </span>
          <span className="font-option-card__label">{f.label}</span>
          <span className="font-option-card__hint">{f.hint}</span>
          <FontStylesPill styles={f.styles} active={activeName === f.name} />
        </button>
      ))}
      {customFamilies.map((fam) => {
        const active = activeName === fam.name;
        return (
          <div key={fam.name} className={`font-option-card font-option-card--custom${active ? " font-option-card--active" : ""}`}>
            <button
              type="button"
              className="font-option-card__select"
              disabled={disabled}
              onClick={() => onSelectCustom(fam.name)}
            >
              <span className="font-option-card__sample" style={{ fontFamily: `"${fam.name}"`, fontSize: 22 }}>
                Aa
              </span>
              <span className="font-option-card__label">{fam.name}</span>
              <span className="font-option-card__hint">Custom</span>
            </button>
            <FontStylesPill styles={fam.variants.map((v) => styleLabel(v.weight, v.style))} active={active} />
            <IconButton
              icon={<i className="ti ti-trash" aria-hidden="true" />}
              label={`Remove ${fam.name}`}
              size="sm"
              className="font-option-card__remove"
              disabled={disabled}
              onClick={() => onDeleteCustom(fam.name)}
            />
          </div>
        );
      })}
      <button type="button" className="font-option-card font-option-card--upload" disabled={disabled} onClick={onOpenFamilyModal}>
        <i className="ti ti-upload font-option-card__uploadicon" aria-hidden="true" />
        <span className="font-option-card__label">Custom font</span>
        <span className="font-option-card__hint">Upload files</span>
      </button>
    </div>
  );
}

/** Combined Organisation branding (name/logo) + Theme (colour/font) settings, one shared
 * Save/Reset pair — replaces the two separately-footed cards previously split across the
 * General tab. Superadmin only (route-gated by SettingsLayout's SuperadminGuard). */
export function BrandingSettingsPanel() {
  const { addToast } = useToast();

  const [orgDraft, setOrgDraft] = useState<SetupOrgBrandingDto>(EMPTY_ORG_DRAFT);
  const [themeDraft, setThemeDraft] = useState<BrandingThemeDto>(EMPTY_THEME_DRAFT);
  const orgSavedRef = useRef<SetupOrgBrandingDto>(EMPTY_ORG_DRAFT);
  const themeSavedRef = useRef<BrandingThemeDto>(EMPTY_THEME_DRAFT);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOk, setLoadedOk] = useState(false);
  const loadAbortRef = useRef<AbortController | null>(null);

  const [orgNameError, setOrgNameError] = useState<string | null>(null);
  const [themeFieldErrors, setThemeFieldErrors] = useState<BrandingFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  // UI-only colour presentation state, derived from themeDraft on load/reset - see
  // syncColorUiState. Font state needs no equivalent - which tile is "active" is always just
  // derived directly from themeDraft.font_family_name/custom_font_families below.
  const [colorMode, setColorMode] = useState<ColorMode>("palette");
  const [colorKey, setColorKey] = useState<string>("blue");
  const [customHex, setCustomHex] = useState("#066fd1");
  const [familyModalOpen, setFamilyModalOpen] = useState(false);

  const syncColorUiState = useCallback((theme: BrandingThemeDto) => {
    const primary = theme.primary;
    const paletteMatch = primary && THEME_COLORS.find((c) => c.hex.toLowerCase() === primary.toLowerCase());
    if (paletteMatch) {
      setColorMode("palette");
      setColorKey(paletteMatch.key);
    } else if (primary && isValidHex(primary)) {
      setColorMode("custom");
      setCustomHex(primary);
    } else {
      setColorMode("palette");
      setColorKey("blue");
    }
  }, []);

  const load = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    const { signal } = ac;

    setLoading(true);
    setLoadError(null);
    setLoadedOk(false);
    try {
      const [org, { theme }] = await Promise.all([
        fetchOrgBranding(signal),
        fetchStaffTheme(signal),
      ]);
      if (signal.aborted) return;
      orgSavedRef.current = org;
      themeSavedRef.current = theme;
      setOrgDraft(org);
      setThemeDraft(theme);
      syncColorUiState(theme);
      setOrgNameError(null);
      setThemeFieldErrors({});
      setLoadedOk(true);
    } catch {
      if (signal.aborted) return;
      setLoadError("Failed to load branding settings. Use Retry to reload.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [syncColorUiState]);

  useEffect(() => {
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  // Live preview across the whole staff app while this panel is open, matching the previous
  // BrandingPanel's own behaviour - reverts to the saved theme on unmount.
  useEffect(() => {
    if (!loadedOk) return;
    applyThemeVars(themeDraft);
  }, [themeDraft, loadedOk]);
  useEffect(() => {
    return () => {
      if (loadedOk) applyThemeVars(themeSavedRef.current);
    };
  }, [loadedOk]);

  // Every saved custom family gets a real local FontFace preview, not just the active one -
  // applyThemeVars/resolveThemeVars only ever emit @font-face for whichever family is currently
  // active (the only one that actually ships to visitors), so without this, every other saved-
  // but-not-selected family's own "Aa" sample would silently fall back to a generic font instead
  // of showing what was actually uploaded.
  const customFamiliesKey = JSON.stringify(themeDraft.custom_font_families ?? []);
  useEffect(() => {
    const families = themeDraft.custom_font_families ?? [];
    const registered: FontFace[] = [];
    for (const family of families) {
      for (const variant of family.variants) {
        const face = new FontFace(family.name, `url("${variant.url}")`, {
          weight: String(variant.weight),
          style: variant.style,
        });
        document.fonts.add(face);
        registered.push(face);
        void face.load().catch(() => {
          // A broken/unreachable file just keeps showing the fallback sample - preview only,
          // never blocks saving.
        });
      }
    }
    return () => {
      for (const face of registered) document.fonts.delete(face);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on customFamiliesKey (a
    // content fingerprint), not themeDraft.custom_font_families itself, which is a fresh array
    // every render and would re-register every FontFace on every unrelated keystroke in the form.
  }, [customFamiliesKey]);

  const handlePickColor = (key: string, hex: string) => {
    setColorMode("palette");
    setColorKey(key);
    setThemeDraft((prev) => ({ ...prev, primary: hex }));
  };

  const handleCustomColorChange = (hex: string) => {
    setColorMode("custom");
    setCustomHex(hex);
    setThemeDraft((prev) => ({ ...prev, primary: hex }));
  };

  /** Picking a built-in font only ever changes the *active* pick - the saved custom-font library
   * (custom_font_families) is untouched, so switching back to a custom family later needs no
   * re-upload. */
  const handlePickBuiltInFont = (name: string | undefined) => {
    setThemeDraft((prev) => ({ ...prev, font_family_name: name }));
  };

  const handleSelectCustomFamily = (name: string) => {
    setThemeDraft((prev) => ({ ...prev, font_family_name: name }));
  };

  /** Saving a family upserts it into the library by name (so re-saving under an existing name
   * replaces that entry rather than duplicating it) and makes it the active pick. */
  const handleFamilySaved = ({ familyName, variants }: { familyName: string; variants: BrandingCustomFontFamilyDto["variants"] }) => {
    setThemeDraft((prev) => {
      const withoutSameName = (prev.custom_font_families ?? []).filter((f) => f.name !== familyName);
      return {
        ...prev,
        font_family_name: familyName,
        custom_font_families: [...withoutSameName, { name: familyName, variants }],
      };
    });
    setFamilyModalOpen(false);
    addToast(`Saved "${familyName}" with ${variants.length} variant${variants.length === 1 ? "" : "s"}.`, "success");
  };

  /** Removing a family that's currently active falls back to the default built-in font, since
   * its @font-face source is gone. A family that's merely saved (not active) can be removed with
   * no other effect. */
  const handleDeleteCustomFamily = (name: string) => {
    setThemeDraft((prev) => {
      const remaining = (prev.custom_font_families ?? []).filter((f) => f.name !== name);
      const wasActive = prev.font_family_name === name;
      return {
        ...prev,
        font_family_name: wasActive ? undefined : prev.font_family_name,
        custom_font_families: remaining.length > 0 ? remaining : undefined,
      };
    });
  };

  /** Restores the Theme card's draft to Admitto's own factory defaults (blue, Admitto Sans) -
   * distinct from handleReset, which discards unsaved edits back to whatever is currently
   * *saved*. Only updates the draft; Save still needs a separate click, same as picking a
   * palette swatch or font tile. Doesn't touch organisation name/logo (no meaningful factory
   * default) or the saved custom-font library (not a "look" setting - deleting fonts is its own
   * explicit action, not a side effect of resetting colour/font choice). */
  const handleRestoreThemeDefaults = () => {
    setColorMode("palette");
    setColorKey("blue");
    setThemeDraft((prev) => ({
      ...prev,
      primary: undefined,
      font_family_name: undefined,
    }));
  };

  const handleReset = () => {
    if (!loadedOk) return;
    setOrgDraft(orgSavedRef.current);
    setThemeDraft(themeSavedRef.current);
    syncColorUiState(themeSavedRef.current);
    setOrgNameError(null);
    setThemeFieldErrors({});
  };

  const handleSave = async () => {
    if (!loadedOk) return;
    const name = (orgDraft.org_name ?? "").trim();
    if (!name) {
      setOrgNameError("Organisation name is required.");
      return;
    }
    const logo = (orgDraft.logo_url ?? "").trim();
    if (logo && !safeBrandingLogoHref(logo)) {
      addToast("Logo must be a valid HTTPS URL or uploaded image.", "error");
      return;
    }
    const themeValidation = validateBrandingDraft(themeDraft);
    if (!themeValidation.valid) {
      setThemeFieldErrors(themeValidation.errors);
      return;
    }
    setOrgNameError(null);
    setThemeFieldErrors({});
    setSaving(true);
    try {
      const [orgResult, themeResult] = await Promise.allSettled([
        patchOrgBranding({ org_name: name, logo_url: logo || null }),
        saveStaffTheme(brandingDraftForSave(themeDraft)),
      ]);

      if (orgResult.status === "fulfilled") {
        orgSavedRef.current = orgResult.value;
        setOrgDraft(orgResult.value);
      }
      if (themeResult.status === "fulfilled") {
        themeSavedRef.current = themeResult.value.theme;
        setThemeDraft(themeResult.value.theme);
        syncColorUiState(themeResult.value.theme);
      }

      if (orgResult.status === "fulfilled" && themeResult.status === "fulfilled") {
        addToast("Branding saved.", "success");
      } else if (orgResult.status === "rejected" && themeResult.status === "rejected") {
        addToast("Failed to save branding.", "error");
      } else if (orgResult.status === "rejected") {
        addToast(
          operatorApiErrorMessage(orgResult.reason, "Part of your branding failed to save - the rest was saved."),
          "error",
        );
      } else if (themeResult.status === "rejected") {
        addToast(
          operatorApiErrorMessage(themeResult.reason, "Part of your branding failed to save - the rest was saved."),
          "error",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const hasUnsavedChanges =
    JSON.stringify(orgDraft) !== JSON.stringify(orgSavedRef.current) ||
    JSON.stringify(themeDraft) !== JSON.stringify(themeSavedRef.current);

  const showLoading = useDelayedLoading(loading);
  const activeHex = colorMode === "custom" ? (isValidHex(customHex) ? customHex : "#066fd1") : primaryForColorInput(
    THEME_COLORS.find((c) => c.key === colorKey)?.hex,
  );
  const activeFontStack = themeDraft.font_family_name
    ? `"${themeDraft.font_family_name}", Inter, system-ui, sans-serif`
    : "var(--font-sans)";
  const customFamilies = themeDraft.custom_font_families ?? [];
  const activeCustomFamily = customFamilies.find((f) => f.name === themeDraft.font_family_name);
  const hasBoldVariant = !activeCustomFamily || activeCustomFamily.variants.some((v) => v.weight >= 700);
  const hasItalicVariant = !activeCustomFamily || activeCustomFamily.variants.some((v) => v.style === "italic");

  if (loading) {
    return showLoading ? (
      <Card title="Organisation branding">
        <p>Loading branding settings…</p>
      </Card>
    ) : null;
  }

  if (loadError || !loadedOk) {
    return (
      <Card title="Organisation branding">
        <p className="text-error" role="alert">
          {loadError ?? "Failed to load branding settings."}{" "}
          <button type="button" className="settings-retry-link" onClick={() => void load()}>
            Retry
          </button>
        </p>
      </Card>
    );
  }

  const formDisabled = saving;

  return (
    <>
      <Card title="Organisation branding">
        <p className="at-hint branding-scope-hint">Shown on the public ticket page and emails.</p>
        <div className="branding-form">
          <Input
            label="Organisation name"
            value={orgDraft.org_name ?? ""}
            disabled={formDisabled}
            placeholder="e.g. Acme Corp"
            error={orgNameError ?? undefined}
            hint="Used as fallback when no logo is set. Shown in the ticket header."
            onChange={(e) => setOrgDraft((prev) => ({ ...prev, org_name: e.target.value }))}
          />
          <LogoUploadZone
            value={orgDraft.logo_url ?? ""}
            disabled={formDisabled}
            onChange={(url) => setOrgDraft((prev) => ({ ...prev, logo_url: url }))}
            onUploadingChange={setLogoUploading}
          />
        </div>
      </Card>

      <Card
        title="Theme"
        actions={
          <Button variant="ghost" size="sm" disabled={formDisabled} onClick={handleRestoreThemeDefaults}>
            Restore defaults
          </Button>
        }
      >
        <p className="at-hint branding-scope-hint">
          Instance-wide accent colour and font for staff UI and public ticket pages. Ticket logos
          are set in Organisation branding above, not here.
        </p>
        <span className="at-label" id="branding-primary-label">
          Primary colour
        </span>
        <div aria-labelledby="branding-primary-label">
          <ColorPaletteField
            mode={colorMode}
            colorKey={colorKey}
            customHex={customHex}
            disabled={formDisabled}
            onPick={handlePickColor}
            onCustomChange={handleCustomColorChange}
          />
        </div>
        {themeFieldErrors.primary && (
          <p className="text-error" role="alert">
            {themeFieldErrors.primary}
          </p>
        )}
        <p className="at-hint" style={{ marginTop: 8 }}>
          {colorMode === "custom" ? (
            <>
              Custom colour: <code>{customHex}</code>
            </>
          ) : (
            `${THEME_COLORS.find((c) => c.key === colorKey)?.label ?? "Admitto blue"}. Used on buttons, links, and badges across the staff app and ticket page.`
          )}
        </p>

        <span className="at-label" id="branding-font-label" style={{ marginTop: 20, display: "block" }}>
          Font
        </span>
        <div aria-labelledby="branding-font-label">
          <FontPickerField
            activeName={themeDraft.font_family_name}
            customFamilies={customFamilies}
            disabled={formDisabled}
            onPickBuiltIn={handlePickBuiltInFont}
            onSelectCustom={handleSelectCustomFamily}
            onDeleteCustom={handleDeleteCustomFamily}
            onOpenFamilyModal={() => setFamilyModalOpen(true)}
          />
        </div>
        {themeFieldErrors.custom_font_families && (
          <p className="text-error" role="alert">
            {themeFieldErrors.custom_font_families}
          </p>
        )}
        {themeFieldErrors.font_family_name && (
          <p className="text-error" role="alert">
            {themeFieldErrors.font_family_name}
          </p>
        )}

        <FontFamilyModal open={familyModalOpen} onClose={() => setFamilyModalOpen(false)} onSaved={handleFamilySaved} />

        <div className="theme-preview">
          <span className="overline">Live preview</span>
          <div className="theme-preview__bar" style={{ background: activeHex, fontFamily: activeFontStack }}>
            <span>Primary</span>
            <span>{colorMode === "custom" ? customHex : "default"}</span>
          </div>
          <div className="theme-preview__row">
            <div
              className="theme-preview__bar theme-preview__bar--sm"
              style={{ background: darken(activeHex, 24), fontFamily: activeFontStack }}
            >
              hover
            </div>
            <div
              className="theme-preview__tint"
              style={{ background: `${activeHex}1a`, color: activeHex, fontFamily: activeFontStack }}
            >
              Tint
            </div>
          </div>
          <div className="theme-preview__controls">
            <button type="button" className="theme-preview__btn" style={{ background: activeHex, fontFamily: activeFontStack }}>
              Primary action
            </button>
            <button
              type="button"
              className="theme-preview__btn theme-preview__btn--outline"
              style={{ fontFamily: activeFontStack }}
            >
              Secondary
            </button>
            <span className="theme-preview__badge" style={{ fontFamily: activeFontStack }}>
              Neutral badge
            </span>
          </div>
          <p className="theme-preview__sample" style={{ fontFamily: activeFontStack }}>
            The quick brown fox jumps over the lazy dog.
          </p>
          <div className="theme-preview__variants">
            <span style={{ fontFamily: activeFontStack, fontWeight: 400 }}>Regular Aa</span>
            <span style={{ fontFamily: activeFontStack, fontWeight: 700 }}>
              Bold Aa
              {!hasBoldVariant && (
                <i
                  className="ti ti-info-circle theme-preview__faux"
                  aria-hidden="true"
                  title="No bold file uploaded. The browser is faking it."
                />
              )}
            </span>
            <span style={{ fontFamily: activeFontStack, fontStyle: "italic" }}>
              Italic Aa
              {!hasItalicVariant && (
                <i
                  className="ti ti-info-circle theme-preview__faux"
                  aria-hidden="true"
                  title="No italic file uploaded. The browser is faking it."
                />
              )}
            </span>
          </div>
        </div>
      </Card>

      <div className="settings-footer">
        <div className="settings-footer__status">
          {hasUnsavedChanges && (
            <span className="settings-footer__save-state">
              <i className="ti ti-alert-triangle" aria-hidden="true" /> Unsaved changes
            </span>
          )}
        </div>
        <div className="settings-footer__buttons">
          <Button
            variant="secondary"
            disabled={!loadedOk || formDisabled || logoUploading}
            onClick={handleReset}
          >
            Reset to saved
          </Button>
          <Button
            variant="primary"
            disabled={!loadedOk || formDisabled || logoUploading}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </>
  );
}
