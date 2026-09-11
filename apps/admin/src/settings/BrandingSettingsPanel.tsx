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
  Tooltip,
  useToast,
} from "@admitto/ui";
import { fetchOrgBranding, fetchStaffTheme, patchOrgBranding, saveStaffTheme, deleteUploadedFile } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { BrandingCustomFontFamilyDto, BrandingThemeDto, SetupOrgBrandingDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { LogoUploadZone } from "../components/LogoUploadZone.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
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

interface ColorUiState {
  readonly mode: ColorMode;
  readonly colorKey: string;
  readonly customHex: string;
}

const DEFAULT_COLOR_UI_STATE: ColorUiState = { mode: "palette", colorKey: "blue", customHex: "#066fd1" };

/** UI-presentation state for a colour field (which swatch to highlight / what the custom picker
 * shows), derived one-way from a saved hex value - the value itself stays the single source of
 * truth, same relationship as themeDraft.primary always had with the old colorMode/colorKey/
 * customHex triple this replaces (now one instance per surface instead of one shared instance). */
function deriveColorUiState(hex: string | undefined): ColorUiState {
  const paletteMatch = hex && THEME_COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase());
  if (paletteMatch) return { mode: "palette", colorKey: paletteMatch.key, customHex: DEFAULT_COLOR_UI_STATE.customHex };
  if (hex && isValidHex(hex)) return { mode: "custom", colorKey: "blue", customHex: hex };
  return DEFAULT_COLOR_UI_STATE;
}

/** Display text for a colour control's trigger when it holds an explicit value (not "Default"/
 * "Same as Admin panel", which the caller renders instead in those cases). */
function colorPaletteLabel(ui: ColorUiState): string {
  if (ui.mode === "custom") return ui.customHex;
  return THEME_COLORS.find((c) => c.key === ui.colorKey)?.label ?? "Admitto blue";
}

interface ColorSurfaceControlProps {
  readonly id: string;
  readonly label: string;
  /** Effective colour shown on the trigger's dot - always a valid hex (see primaryForColorInput). */
  readonly hex: string;
  readonly displayLabel: string;
  readonly mode: ColorMode;
  readonly colorKey: string;
  readonly customHex: string;
  readonly disabled: boolean;
  /** Ticket page only: whether the popover's "Same as Admin panel" row is the active pick, and
   * the Admin panel's own resolved colour to preview on that row's dot - distinct from `hex`
   * (this control's own effective colour, shown on the trigger), since when Ticket page has its
   * own override the two differ and "Same as Admin panel" must preview what picking it would
   * actually resolve to, not the override it would replace. */
  readonly sameAsAdmin?: boolean;
  readonly sameAsAdminHex?: string;
  readonly onPick: (key: string, hex: string) => void;
  readonly onCustomChange: (hex: string) => void;
  readonly onSelectSameAsAdmin?: () => void;
}

/** Pill trigger + popover reusing ColorPaletteField, so a surface's colour picker never needs its
 * own permanently-visible 12-swatch grid - the same grid is just opened contextually per row.
 * Same trigger/panel/useDropdownMenu mechanism as SearchableSelect. */
function ColorSurfaceControl({
  id,
  label,
  hex,
  displayLabel,
  mode,
  colorKey,
  customHex,
  disabled,
  sameAsAdmin,
  sameAsAdminHex,
  onPick,
  onCustomChange,
  onSelectSameAsAdmin,
}: Readonly<ColorSurfaceControlProps>) {
  // No explicit close() on pick - unlike SearchableSelect, this popover stays open after
  // choosing a colour (swatch, custom hex, or "Same as Admin panel") so trying several in a row
  // means one open/close cycle, not one per attempt; only useDropdownMenu's own outside-click/
  // Escape handling closes it.
  const { open, setOpen, openUpward, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<
    HTMLButtonElement,
    HTMLDivElement
  >({ align: "start" });

  // While inheriting ("Same as Admin panel" active), the palette below must show no swatch (and
  // not the custom tile either) as active - colorKey/mode otherwise still hold whatever was last
  // explicitly picked before the override was cleared, which would show two conflicting
  // selections at once (the "Same as Admin panel" row AND a stale swatch, both marked active).
  // "" never matches a real THEME_COLORS key, so this is enough to blank the palette without
  // needing a third ColorMode value.
  const paletteMode = sameAsAdmin ? "palette" : mode;
  const paletteColorKey = sameAsAdmin ? "" : colorKey;

  return (
    <div className="color-surface-control" ref={rootRef}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="color-surface-control__trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-label={`${label}, ${displayLabel}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="color-surface-control__dot" style={{ background: hex }} aria-hidden="true" />
        <span className="color-surface-control__label">{displayLabel}</span>
        <i className="ti ti-chevron-down color-surface-control__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div
          className={`color-surface-control__panel${openUpward ? " color-surface-control__panel--up" : ""}`}
          ref={panelRef}
          style={panelStyle}
        >
          {onSelectSameAsAdmin && (
            <>
              <button
                type="button"
                className={`color-surface-control__option${sameAsAdmin ? " color-surface-control__option--active" : ""}`}
                onClick={onSelectSameAsAdmin}
              >
                <span className="color-surface-control__dot" style={{ background: sameAsAdminHex }} aria-hidden="true" />
                <span>Same as Admin panel</span>
              </button>
              <div className="color-surface-control__divider" />
            </>
          )}
          <ColorPaletteField
            mode={paletteMode}
            colorKey={paletteColorKey}
            customHex={customHex}
            disabled={disabled}
            onPick={onPick}
            onCustomChange={onCustomChange}
          />
        </div>
      )}
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
type ColorSurface = "admin" | "ticket";

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
  // deriveColorUiState. One instance per surface with its own colour control (admin/ticket) -
  // Font state needs no equivalent - which tile is "active" is always just derived directly from
  // themeDraft.font_family_name/custom_font_families below.
  const [adminColorUi, setAdminColorUi] = useState<ColorUiState>(DEFAULT_COLOR_UI_STATE);
  const [ticketColorUi, setTicketColorUi] = useState<ColorUiState>(DEFAULT_COLOR_UI_STATE);
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
    setAdminColorUi(deriveColorUiState(theme.primary));
    setTicketColorUi(deriveColorUiState(theme.ticket_primary));
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
      setLoadError("Could not load branding settings. Use Retry to reload.");
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

  const handlePickSurfaceColor = (surface: ColorSurface, key: string, hex: string) => {
    (surface === "admin" ? setAdminColorUi : setTicketColorUi)((prev) => ({ ...prev, mode: "palette", colorKey: key }));
    setThemeDraft((prev) => (surface === "admin" ? { ...prev, primary: hex } : { ...prev, ticket_primary: hex }));
  };

  const handleCustomSurfaceColorChange = (surface: ColorSurface, hex: string) => {
    (surface === "admin" ? setAdminColorUi : setTicketColorUi)((prev) => ({ ...prev, mode: "custom", customHex: hex }));
    setThemeDraft((prev) => (surface === "admin" ? { ...prev, primary: hex } : { ...prev, ticket_primary: hex }));
  };

  const handleSelectSameAsAdminColor = () => {
    setThemeDraft((prev) => ({ ...prev, ticket_primary: undefined }));
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
    setAdminColorUi(DEFAULT_COLOR_UI_STATE);
    setTicketColorUi(DEFAULT_COLOR_UI_STATE);
    setThemeDraft((prev) => ({
      ...prev,
      primary: undefined,
      ticket_primary: undefined,
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
          operatorApiErrorMessage(orgResult.reason, "Failed to save organization branding. Theme changes were saved."),
          "error",
        );
      } else if (themeResult.status === "rejected") {
        addToast(
          operatorApiErrorMessage(themeResult.reason, "Failed to save theme. Organization branding was saved."),
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
  // Live preview always reflects the Admin panel colour - same semantics "Primary colour" used to
  // have before it moved into the Theme-by-surface row.
  const paletteHex = primaryForColorInput(THEME_COLORS.find((c) => c.key === adminColorUi.colorKey)?.hex);
  const customHexOrFallback = isValidHex(adminColorUi.customHex) ? adminColorUi.customHex : "#066fd1";
  const activeHex = adminColorUi.mode === "custom" ? customHexOrFallback : paletteHex;
  const adminColorHex = primaryForColorInput(themeDraft.primary);
  // Always the real colour name (e.g. "Admitto blue"), never a generic "Default" placeholder -
  // matches the Admin panel font trigger right next to it, which likewise always shows "Admitto
  // Sans" rather than "Default" when unset. Picking the blue swatch that happens to match the
  // built-in default must not flip the label to something else with no visible colour change.
  const adminColorDisplayLabel = colorPaletteLabel(adminColorUi);
  const ticketColorSameAsAdmin = themeDraft.ticket_primary === undefined;
  const ticketColorHex = primaryForColorInput(themeDraft.ticket_primary ?? themeDraft.primary);
  const ticketColorDisplayLabel = ticketColorSameAsAdmin ? "Same as Admin panel" : colorPaletteLabel(ticketColorUi);
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
          <div className="theme-section" aria-labelledby="branding-font-label">
            <span className="overline" id="branding-font-label">
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

          <div className="theme-section" aria-labelledby="branding-theme-surface-label">
            <span className="overline" id="branding-theme-surface-label">
              Theme by surface
            </span>
            <p className="at-hint branding-scope-hint">
              Give each surface its own colour and font, or keep Ticket page matching Admin panel.
            </p>
            <div className="theme-surface-rows">
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>Admin panel</strong>
                  <p>Staff dashboard, tables, and settings, applied live to this app.</p>
                </div>
                <div className="settings-row__controls">
                  <ColorSurfaceControl
                    id="branding-color-admin-trigger"
                    label="Admin panel colour"
                    hex={adminColorHex}
                    displayLabel={adminColorDisplayLabel}
                    mode={adminColorUi.mode}
                    colorKey={adminColorUi.colorKey}
                    customHex={adminColorUi.customHex}
                    disabled={formDisabled}
                    onPick={(key, hex) => handlePickSurfaceColor("admin", key, hex)}
                    onCustomChange={(hex) => handleCustomSurfaceColorChange("admin", hex)}
                  />
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
              </div>

              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>Registration form</strong>
                  <p>The public sign-up page attendees would fill in.</p>
                </div>
                <div className="settings-row__controls">
                  <button
                    type="button"
                    className="color-surface-control__trigger"
                    disabled
                    aria-label="Registration form colour, not available yet"
                  >
                    <span className="color-surface-control__label color-surface-control__label--placeholder">
                      Not available yet
                    </span>
                  </button>
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
              </div>

              <div className="settings-row" style={{ borderBottom: 0, paddingBottom: 0 }}>
                <div className="settings-row__text">
                  <strong>Ticket page</strong>
                  <p>The public ticket page attendees open after check-in.</p>
                </div>
                <div className="settings-row__controls">
                  <ColorSurfaceControl
                    id="branding-color-ticket-trigger"
                    label="Ticket page colour"
                    hex={ticketColorHex}
                    displayLabel={ticketColorDisplayLabel}
                    mode={ticketColorUi.mode}
                    colorKey={ticketColorUi.colorKey}
                    customHex={ticketColorUi.customHex}
                    disabled={formDisabled}
                    sameAsAdmin={ticketColorSameAsAdmin}
                    sameAsAdminHex={adminColorHex}
                    onPick={(key, hex) => handlePickSurfaceColor("ticket", key, hex)}
                    onCustomChange={(hex) => handleCustomSurfaceColorChange("ticket", hex)}
                    onSelectSameAsAdmin={handleSelectSameAsAdminColor}
                  />
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
            </div>
            {themeFieldErrors.primary && (
              <p className="text-error" role="alert">
                {themeFieldErrors.primary}
              </p>
            )}
            {themeFieldErrors.ticket_primary && (
              <p className="text-error" role="alert">
                {themeFieldErrors.ticket_primary}
              </p>
            )}
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
          <span className="overline">Live preview</span>
          <span className="at-hint branding-scope-hint">How your colour and font choices look together.</span>
          <div className="theme-preview__bar" style={{ background: activeHex, fontFamily: adminFont.fontStack }}>
            <span>Primary</span>
            <span>{adminColorUi.mode === "custom" ? adminColorUi.customHex : "default"}</span>
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
                <Tooltip content="No bold file uploaded. The browser is faking it.">
                  <i className="ti ti-info-circle theme-preview__faux" aria-hidden="true" />
                </Tooltip>
              )}
            </span>
            <span style={{ fontFamily: adminFont.fontStack, fontStyle: "italic" }}>
              Italic Aa
              {!adminFont.hasItalicVariant && (
                <Tooltip content="No italic file uploaded. The browser is faking it.">
                  <i className="ti ti-info-circle theme-preview__faux" aria-hidden="true" />
                </Tooltip>
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
