import { useEffect, useId, useRef, useState } from "react";
import {
  Button,
  IconButton,
  Input,
  isReservedBrandingFontFamilyName,
  ModalBackdrop,
  useToast,
} from "@admitto/ui";
import { deleteUploadedFile, uploadThemeFont } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { BrandingCustomFontFamilyDto, BrandingFontVariantDto } from "../api/types.js";
import { Segmented } from "../components/Segmented.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
import "../attendees/add-attendee-modal.css";

const FONT_FILE_RE = /\.(woff2?|ttf|otf)$/i;

/** Registration name for each row's own instant local preview - independent of the family name
 * being typed, so renaming the field mid-edit never needs re-registering already-loaded rows. */
const PREVIEW_FAMILY = "__AdmittoFontFamilyPreview";

// Covers every weight WEIGHT_KEYWORDS below can guess from a filename (100-900 in steps of 100) -
// a guess outside this list would set a row's weight to a value the picker below has no matching
// option for, showing the wrong weight selected while silently saving a different one.
export const WEIGHT_OPTIONS = [
  { value: 100, label: "Thin 100" },
  { value: 200, label: "Extralight 200" },
  { value: 300, label: "Light 300" },
  { value: 400, label: "Regular 400" },
  { value: 500, label: "Medium 500" },
  { value: 600, label: "Semibold 600" },
  { value: 700, label: "Bold 700" },
  { value: 800, label: "Extrabold 800" },
  { value: 900, label: "Black 900" },
] as const;

function weightName(weight: number): string {
  return WEIGHT_OPTIONS.find((o) => o.value === weight)?.label.split(" ")[0] ?? String(weight);
}

/** Human label for a weight+style combo, e.g. "Bold", "Regular italic". */
export function styleLabel(weight: number, style: "normal" | "italic"): string {
  return weightName(weight) + (style === "italic" ? " italic" : "");
}

interface FontRow {
  id: number;
  weight: number;
  style: "normal" | "italic";
  fileName: string | null;
  url: string | null;
  loading: boolean;
  loaded: boolean;
}

/** Tabler icon suffix for a row's own file-picker button, reflecting its upload state. */
function rowFileIconName(row: Pick<FontRow, "loading" | "loaded">): string {
  if (row.loading) return "loader-2";
  return row.loaded ? "circle-check-filled" : "upload";
}

/** Row ids whose (weight, style) combo is shared with at least one other row - a browser only
 * ever renders one file per combo, so every extra row sharing a combo is a silently-unused
 * upload rather than the distinct style its "N styles" count implies. */
function duplicateRowIds(rows: readonly FontRow[]): ReadonlySet<number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.weight}:${r.style}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = new Set<number>();
  for (const r of rows) {
    if ((counts.get(`${r.weight}:${r.style}`) ?? 0) > 1) duplicates.add(r.id);
  }
  return duplicates;
}

function nextVariantCombo(rows: readonly FontRow[]): { weight: number; style: "normal" | "italic" } | null {
  const used = new Set(rows.map((r) => `${r.weight}:${r.style}`));
  for (const style of ["normal", "italic"] as const) {
    for (const w of WEIGHT_OPTIONS) {
      const key = `${w.value}:${style}`;
      if (!used.has(key)) return { weight: w.value, style };
    }
  }
  return null;
}

const WEIGHT_KEYWORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/extralight|ultralight/i, 200],
  [/thin/i, 100],
  [/light/i, 300],
  [/regular|normal|book/i, 400],
  [/medium/i, 500],
  [/extrabold|ultrabold/i, 800],
  [/semibold|demibold/i, 600],
  [/black|heavy/i, 900],
  [/bold/i, 700],
];

/** Guess weight + style + family straight from the file name (the common
 * "Family-Weight.woff2" / "Family Bold Italic.ttf" convention) so people don't have to know or
 * set descriptors by hand - editable below if wrong. */
function detectFromFilename(name: string): { weight: number; style: "normal" | "italic"; family: string } {
  const base = name.replace(FONT_FILE_RE, "");
  const style: "normal" | "italic" = /italic|oblique/i.test(base) ? "italic" : "normal";
  let weight = 400;
  for (const [re, w] of WEIGHT_KEYWORDS) {
    if (re.test(base)) {
      weight = w;
      break;
    }
  }
  const family = base
    .replace(/italic|oblique/gi, "")
    .replace(
      /extralight|ultralight|thin|light|regular|normal|book|medium|extrabold|ultrabold|semibold|demibold|black|heavy|bold/gi,
      "",
    )
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { weight, style, family };
}

/** Splits a dropped/browsed FileList into usable font files and a count of skipped ones. */
function partitionFontFiles(fileList: FileList): { files: File[]; skipped: number } {
  const files = Array.from(fileList).filter((f) => FONT_FILE_RE.test(f.name));
  return { files, skipped: fileList.length - files.length };
}

/** One file per (weight, style) combo guessed within a single batch - last one in wins, so
 * dropping two files that guess the same combo doesn't create two rows for it. */
function dedupeByCombo(
  files: readonly File[],
): Map<string, { file: File; guess: ReturnType<typeof detectFromFilename> }> {
  const byCombo = new Map<string, { file: File; guess: ReturnType<typeof detectFromFilename> }>();
  for (const f of files) {
    const guess = detectFromFilename(f.name);
    byCombo.set(`${guess.weight}:${guess.style}`, { file: f, guess });
  }
  return byCombo;
}

/** Loads each guessed file into its row - an existing row if that (weight, style) combo is
 * already present, a new one otherwise - and reports how many replaced an already-added row. */
function applyDroppedFiles(
  byCombo: ReadonlyMap<string, { file: File; guess: ReturnType<typeof detectFromFilename> }>,
  rows: readonly FontRow[],
  loadIntoRow: (file: File, guess: ReturnType<typeof detectFromFilename>, existingId: number | null) => void,
): number {
  let replaced = 0;
  for (const { file, guess } of byCombo.values()) {
    const existing = rows.find((r) => r.weight === guess.weight && r.style === guess.style);
    if (existing) replaced++;
    loadIntoRow(file, guess, existing ? existing.id : null);
  }
  return replaced;
}

export interface FontFamilyModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSaved: (result: { familyName: string; variants: BrandingFontVariantDto[] }) => void;
  /** Pre-fills the form with an existing saved family's name and variants (each already marked
   * loaded, no re-upload needed) instead of starting blank - editing rather than creating. */
  readonly initialFamily?: BrandingCustomFontFamilyDto | null;
}

/** Package multiple weight/style files under one family name - a browser @font-face needs one
 * FontFace per (weight, style) combo to render real bold/italic instead of faking it, so
 * uploading has to be "create a family", not "pick one file". Starts blank on open unless
 * `initialFamily` is given, in which case its variants are pre-loaded for editing. */
export function FontFamilyModal({ open, onClose, onSaved, initialFamily = null }: FontFamilyModalProps) {
  const { addToast } = useToast();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef, open);
  const rowSeqRef = useRef(0);
  // Bumped whenever a new load starts for a given row id - an in-flight load whose generation has
  // since moved on (the user picked another file for that row before the first one finished) just
  // discards its own result instead of overwriting whatever the newer load already produced.
  const rowGenerationRef = useRef(new Map<number, number>());
  const facesRef = useRef(new Map<number, FontFace>());
  /** URLs uploaded during this modal session (not yet saved into the theme). */
  const sessionUploadsRef = useRef(new Set<string>());

  const [familyName, setFamilyName] = useState("");
  const [rows, setRows] = useState<FontRow[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const discardSessionUploads = () => {
    for (const url of sessionUploadsRef.current) {
      void deleteUploadedFile(url);
    }
    sessionUploadsRef.current.clear();
  };

  const cleanupPreviewFaces = () => {
    for (const face of facesRef.current.values()) document.fonts.delete(face);
    facesRef.current.clear();
  };

  useEffect(() => {
    if (!open) {
      discardSessionUploads();
      for (const [id, gen] of rowGenerationRef.current) {
        rowGenerationRef.current.set(id, gen + 1);
      }
      return;
    }
    sessionUploadsRef.current.clear();
    let cancelled = false;
    if (!initialFamily) {
      setFamilyName("");
      setRows([]);
    } else {
      setFamilyName(initialFamily.name);
      const newRows: FontRow[] = initialFamily.variants.map((v) => ({
        id: ++rowSeqRef.current,
        weight: v.weight,
        style: v.style,
        fileName: v.url.slice(v.url.lastIndexOf("/") + 1),
        url: v.url,
        loading: false,
        loaded: true,
      }));
      setRows(newRows);
      // Register each already-saved variant's own real preview (by URL, since there's no local
      // File to read anymore), same as BrandingSettingsPanel does for the picker's own tiles -
      // otherwise every row would show the fallback sample instead of its real font.
      void (async () => {
        for (const row of newRows) {
          const face = new FontFace(PREVIEW_FAMILY, `url("${row.url}")`, {
            weight: String(row.weight),
            style: row.style,
          });
          try {
            await face.load();
            if (cancelled) return;
            document.fonts.add(face);
            facesRef.current.set(row.id, face);
          } catch {
            // Broken/unreachable file - the row still shows as loaded (it's a real saved
            // variant), just falls back to a system font for this preview only.
          }
        }
      })();
    }
    return () => {
      cancelled = true;
      // Unmount (or close) while open: discard provisional uploads the parent never received
      // via onSaved, and invalidate in-flight row loads so late resolves cannot re-add them.
      discardSessionUploads();
      for (const [id, gen] of rowGenerationRef.current) {
        rowGenerationRef.current.set(id, gen + 1);
      }
    };
    // Only re-run when the modal opens or closes, not on every render's fresh initialFamily
    // object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => cleanupPreviewFaces, []);

  const handleClose = () => {
    discardSessionUploads();
    cleanupPreviewFaces();
    onClose();
  };

  useModalFocusTrap(panelRef, open, handleClose);

  if (!open) return null;

  function updateRow(id: number, patch: Partial<FontRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: number) {
    rowGenerationRef.current.set(id, (rowGenerationRef.current.get(id) ?? 0) + 1);
    const face = facesRef.current.get(id);
    if (face) {
      document.fonts.delete(face);
      facesRef.current.delete(id);
    }
    setRows((prev) => {
      // Leave sessionUploadsRef entries for save()/close cleanup so abandoned files are
      // deleted once, after the operator finishes editing the family.
      return prev.filter((r) => r.id !== id);
    });
  }

  function addEmptyRow() {
    const combo = nextVariantCombo(rows);
    if (!combo) {
      addToast("All weight and style combinations are already added", "info");
      return;
    }
    setRows((prev) => [
      ...prev,
      { id: ++rowSeqRef.current, weight: combo.weight, style: combo.style, fileName: null, url: null, loading: false, loaded: false },
    ]);
  }

  function changeRowCombo(id: number, patch: { weight?: number; style?: "normal" | "italic" }) {
    updateRow(id, patch);
  }

  /** Track a freshly uploaded font URL; best-effort delete the previous session URL it replaced. */
  function adoptSessionUpload(url: string, previousUrl: string | null) {
    sessionUploadsRef.current.add(url);
    if (!previousUrl || previousUrl === url || !sessionUploadsRef.current.has(previousUrl)) return;
    sessionUploadsRef.current.delete(previousUrl);
    void deleteUploadedFile(previousUrl);
  }

  function rollbackFailedFontRow(id: number, existingId: number | null) {
    const oldFace = facesRef.current.get(id);
    facesRef.current.delete(id);
    if (oldFace) document.fonts.delete(oldFace);
    if (existingId) {
      updateRow(id, { fileName: null, url: null, loaded: false, loading: false });
    } else {
      setRows((prev) => prev.filter((r) => r.id !== id));
    }
  }

  async function loadIntoRow(file: File, guess: { weight: number; style: "normal" | "italic" }, existingId: number | null) {
    const id = existingId ?? ++rowSeqRef.current;
    const generation = (rowGenerationRef.current.get(id) ?? 0) + 1;
    rowGenerationRef.current.set(id, generation);
    const isStale = () => rowGenerationRef.current.get(id) !== generation;
    const previousUrl = existingId != null ? rows.find((r) => r.id === existingId)?.url ?? null : null;

    if (existingId) {
      updateRow(id, { weight: guess.weight, style: guess.style, fileName: file.name, url: null, loaded: false, loading: true });
    } else {
      setRows((prev) => [
        ...prev,
        { id, weight: guess.weight, style: guess.style, fileName: file.name, url: null, loading: true, loaded: false },
      ]);
    }
    try {
      const buf = await file.arrayBuffer();
      const face = new FontFace(PREVIEW_FAMILY, buf, { weight: String(guess.weight), style: guess.style });
      await face.load();
      // A newer load for this same row started (and possibly already finished) while this one
      // was still reading/decoding its file - that one is authoritative now, so this one's own
      // preview is discarded instead of clobbering it.
      if (isStale()) {
        document.fonts.delete(face);
        return;
      }
      const oldFace = facesRef.current.get(id);
      if (oldFace) document.fonts.delete(oldFace);
      document.fonts.add(face);
      facesRef.current.set(id, face);

      const formData = new FormData();
      formData.append("file", file);
      const { url } = await uploadThemeFont(formData);
      if (isStale()) {
        void deleteUploadedFile(url);
        return;
      }
      adoptSessionUpload(url, previousUrl);
      updateRow(id, { loaded: true, loading: false, url });
    } catch (err) {
      if (isStale()) return;
      rollbackFailedFontRow(id, existingId);
      addToast(operatorApiErrorMessage(err, `Couldn't upload "${file.name}".`), "error");
    }
  }

  // Manually replacing one row's own file always targets that row - the user picked it on
  // purpose, so no merge-with-another-row check here.
  function replaceRowFile(file: File, rowId: number) {
    if (!FONT_FILE_RE.test(file.name)) {
      addToast(`Skipped "${file.name}" - use .woff, .woff2, .ttf, or .otf`, "error");
      return;
    }
    void loadIntoRow(file, detectFromFilename(file.name), rowId);
  }

  // Bulk drop/browse: same (weight, style) guessed twice - within this batch or against an
  // already-added row - replaces in place instead of duplicating, so re-dropping a corrected
  // file just overwrites the old one.
  function handleDropzoneFiles(fileList: FileList) {
    const { files, skipped } = partitionFontFiles(fileList);
    if (skipped > 0) {
      addToast(`Skipped ${skipped} file${skipped === 1 ? "" : "s"} - use .woff, .woff2, .ttf, or .otf`, "error");
    }
    if (files.length === 0) return;

    const byCombo = dedupeByCombo(files);
    if (!familyName) {
      const first = [...byCombo.values()][0];
      if (first?.guess.family) setFamilyName(first.guess.family);
    }
    const dupCount = applyDroppedFiles(byCombo, rows, (file, guess, existingId) => {
      void loadIntoRow(file, guess, existingId);
    });
    if (dupCount > 0) {
      addToast(`Replaced ${dupCount} existing variant${dupCount === 1 ? "" : "s"} with the new file${dupCount === 1 ? "" : "s"}`, "info");
    }
  }

  const loadedRows = rows.filter((r) => r.loaded && r.url);
  // Only rows that actually have a file count - two still-empty rows sharing a combo don't
  // affect what gets saved, and would otherwise block Save over nothing.
  const duplicateRowIdSet = duplicateRowIds(loadedRows);
  const trimmedName = familyName.trim();
  // A custom family named after a built-in (e.g. "Manrope") would write the same
  // font_family_name as picking the built-in tile - the two picks become indistinguishable, and
  // the built-in becomes unreachable. Caught here, at the point of naming, rather than only on
  // the outer panel's Save.
  const nameIsReserved = trimmedName.length > 0 && isReservedBrandingFontFamilyName(trimmedName);
  const canSave = trimmedName.length > 0 && !nameIsReserved && loadedRows.length > 0 && duplicateRowIdSet.size === 0;
  const anyUploading = rows.some((r) => r.loading);

  function save() {
    cleanupPreviewFaces();
    // Keep uploaded variant URLs for the parent draft; only discard abandoned session files.
    // Parent (BrandingSettingsPanel) owns cleanup until outer theme Save / Reset.
    const kept = new Set(
      loadedRows.map((r) => r.url).filter((u): u is string => typeof u === "string"),
    );
    for (const url of sessionUploadsRef.current) {
      if (!kept.has(url)) void deleteUploadedFile(url);
    }
    sessionUploadsRef.current.clear();
    onSaved({
      familyName: familyName.trim(),
      variants: loadedRows.map((r) => ({ weight: r.weight, style: r.style, url: r.url! })),
    });
  }

  return (
    <dialog className="add-attendee-modal" open aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop onClose={handleClose} />
      <div ref={panelRef} className="add-attendee-modal__panel" style={{ width: "min(94vw, 640px)" }}>
      <div ref={scrollRef} className="add-attendee-modal__scroll">
        <h2 className="add-attendee-modal__title" id={titleId}>
          {initialFamily ? `Edit "${initialFamily.name}"` : "Create font family"}
        </h2>
        <div className="fontfam-modal-body">
          <Input
            label="Family name"
            placeholder="e.g. Acme Sans"
            value={familyName}
            hint="Guessed from the first file you add - rename if needed."
            error={nameIsReserved ? `"${trimmedName}" is a built-in font name. Choose a different name.` : undefined}
            onChange={(e) => setFamilyName(e.target.value)}
          />

          <label
            className={`fontfam-dropzone${dragOver ? " fontfam-dropzone--over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleDropzoneFiles(e.dataTransfer.files);
            }}
          >
            <i className="ti ti-cloud-upload" aria-hidden="true" />
            <span>Drop font files here, or click to browse.</span>
            <span className="at-hint">WOFF, WOFF2, TTF, OTF · max 5 MB per file · add as many weights as you have</span>
            <input
              type="file"
              multiple
              accept=".woff,.woff2,.ttf,.otf"
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) handleDropzoneFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <p className="at-hint" style={{ marginTop: 6, marginBottom: 0 }}>
            We guess the weight and style from each file name. You can fix them below if we got it
            wrong. Only Regular is required. If you skip a weight, the browser will fake it
            instead of using the real font.
          </p>

          {rows.length > 0 && (
            <div className="fontfam-rows">
              {rows.map((row) => (
                <div
                  className={`fontfam-row${duplicateRowIdSet.has(row.id) ? " fontfam-row--duplicate" : ""}`}
                  key={row.id}
                >
                  <div style={{ width: 168 }}>
                    <SearchableSelect
                      id={`fontfam-row-weight-${row.id}`}
                      label="Weight"
                      placeholder="Select weight…"
                      searchPlaceholder="Search weights…"
                      emptyLabel="No weights found"
                      showLabel={false}
                      value={String(row.weight)}
                      options={WEIGHT_OPTIONS.map((w) => ({ id: String(w.value), label: w.label }))}
                      onChange={(id) => changeRowCombo(row.id, { weight: Number(id) })}
                    />
                  </div>
                  <Segmented
                    ariaLabel="Style"
                    className="fontfam-row-style-toggle"
                    value={row.style}
                    onChange={(v) => changeRowCombo(row.id, { style: v })}
                    options={[
                      { value: "normal", label: "Normal" },
                      { value: "italic", label: "Italic" },
                    ]}
                  />
                  <label className={`fontfam-row__file${row.loaded ? " fontfam-row__file--loaded" : ""}`}>
                    <i
                      className={`ti ti-${rowFileIconName(row)}`}
                      aria-hidden="true"
                    />
                    <span>{row.loading ? "Uploading…" : row.fileName || "Choose file"}</span>
                    <input
                      type="file"
                      accept=".woff,.woff2,.ttf,.otf"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) replaceRowFile(f, row.id);
                      }}
                    />
                  </label>
                  {row.loaded && (
                    <span
                      className="fontfam-row__sample"
                      style={{ fontFamily: PREVIEW_FAMILY, fontWeight: row.weight, fontStyle: row.style }}
                    >
                      Aa
                    </span>
                  )}
                  <IconButton
                    icon={<i className="ti ti-trash" aria-hidden="true" />}
                    label="Remove variant"
                    size="sm"
                    onClick={() => removeRow(row.id)}
                  />
                </div>
              ))}
            </div>
          )}
          {duplicateRowIdSet.size > 0 && (
            <p className="at-hint at-hint--error" role="alert">
              This weight and style is already loaded in another row. Remove one of the
              highlighted rows before saving, or pick a different weight or style.
            </p>
          )}
          <button type="button" className="fontfam-add-row" onClick={addEmptyRow}>
            <i className="ti ti-plus" aria-hidden="true" /> Add a variant manually
          </button>
        </div>
        <div className="add-attendee-modal__actions">
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSave || anyUploading} onClick={save}>
            Save font family
          </Button>
        </div>
      </div>
      </div>
    </dialog>
  );
}
