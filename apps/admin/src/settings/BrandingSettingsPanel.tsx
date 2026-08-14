import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyThemeVars,
  Button,
  Card,
  DEFAULT_BRANDING_FONT_FAMILY_NAME,
  EmptyState,
  HintLabel,
  IconButton,
  Input,
  Select,
  useToast,
} from "@admitto/ui";
import { fetchOrgBranding, fetchStaffTheme, patchOrgBranding, saveStaffTheme, deleteUploadedFile } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { BrandingCustomFontFamilyDto, BrandingThemeDto, SetupOrgBrandingDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { LogoUploadZone } from "../components/LogoUploadZone.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
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

const EMPTY_ORG_DRAFT: SetupOrgBrandingDto = {
  org_name: "",
  logo_url: null,
  logo_original_url: null,
  logo_crop: null,
};
const EMPTY_THEME_DRAFT: BrandingThemeDto = {};

/** Collect `/uploads/…` font file URLs from a theme draft. */
function themeFontUploadUrls(theme: BrandingThemeDto): Set<string> {
  const urls = new Set<string>();
  for (const fam of theme.custom_font_families ?? []) {
    for (const v of fam.variants) {
      if (v.url.startsWith("/uploads/")) urls.add(v.url);
    }
  }
  return urls;
}

const ORG_BRANDING_HINT =
  "A single event can override the logo under Event settings → Images.";
const ORG_BRANDING_INTRO =
  "Name and logo used as the default on tickets and email headers.";
const THEME_HINT =
  "Ticket logos are set in Organisation branding above, not here.";
const THEME_INTRO =
  "Accent colour and fonts for the staff app and public ticket page.";

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

// Mirrors packages/auth's MAX_CUSTOM_FAMILIES - the server drops any family past this count
// rather than persisting it, so the picker has to stop offering "Custom font" at the same limit
// instead of letting someone upload a family that then silently never gets saved.
const MAX_CUSTOM_FONT_FAMILIES = 8;

// `.at-select` defaults to width: 100%, which inside a `.settings-row` flex row would fight the
// label/hint block on the left for space instead of sitting as a compact, right-aligned control -
// `width: auto` overrides that (inline styles win over the class), `flexShrink: 0` stops the row's
// own flex algorithm from squeezing it, and `minWidth` keeps all three rows' controls a consistent
// size regardless of which option happens to be selected.
const FONT_SURFACE_SELECT_STYLE = { width: "auto", minWidth: 160, flexShrink: 0 } as const;

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

/** Small "N styles" pill - click reveals the exact list in a popover instead of inlining chips
 * into the card (keeps every font tile the same height). */
function FontStylesPill({ styles }: Readonly<{ styles: readonly string[] }>) {
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
        className="font-styles-pill"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {styles.length} style{styles.length === 1 ? "" : "s"} <i className="ti ti-chevron-down" aria-hidden="true" />
      </button>
      {open && (
        /* A plain list of style labels, not commands - no role="menu"/"menuitem", since that
           implies keyboard-navigable actions this popover doesn't have. */
        <div className="font-styles-popover">
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
  readonly customFamilies: readonly BrandingCustomFontFamilyDto[];
  readonly disabled: boolean;
  readonly onEditCustom: (name: string) => void;
  readonly onDeleteCustom: (name: string) => void;
  readonly onOpenFamilyModal: () => void;
}

/** 4 built-in fonts (each shown rendered in itself) + every saved custom family + a tile that
 * opens the font-family upload modal to add another custom brand font. A pure library: browse,
 * upload, edit, remove - picking which one applies to which surface happens only via the
 * Font-by-surface selects below, not by clicking a tile here, so there's exactly one mechanism
 * for "change the font" instead of two that could disagree. */
function FontPickerField({
  customFamilies,
  disabled,
  onEditCustom,
  onDeleteCustom,
  onOpenFamilyModal,
}: Readonly<FontPickerFieldProps>) {
  return (
    <div className="font-option-grid">
      {FONT_OPTIONS.map((f) => (
        <div key={f.key} className="font-option-card">
          <div className="font-option-card__select">
            <span className="font-option-card__sample" style={{ fontFamily: f.previewStack }}>
              Aa
            </span>
            <span className="font-option-card__label">{f.label}</span>
            <span className="font-option-card__hint">{f.hint}</span>
          </div>
          <FontStylesPill styles={f.styles} />
        </div>
      ))}
      {customFamilies.map((fam) => (
        <div key={fam.name} className="font-option-card font-option-card--custom">
          <div className="font-option-card__select">
            <span className="font-option-card__sample" style={{ fontFamily: `"${fam.name}"` }}>
              Aa
            </span>
            <span className="font-option-card__label">{fam.name}</span>
            <span className="font-option-card__hint">Custom</span>
          </div>
          <FontStylesPill styles={fam.variants.map((v) => styleLabel(v.weight, v.style))} />
          <IconButton
            icon={<i className="ti ti-pencil" aria-hidden="true" />}
            label={`Edit ${fam.name}`}
            size="sm"
            className="font-option-card__edit"
            disabled={disabled}
            onClick={() => onEditCustom(fam.name)}
          />
          <IconButton
            icon={<i className="ti ti-trash" aria-hidden="true" />}
            label={`Remove ${fam.name}`}
            size="sm"
            className="font-option-card__remove"
            disabled={disabled}
            onClick={() => onDeleteCustom(fam.name)}
          />
        </div>
      ))}
      {customFamilies.length < MAX_CUSTOM_FONT_FAMILIES ? (
        <button type="button" className="font-option-card font-option-card--upload" disabled={disabled} onClick={onOpenFamilyModal}>
          <i className="ti ti-upload font-option-card__uploadicon" aria-hidden="true" />
          <span className="font-option-card__label">Custom font</span>
          <span className="font-option-card__hint">Upload files</span>
        </button>
      ) : (
        <div className="font-option-card font-option-card--upload font-option-card--upload-limit">
          <i className="ti ti-lock font-option-card__uploadicon" aria-hidden="true" />
          <span className="font-option-card__label">Limit reached</span>
          <span className="font-option-card__hint">Remove one to add another</span>
        </div>
      )}
    </div>
  );
}

type FontSurface = "admin" | "ticket";

interface ResolvedFontInfo {
  readonly fontStack: string;
  readonly hasBoldVariant: boolean;
  readonly hasItalicVariant: boolean;
}

/** Derives everything the live preview needs for the active (Admin panel) font pick. */
function resolveFontInfo(
  fontFamilyName: string | undefined,
  customFamilies: readonly BrandingCustomFontFamilyDto[],
): ResolvedFontInfo {
  const activeCustomFamily = customFamilies.find((f) => f.name === fontFamilyName);
  const activeBuiltIn = FONT_OPTIONS.find((f) => f.name === fontFamilyName);
  const fontStack = fontFamilyName ? `"${fontFamilyName}", Inter, system-ui, sans-serif` : "var(--font-sans)";
  // A built-in pick without a custom family active still needs its own real styles checked -
  // Manrope/Space Grotesk have no italic file at all, so defaulting to true here (as if every
  // built-in had all four styles) would hide the "browser is faking it" hint exactly where it's
  // most needed, the same dishonesty FONT_OPTIONS.styles exists to avoid in the picker itself.
  const hasBoldVariant = activeCustomFamily
    ? activeCustomFamily.variants.some((v) => v.weight >= 700)
    : (activeBuiltIn?.styles.includes("Bold") ?? true);
  const hasItalicVariant = activeCustomFamily
    ? activeCustomFamily.variants.some((v) => v.style === "italic")
    : (activeBuiltIn?.styles.some((s) => s.toLowerCase().includes("italic")) ?? true);
  return { fontStack, hasBoldVariant, hasItalicVariant };
}

/** Combined Organisation branding (name/logo) + Theme (colour/font) settings, one shared
 * Save/Reset pair - replaces the two separately-footed cards previously split across the
 * General tab. Superadmin only (route-gated by SettingsLayout's SuperadminGuard). */
export function BrandingSettingsPanel() {
  const { addToast } = useToast();

  const [orgDraft, setOrgDraft] = useState<SetupOrgBrandingDto>(EMPTY_ORG_DRAFT);
  const [themeDraft, setThemeDraft] = useState<BrandingThemeDto>(EMPTY_THEME_DRAFT);
  const [orgCommitted, setOrgCommitted] = useState<SetupOrgBrandingDto>(EMPTY_ORG_DRAFT);
  const orgSavedRef = useRef<SetupOrgBrandingDto>(EMPTY_ORG_DRAFT);
  const themeSavedRef = useRef<BrandingThemeDto>(EMPTY_THEME_DRAFT);
  /** Font `/uploads/…` URLs added via FontFamilyModal but not yet committed by outer theme Save. */
  const provisionalFontUrlsRef = useRef(new Set<string>());

  const releaseProvisionalFontsKeeping = (keep: Set<string>) => {
    for (const url of provisionalFontUrlsRef.current) {
      if (!keep.has(url)) void deleteUploadedFile(url);
    }
    provisionalFontUrlsRef.current = new Set(
      [...provisionalFontUrlsRef.current].filter((u) => keep.has(u)),
    );
  };

  useEffect(() => {
    return () => {
      releaseProvisionalFontsKeeping(themeFontUploadUrls(themeSavedRef.current));
    };
  }, []);

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
  // Name of the saved family currently being edited, or null when the modal is creating a new
  // one. Kept separate from familyModalOpen since the modal's own prefill data (initialFamily)
  // is looked up by this name each render, not stored as a snapshot here.
  const [editingFamilyName, setEditingFamilyName] = useState<string | null>(null);
  // Name of the saved family a Remove click is asking to confirm, or null when no confirmation
  // is pending - deleting a saved family isn't undoable from here (its uploaded files stay on
  // disk but the org would need to re-upload them to use it again), so it goes through the same
  // ConfirmDialog pattern as other destructive actions instead of firing on the icon click alone.
  const [pendingDeleteFamilyName, setPendingDeleteFamilyName] = useState<string | null>(null);

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
      const normalizedOrg: SetupOrgBrandingDto = {
        org_name: org.org_name ?? "",
        logo_url: org.logo_url ?? null,
        logo_original_url: org.logo_original_url ?? null,
        logo_crop: org.logo_crop ?? null,
      };
      orgSavedRef.current = normalizedOrg;
      setOrgCommitted(normalizedOrg);
      themeSavedRef.current = theme;
      setOrgDraft(normalizedOrg);
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
    // Keyed on customFamiliesKey (a content fingerprint), not themeDraft.custom_font_families
    // itself, which is a fresh array every render and would re-register every FontFace on every
    // unrelated keystroke in the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
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

  /** Picking a font (built-in or a saved custom family, from a Font-by-surface select) only ever
   * changes the *active* pick for that one surface - the saved custom-font library
   * (custom_font_families) is untouched and shared, so switching to it later, on either surface,
   * needs no re-upload. */
  const handleSetSurfaceFont = (surface: FontSurface, name: string | undefined) => {
    setThemeDraft((prev) =>
      surface === "admin" ? { ...prev, font_family_name: name } : { ...prev, ticket_font_family_name: name },
    );
  };

  const handleOpenFamilyModal = () => {
    setFamilyModalOpen(true);
  };

  const handleEditCustomFamily = (name: string) => {
    setEditingFamilyName(name);
    setFamilyModalOpen(true);
  };

  const closeFamilyModal = () => {
    setFamilyModalOpen(false);
    setEditingFamilyName(null);
  };

  /** Saving upserts the family into the library by its (possibly new) name - re-saving under an
   * existing name replaces that entry rather than duplicating it, and renaming one mid-edit drops
   * its old name entirely rather than leaving both around. A brand new family always becomes the
   * Admin panel's active pick (the only upload entry point); editing an existing one keeps each
   * surface's own active status independently - if the same family was also active for Ticket
   * page (the common case, since ticket falls back to admin by default), renaming it keeps that
   * in sync too, not just Admin panel's. */
  const handleFamilySaved = ({ familyName, variants }: { familyName: string; variants: BrandingCustomFontFamilyDto["variants"] }) => {
    for (const v of variants) {
      if (v.url.startsWith("/uploads/")) {
        provisionalFontUrlsRef.current.add(v.url);
      }
    }
    setThemeDraft((prev) => {
      const isNewFamily = editingFamilyName === null;
      const wasAdminActive = !isNewFamily && prev.font_family_name === editingFamilyName;
      const wasTicketActive = !isNewFamily && prev.ticket_font_family_name === editingFamilyName;
      const families = prev.custom_font_families ?? [];
      const withoutOldEntry = families.filter(
        (f) => f.name !== familyName && f.name !== editingFamilyName,
      );
      const replaced = families.find(
        (f) => f.name === editingFamilyName || f.name === familyName,
      );
      if (replaced) {
        const kept = new Set(variants.map((v) => v.url));
        for (const v of replaced.variants) {
          if (
            v.url.startsWith("/uploads/") &&
            !kept.has(v.url) &&
            provisionalFontUrlsRef.current.has(v.url)
          ) {
            provisionalFontUrlsRef.current.delete(v.url);
            void deleteUploadedFile(v.url);
          }
        }
      }
      return {
        ...prev,
        font_family_name: isNewFamily || wasAdminActive ? familyName : prev.font_family_name,
        ticket_font_family_name: wasTicketActive ? familyName : prev.ticket_font_family_name,
        custom_font_families: [...withoutOldEntry, { name: familyName, variants }],
      };
    });
    closeFamilyModal();
    addToast(`Saved "${familyName}" with ${variants.length} variant${variants.length === 1 ? "" : "s"}.`, "success");
  };

  /** Removing a family that's currently active for a surface falls back that surface to its own
   * default (admin: the built-in Admitto Sans; ticket: back to following admin's own pick), each
   * checked independently since the same family can be active for both, one, or neither. A family
   * that's merely saved (not active anywhere) can be removed with no other effect. */
  const handleDeleteCustomFamily = (name: string) => {
    setThemeDraft((prev) => {
      // Remove is only offered for families already in the draft library.
      const families = prev.custom_font_families!;
      for (const fam of families) {
        if (fam.name !== name) continue;
        for (const v of fam.variants) {
          if (v.url.startsWith("/uploads/") && provisionalFontUrlsRef.current.has(v.url)) {
            provisionalFontUrlsRef.current.delete(v.url);
            void deleteUploadedFile(v.url);
          }
        }
      }
      const remaining = families.filter((f) => f.name !== name);
      const wasAdminActive = prev.font_family_name === name;
      const wasTicketActive = prev.ticket_font_family_name === name;
      return {
        ...prev,
        font_family_name: wasAdminActive ? undefined : prev.font_family_name,
        ticket_font_family_name: wasTicketActive ? undefined : prev.ticket_font_family_name,
        custom_font_families: remaining.length > 0 ? remaining : undefined,
      };
    });
    setPendingDeleteFamilyName(null);
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
      ticket_font_family_name: undefined,
    }));
  };

  const handleReset = () => {
    if (!loadedOk) return;
    releaseProvisionalFontsKeeping(themeFontUploadUrls(themeSavedRef.current));
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
        patchOrgBranding({
          org_name: name,
          logo_url: logo || null,
          logo_original_url: orgDraft.logo_original_url ?? null,
          logo_crop: orgDraft.logo_crop ?? null,
        }),
        saveStaffTheme(brandingDraftForSave(themeDraft)),
      ]);

      if (orgResult.status === "fulfilled") {
        orgSavedRef.current = orgResult.value;
        setOrgCommitted(orgResult.value);
        setOrgDraft(orgResult.value);
      }
      if (themeResult.status === "fulfilled") {
        themeSavedRef.current = themeResult.value.theme;
        setThemeDraft(themeResult.value.theme);
        syncColorUiState(themeResult.value.theme);
        // Server GC owns replaced fonts; drop provisional tracking for now-saved URLs.
        provisionalFontUrlsRef.current.clear();
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
  const paletteHex = primaryForColorInput(THEME_COLORS.find((c) => c.key === colorKey)?.hex);
  const customHexOrFallback = isValidHex(customHex) ? customHex : "#066fd1";
  const activeHex = colorMode === "custom" ? customHexOrFallback : paletteHex;
  const customFamilies = themeDraft.custom_font_families ?? [];
  const adminFont = resolveFontInfo(themeDraft.font_family_name, customFamilies);
  // The built-in default (name: undefined) needs a real, non-empty option id - SearchableSelect
  // treats a falsy `value` as "nothing selected" rather than resolving it to a matching option,
  // so "" (the native <option>'s own value for this entry) can't stand in for it here.
  // DEFAULT_BRANDING_FONT_FAMILY_NAME is already the reserved sentinel this codebase uses for
  // "explicitly Admitto Sans" (see Ticket page's own reserved entry below), so it's reused rather
  // than inventing a second one.
  const adminFontOptions = [
    ...FONT_OPTIONS.map((f) => ({ id: f.name ?? DEFAULT_BRANDING_FONT_FAMILY_NAME, label: f.label })),
    ...customFamilies.map((f) => ({ id: f.name, label: f.name })),
  ];
  // "" would collide with SearchableSelect's own falsy-value-means-unselected check (the same
  // reason the admin-panel default above needed a real sentinel id instead of ""). The leading
  // ":" keeps this outside custom_font_families' own namespace - isValidBrandingFontFamilyName
  // only allows [A-Za-z0-9 \-_.], so no real font name (custom names are validated against that
  // same charset both client- and server-side) can ever equal this id, unlike a plain word such
  // as "same-as-admin" itself, which was a legal custom font name and could collide (bot review
  // finding, #761).
  const SAME_AS_ADMIN_FONT_ID = ":same-as-admin";
  const ticketFontOptions = [
    { id: SAME_AS_ADMIN_FONT_ID, label: "Same as Admin panel" },
    // A distinct, reserved value from the fallback above - lets Ticket page be pinned to the
    // default explicitly (e.g. Admin panel = Manrope, Ticket page = Admitto Sans) instead of only
    // ever following whatever Admin panel currently is.
    { id: DEFAULT_BRANDING_FONT_FAMILY_NAME, label: DEFAULT_BRANDING_FONT_FAMILY_NAME },
    ...FONT_OPTIONS.filter((f) => f.name !== undefined).map((f) => ({ id: f.name!, label: f.label })),
    ...customFamilies.map((f) => ({ id: f.name, label: f.name })),
  ];

  if (loading) {
    return showLoading ? (
      <Card title="Organisation branding">
        <p>Loading branding settings…</p>
      </Card>
    ) : null;
  }

  if (loadError) {
    return (
      <Card title="Organisation branding">
        <EmptyState
          title="Could not load branding settings"
          description={loadError}
          action={
            <Button type="button" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      </Card>
    );
  }

  // Successful load always populates loadedOk; failures always set loadError above.
  /* v8 ignore if */
  if (!loadedOk) return null;

  const formDisabled = saving;

  return (
    <>
      <Card title={<HintLabel hint={ORG_BRANDING_HINT}>Organisation branding</HintLabel>}>
        <div className="settings-card-stack branding-form">
          <p className="settings-card-intro">{ORG_BRANDING_INTRO}</p>
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
            originalUrl={orgDraft.logo_original_url}
            cropMeta={orgDraft.logo_crop}
            committedValue={orgCommitted.logo_url}
            committedOriginalUrl={orgCommitted.logo_original_url}
            disabled={formDisabled}
            onChange={(url) => setOrgDraft((prev) => ({ ...prev, logo_url: url }))}
            onSourceChange={(source) =>
              setOrgDraft((prev) => ({
                ...prev,
                logo_original_url: source.originalUrl,
                logo_crop: source.crop,
              }))
            }
            onUploadingChange={setLogoUploading}
          />
        </div>
      </Card>

      <Card
        title={<HintLabel hint={THEME_HINT}>Theme</HintLabel>}
        actions={
          <Button variant="ghost" size="sm" disabled={formDisabled} onClick={handleRestoreThemeDefaults}>
            Restore defaults
          </Button>
        }
      >
        <div>
          <p className="settings-card-intro">{THEME_INTRO}</p>
          <div className="theme-section" aria-labelledby="branding-primary-label">
            <span className="at-label" id="branding-primary-label">
              Primary colour
            </span>
            <p className="at-hint branding-scope-hint">
              {colorMode === "custom" ? (
                <>
                  Custom colour: <code>{customHex}</code>
                </>
              ) : (
                `${THEME_COLORS.find((c) => c.key === colorKey)?.label ?? "Admitto blue"}. Used on buttons, links, and badges across the staff app and ticket page.`
              )}
            </p>
            <ColorPaletteField
              mode={colorMode}
              colorKey={colorKey}
              customHex={customHex}
              disabled={formDisabled}
              onPick={handlePickColor}
              onCustomChange={handleCustomColorChange}
            />
            {themeFieldErrors.primary && (
              <p className="text-error" role="alert">
                {themeFieldErrors.primary}
              </p>
            )}
          </div>

          <div className="theme-section" aria-labelledby="branding-font-label">
            <span className="at-label" id="branding-font-label">
              Font
            </span>
            <p className="at-hint branding-scope-hint">
              Built-in fonts, plus any you upload. Assign one to each surface below.
            </p>
            <FontPickerField
              customFamilies={customFamilies}
              disabled={formDisabled}
              onEditCustom={handleEditCustomFamily}
              onDeleteCustom={setPendingDeleteFamilyName}
              onOpenFamilyModal={handleOpenFamilyModal}
            />
            {themeFieldErrors.font_family_name && (
              <p className="text-error" role="alert">
                {themeFieldErrors.font_family_name}
              </p>
            )}
            {themeFieldErrors.custom_font_families && (
              <p className="text-error" role="alert">
                {themeFieldErrors.custom_font_families}
              </p>
            )}
          </div>

          <div className="theme-section" aria-labelledby="branding-font-surface-label">
            <span className="at-label" id="branding-font-surface-label">
              Font by surface
            </span>
            <p className="at-hint branding-scope-hint">
              Use a different font for each surface, or the same one everywhere.
            </p>
            <div className="font-surface-rows">
          <div className="settings-row">
            <div className="settings-row__text">
              <strong>Admin panel</strong>
              <p>Staff dashboard, tables, and settings, applied live to this app.</p>
            </div>
            <SearchableSelect
              id="branding-font-admin-select"
              label="Admin panel font"
              placeholder="Select font…"
              searchPlaceholder="Search fonts…"
              emptyLabel="No fonts found"
              showLabel={false}
              value={themeDraft.font_family_name ?? DEFAULT_BRANDING_FONT_FAMILY_NAME}
              options={adminFontOptions}
              disabled={formDisabled}
              onChange={(id) =>
                handleSetSurfaceFont("admin", id === DEFAULT_BRANDING_FONT_FAMILY_NAME ? undefined : id)
              }
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <strong>Registration form</strong>
              <p>The public sign-up page attendees would fill in.</p>
            </div>
            <Select
              id="branding-font-registration-select"
              name="branding-font-registration"
              aria-label="Registration form font"
              defaultValue=""
              disabled
              style={FONT_SURFACE_SELECT_STYLE}
            >
              <option value="">Not available yet</option>
            </Select>
          </div>

          <div className="settings-row" style={{ borderBottom: 0, paddingBottom: 0 }}>
            <div className="settings-row__text">
              <strong>Ticket page</strong>
              <p>The public ticket page attendees open after check-in.</p>
            </div>
            <SearchableSelect
              id="branding-font-ticket-select"
              label="Ticket page font"
              placeholder="Same as Admin panel"
              searchPlaceholder="Search fonts…"
              emptyLabel="No fonts found"
              showLabel={false}
              value={themeDraft.ticket_font_family_name ?? SAME_AS_ADMIN_FONT_ID}
              options={ticketFontOptions}
              disabled={formDisabled}
              onChange={(id) =>
                handleSetSurfaceFont("ticket", id === SAME_AS_ADMIN_FONT_ID ? undefined : id)
              }
            />
          </div>
            </div>
            {themeFieldErrors.ticket_font_family_name && (
              <p className="text-error" role="alert">
                {themeFieldErrors.ticket_font_family_name}
              </p>
            )}
          </div>

        <FontFamilyModal
          open={familyModalOpen}
          onClose={closeFamilyModal}
          onSaved={handleFamilySaved}
          initialFamily={editingFamilyName ? (customFamilies.find((f) => f.name === editingFamilyName) ?? null) : null}
        />

        <ConfirmDialog
          open={pendingDeleteFamilyName !== null}
          title={`Remove "${pendingDeleteFamilyName}"?`}
          message="This removes the saved font family from this list. To use it again later, you'll need to upload its files again."
          confirmLabel="Remove"
          confirmVariant="danger"
          onConfirm={() => handleDeleteCustomFamily(pendingDeleteFamilyName!)}
          onCancel={() => setPendingDeleteFamilyName(null)}
        />

        <div className="theme-preview">
          <span className="at-label">Live preview</span>
          <span className="at-hint branding-scope-hint">How your colour and font choices look together.</span>
          <div className="theme-preview__bar" style={{ background: activeHex, fontFamily: adminFont.fontStack }}>
            <span>Primary</span>
            <span>{colorMode === "custom" ? customHex : "default"}</span>
          </div>
          <div className="theme-preview__row">
            <div
              className="theme-preview__bar theme-preview__bar--sm"
              style={{ background: darken(activeHex, 24), fontFamily: adminFont.fontStack }}
            >
              hover
            </div>
            <div
              className="theme-preview__tint"
              style={{ background: `${activeHex}1a`, color: activeHex, fontFamily: adminFont.fontStack }}
            >
              Tint
            </div>
          </div>
          <div className="theme-preview__controls">
            <button type="button" className="theme-preview__btn" style={{ background: activeHex, fontFamily: adminFont.fontStack }}>
              Primary action
            </button>
            <button
              type="button"
              className="theme-preview__btn theme-preview__btn--outline"
              style={{ fontFamily: adminFont.fontStack }}
            >
              Secondary
            </button>
            <span className="theme-preview__badge" style={{ fontFamily: adminFont.fontStack }}>
              Neutral badge
            </span>
          </div>
          <p className="theme-preview__sample" style={{ fontFamily: adminFont.fontStack }}>
            The quick brown fox jumps over the lazy dog.
          </p>
          <div className="theme-preview__variants">
            <span style={{ fontFamily: adminFont.fontStack, fontWeight: 400 }}>Regular Aa</span>
            <span style={{ fontFamily: adminFont.fontStack, fontWeight: 700 }}>
              Bold Aa
              {!adminFont.hasBoldVariant && (
                <i
                  className="ti ti-info-circle theme-preview__faux"
                  aria-hidden="true"
                  title="No bold file uploaded. The browser is faking it."
                />
              )}
            </span>
            <span style={{ fontFamily: adminFont.fontStack, fontStyle: "italic" }}>
              Italic Aa
              {!adminFont.hasItalicVariant && (
                <i
                  className="ti ti-info-circle theme-preview__faux"
                  aria-hidden="true"
                  title="No italic file uploaded. The browser is faking it."
                />
              )}
            </span>
          </div>
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
            disabled={!loadedOk || formDisabled || logoUploading || !hasUnsavedChanges}
            onClick={handleReset}
          >
            Reset to saved
          </Button>
          <Button
            variant="primary"
            disabled={!loadedOk || formDisabled || logoUploading || !hasUnsavedChanges}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </>
  );
}
