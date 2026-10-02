import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PercentCrop } from "react-image-crop";
import { Button, Card, EmptyState, HintLabel, Input, Notice, Skeleton, useToast } from "@admitto/ui";
// Subpath only: the package root re-exports Prisma/mjml server modules. Importing the
// barrel into the SPA pulled Node APIs (fileURLToPath) into Event Settings and crashed.
import { ALLOWED_PLACEHOLDERS } from "@admitto/mail-templates/placeholders";
import {
  createEventImageAsset,
  deleteEventImageAsset,
  deleteUploadedFile,
  fetchEventImageAssets,
  updateEventImageAsset,
  uploadEventBrandingFile,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventImageAssetDto, LogoCropMeta } from "../api/types.js";
import { usePanelLoad } from "../hooks/usePanelLoad.js";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import { formatFileSize } from "../utils/formatFileSize.js";
import { brandingLogoImgSrc } from "../utils/safeBrandingLogoHref.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { RetryEmptyState } from "./RetryEmptyState.js";
import { CropImageModal } from "./crop/CropImageModal.js";
import { cropMetaToPercent, toLogoCropMeta } from "./crop/cropMeta.js";
import { resolveCropOutputMime } from "./crop/getCroppedImageBlob.js";
import {
  ALLOWED_BRANDING_IMAGE_TYPES,
  extensionForBrandingImageMime,
  MAX_BRANDING_IMAGE_UPLOAD_BYTES,
} from "./brandingImageConstraints.js";
import { pluralSuffix } from "../utils/pluralize.js";
import "./event-image-asset-library.css";

const MAX_UPLOAD_BYTES = MAX_BRANDING_IMAGE_UPLOAD_BYTES;
const TOKEN_MAX_LENGTH = 40;
/** Matches apps/web event-image-assets-routes DISPLAY_NAME_MAX. */
const DISPLAY_NAME_MAX = 80;
const TOKEN_PATTERN = /^[a-z][a-z0-9_]*$/;
const ALLOWED_IMAGE_TYPES = ALLOWED_BRANDING_IMAGE_TYPES;

/** The height of a tile of the library's grid, for its placeholder. */
const ASSET_TILE_HEIGHT = 292;

/** The tiles of "Your images" while the list loads: the grid of the real one, in a status region named after what loads. */
function AssetGridSkeleton({ held, slow }: Readonly<{ held: boolean; slow: boolean }>) {
  return (
    <output aria-label="Loading images" className={held ? "image-asset-library__skeleton at-loading-hold" : "image-asset-library__skeleton"}>
      <div aria-hidden="true">
        <Skeleton variant="rect" width="38%" height={21} />
      </div>
      <div className="image-asset-library__grid" aria-hidden="true">
        {[0, 1, 2].map((tile) => (
          <Skeleton key={tile} variant="rect" height={ASSET_TILE_HEIGHT} />
        ))}
      </div>
      {slow ? <span className="at-hint" style={{ display: "block", textAlign: "center", color: "var(--text-secondary)" }}>{SLOW_NOTICE_TEXT}</span> : null}
    </output>
  );
}

export interface EventImageAssetLibraryProps {
  readonly eventId: string;
  /** Disables uploading and deleting assets (e.g. archived event). Viewing the list stays allowed. */
  readonly disabled?: boolean;
}

function trimTrailingUnderscores(value: string): string {
  let end = value.length;
  while (end > 0 && value.codePointAt(end - 1) === 95) end -= 1;
  return value.slice(0, end);
}

function trimLeadingNonLetters(value: string): string {
  let start = 0;
  while (start < value.length) {
    const code = value.codePointAt(start)!;
    if (code >= 97 && code <= 122) break;
    start += 1;
  }
  return value.slice(start);
}

function tokenFromDisplayName(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  return trimTrailingUnderscores(trimLeadingNonLetters(slug)).slice(0, TOKEN_MAX_LENGTH);
}

/** Mirrors server allocateImageAssetToken so the preview matches what create will store. */
function allocatePreviewToken(base: string, taken: ReadonlySet<string>): string | null {
  for (let n = 1; n < 100; n++) {
    const suffix = n === 1 ? "" : `_${n}`;
    const candidate =
      n === 1 ? base : `${base.slice(0, Math.max(1, TOKEN_MAX_LENGTH - suffix.length))}${suffix}`;
    if (ALLOWED_PLACEHOLDERS.has(candidate) || taken.has(candidate)) continue;
    if (!TOKEN_PATTERN.test(candidate) || candidate.length > TOKEN_MAX_LENGTH) continue;
    return candidate;
  }
  return null;
}

function imageNameValidationError(displayName: string, touched: boolean): string | undefined {
  if (!touched) return undefined;
  const trimmed = displayName.trim();
  if (trimmed.length > DISPLAY_NAME_MAX) {
    return `Keep the image name to ${DISPLAY_NAME_MAX} characters or fewer.`;
  }
  const token = tokenFromDisplayName(trimmed);
  if (!token || !TOKEN_PATTERN.test(token)) {
    return "Enter a display name with at least one letter.";
  }
  return undefined;
}

function extensionForMime(mime: string): string {
  return extensionForBrandingImageMime(mime);
}

function sniffImageMime(file: File): string {
  const lower = file.name.toLowerCase();
  // Filename wins for SVG so a mislabeled File.type (e.g. image/png) cannot bypass the SVG reject.
  if (lower.endsWith(".svg")) return "image/svg+xml";

  const declared = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (ALLOWED_IMAGE_TYPES.has(declared) || declared === "image/svg+xml") return declared;
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return declared;
}

function basenameWithoutExt(filename: string): string {
  return filename.replace(/\.[^.]+$/, "") || filename;
}

function clampDisplayName(value: string): string {
  return value.slice(0, DISPLAY_NAME_MAX);
}

function deleteNoticeForAsset(asset: EventImageAssetDto, blockedByTemplate: boolean): string {
  if (blockedByTemplate) {
    return `This image is still used in this event's email template. Remove {{${asset.token}}} from the template first.`;
  }
  return `If {{${asset.token}}} is still used in an email template, remove it from the template first.`;
}

/** @internal Unit-test surface for small helpers. */
export const eventImageAssetLibraryTestUtils = {
  pluralSuffix,
  tokenFromDisplayName,
  allocatePreviewToken,
  imageNameValidationError,
  extensionForMime,
  sniffImageMime,
  basenameWithoutExt,
  clampDisplayName,
  deleteNoticeForAsset,
  DISPLAY_NAME_MAX,
};

const UPLOAD_IMAGES_HINT =
  "Event-only images for email templates.";

type PendingCrop = {
  /** Same-origin `/uploads/…` preview (uploaded before crop - no File→blob:→img.src). */
  imageSrc: string;
  sourceMime: string;
  originalName: string;
};

/** Re-crop session for an already-uploaded asset (the "Edit" button on a gallery card). */
type EditCropSession = {
  assetId: string;
  imageSrc: string;
  sourceMime: string;
  filenameBase: string;
  initialCrop?: PercentCrop;
  initialZoom?: number;
};

function ImageNameHint({
  errorText,
  previewToken,
}: Readonly<{ errorText?: string; previewToken: string | null }>) {
  if (errorText) {
    return (
      <p className="at-hint at-hint--error image-asset-library__name-hint" role="alert">
        {errorText}
      </p>
    );
  }
  return (
    <p className="at-hint image-asset-library__name-hint">
      Template variable: {previewToken ? `{{${previewToken}}}` : "{{name}}"}
    </p>
  );
}

/**
 * Named branding image library for an event: upload extra images (e.g. sponsor logos) and give
 * each one a short token, then use `{{token}}` in an email template's body to insert it.
 *
 * One event, one library: a different `eventId` is a fresh library (its own load, list and form), never the previous
 * event's images with new data under them.
 */
export function EventImageAssetLibrary(props: EventImageAssetLibraryProps) {
  return <EventImageAssetLibraryBody key={props.eventId} {...props} />;
}

function EventImageAssetLibraryBody({ eventId, disabled = false }: EventImageAssetLibraryProps) {
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<EventImageAssetDto[]>([]);

  const [displayName, setDisplayName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [displayNameTouched, setDisplayNameTouched] = useState(false);
  /** The picked file is being uploaded for cropping. */
  const [uploading, setUploading] = useState(false);
  /** The cropped image is being added to the library: Add image's own flag, apart from the upload above. */
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingCrop, setPendingCrop] = useState<PendingCrop | null>(null);
  /** Original URL + crop framing for the file currently staged in `file`, once cropped - sent
   * along with Add image so the server can persist the original for later re-Edit. */
  const [pendingOriginal, setPendingOriginal] = useState<{ url: string; crop: LogoCropMeta } | null>(
    null,
  );
  /** Pre-crop upload URL kept until Add asset succeeds or the operator cancels/replaces. */
  const preCropUrlRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const [editSession, setEditSession] = useState<EditCropSession | null>(null);

  const [dragging, setDragging] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBlockedByTemplate, setDeleteBlockedByTemplate] = useState(false);

  const discardPreCropUpload = () => {
    const url = preCropUrlRef.current;
    preCropUrlRef.current = null;
    if (url) void deleteUploadedFile(url);
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      discardPreCropUpload();
    };
  }, []);

  // The first load of the list: nothing is drawn for 200ms, then tiles of placeholders, an error with a busy Retry after a
  // failure (or 30 seconds without an answer). The upload card above it is there from the start.
  const panel = usePanelLoad({
    fetch: (signal) => fetchEventImageAssets(eventId, signal),
    apply: setAssets,
    fallback: "Could not load images.",
  });

  const tokenTrimmed = tokenFromDisplayName(displayName);
  const takenTokens = new Set(assets.map((a) => a.token));
  const previewToken = tokenTrimmed ? allocatePreviewToken(tokenTrimmed, takenTokens) : null;
  const tokenErrorText = imageNameValidationError(displayName, displayNameTouched);
  // The names already taken (the preview of the name's variable) and the list an added image joins are the list's, so Add
  // waits for the list; a file is neither picked nor dropped while the file before it is being prepared or added.
  const listReady = panel.gate.showContent && !panel.error;
  const working = uploading || adding;
  const canSubmit =
    Boolean(file) && !tokenErrorText && Boolean(previewToken) && !working && !disabled && listReady;
  const addReasonId = "image-asset-library-add-reason";
  const addReason = !listReady
    ? "The images are still loading."
    : !file
      ? "Choose an image and give it a name first."
      : undefined;

  const resetForm = () => {
    setDisplayName("");
    setDisplayNameTouched(false);
    setFile(null);
    setPendingOriginal(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const closePendingCrop = () => {
    setPendingCrop(null);
  };

  const handleFilePick = async (picked: File | null) => {
    setFormError(null);
    if (!picked) {
      setFile(null);
      return;
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setFormError("File must be 2 MB or smaller.");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (adding) return;
    const declared = sniffImageMime(picked);
    if (declared === "image/svg+xml") {
      setFormError("SVG is not supported. Use PNG, JPG, or WebP.");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.has(declared)) {
      setFormError("Use a PNG, JPG, or WebP image.");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    discardPreCropUpload();
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", picked);
      const { url } = await uploadEventBrandingFile(eventId, fd);
      if (!aliveRef.current) {
        void deleteUploadedFile(url);
        return;
      }
      preCropUrlRef.current = url;
      setPendingCrop({
        imageSrc: url,
        sourceMime: declared,
        originalName: picked.name || `asset${extensionForMime(declared)}`,
      });
      setDisplayName((prev) =>
        clampDisplayName(prev.trim() || basenameWithoutExt(picked.name || "image")),
      );
    } catch (err) {
      setFormError(operatorApiErrorMessage(err, "Could not prepare image for cropping."));
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setUploading(false);
    }
  };

  const openFilePicker = () => {
    if (!disabled && !working) fileRef.current?.click();
  };

  const handleSubmit = async () => {
    if (!file || tokenErrorText || !previewToken) return;
    setAdding(true);
    setFormError(null);
    try {
      const created = await createEventImageAsset(
        eventId,
        file,
        displayName.trim(),
        pendingOriginal ?? undefined,
      );
      setAssets((prev) => [...prev, created]);
      // The server now owns the pre-crop original (persisted as original_url) - release the
      // ref without deleting it, unlike the cancel/replace paths below.
      preCropUrlRef.current = null;
      resetForm();
      addToast(`Added "${created.filename}"`, "success", 2500);
    } catch (err) {
      setFormError(operatorApiErrorMessage(err, "Could not add image."));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    setDeleteError(null);
    setDeleteBlockedByTemplate(false);
    try {
      await deleteEventImageAsset(eventId, confirmDeleteId);
      setAssets((prev) => prev.filter((a) => a.id !== confirmDeleteId));
      setConfirmDeleteId(null);
    } catch (err) {
      if (hasApiErrorCode(err, "asset_in_use")) {
        setDeleteBlockedByTemplate(true);
      } else {
        setDeleteError(operatorApiErrorMessage(err, "Could not delete image."));
      }
    } finally {
      setDeleting(false);
    }
  };

  const copyToken = async (t: string) => {
    try {
      await navigator.clipboard.writeText(`{{${t}}}`);
      addToast("Copied to clipboard", "success", 2000);
    } catch {
      addToast("Could not copy", "error");
    }
  };

  const openEditCrop = (asset: EventImageAssetDto) => {
    if (disabled) return;
    const hasOriginal = Boolean(asset.original_url);
    if (!hasOriginal) {
      addToast(
        "The original image isn't available for this image - re-cropping the current image instead.",
        "info",
        4500,
      );
    }
    setEditSession({
      assetId: asset.id,
      imageSrc: asset.original_url ?? asset.url,
      sourceMime: asset.mime_type,
      filenameBase: basenameWithoutExt(asset.filename),
      initialCrop: hasOriginal ? cropMetaToPercent(asset.crop) : undefined,
      initialZoom: hasOriginal ? (asset.crop?.zoom ?? undefined) : undefined,
    });
  };

  const deletingAsset = assets.find((a) => a.id === confirmDeleteId) ?? null;

  function renderAssetsList(): ReactNode {
    if (!panel.gate.showContent) {
      return <AssetGridSkeleton held={!panel.gate.showIndicator} slow={panel.slow} />;
    }
    if (panel.error) {
      return (
        <RetryEmptyState
          title="Could not load images"
          message={panel.error}
          retrying={panel.retrying}
          onRetry={panel.retry}
        />
      );
    }
    if (assets.length === 0) {
      return (
        <EmptyState
          icon={<i className="ti ti-photo" aria-hidden="true" />}
          title="No images yet"
          description="Upload one above to use as a {{name}} placeholder in email templates."
        />
      );
    }
    return (
      <>
        <p className="settings-card-intro">
          {assets.length} image{pluralSuffix(assets.length)}. Each one has a short name you can use
          in any email.
        </p>
        <div className="image-asset-library__grid">
          {assets.map((a) => {
            const src = brandingLogoImgSrc(a.url);
            return (
              <div key={a.id} className="image-asset-library__card">
                <div className="image-asset-library__card-thumb">
                  {src ? <img src={src} alt="" /> : <i className="ti ti-photo" aria-hidden="true" />}
                </div>
                <div className="image-asset-library__card-body">
                  <span className="image-asset-library__card-name" title={a.filename}>
                    {a.filename}
                  </span>
                  <span className="image-asset-library__card-size">{formatFileSize(a.size_bytes)}</span>
                  <span className="image-asset-library__token">{`{{${a.token}}}`}</span>
                  <div className="image-asset-library__card-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="image-asset-library__copy-btn"
                      title="Copy placeholder"
                      onClick={() => void copyToken(a.token)}
                      icon={<i className="ti ti-copy" aria-hidden="true" />}
                    >
                      Copy
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="image-asset-library__edit-btn"
                      title="Edit crop"
                      disabled={disabled}
                      onClick={() => openEditCrop(a)}
                      icon={<i className="ti ti-crop" aria-hidden="true" />}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="image-asset-library__delete-btn"
                      aria-label={`Remove ${a.filename}`}
                      disabled={disabled}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteBlockedByTemplate(false);
                        setConfirmDeleteId(a.id);
                      }}
                      icon={<i className="ti ti-trash" aria-hidden="true" />}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
      <Card title={<HintLabel hint={UPLOAD_IMAGES_HINT}>Upload images</HintLabel>} className="event-settings-card">
        <div className="settings-card-stack">
          <p className="settings-card-intro">
            Upload extra images such as sponsor logos. Give each one a name; Admitto creates the template variable for you.
          </p>
          <button
            type="button"
            className={[
              "image-asset-library__dropzone",
              dragging && "image-asset-library__dropzone--dragging",
              working && "image-asset-library__dropzone--busy",
              disabled && "image-asset-library__dropzone--disabled",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={disabled}
            onClick={openFilePicker}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (disabled || working) return;
              const dropped = e.dataTransfer.files[0];
              if (dropped) void handleFilePick(dropped);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!disabled && !working) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openFilePicker();
              }
            }}
          >
            <i className="ti ti-photo-up" aria-hidden="true" />
            <span className="image-asset-library__dropzone-title">
              {file ? file.name : "Drop image here or click to browse"}
            </span>
            <span className="image-asset-library__dropzone-hint">PNG, JPG, WebP · max 2 MB</span>
          </button>
          <div className="image-asset-library__name-block">
            <div className="mail-test-send__row">
              <div className="mail-test-send__controls">
                <Input
                  label="Image name"
                  value={displayName}
                  disabled={disabled || working}
                  maxLength={DISPLAY_NAME_MAX}
                  onChange={(e) => setDisplayName(clampDisplayName(e.target.value))}
                  onBlur={() => setDisplayNameTouched(true)}
                  placeholder="Sponsor logo"
                  invalid={Boolean(tokenErrorText)}
                />
                <div className="mail-test-send__send-control">
                  <Button
                    type="button"
                    variant="secondary"
                    aria-disabled={!canSubmit}
                    aria-describedby={!canSubmit && addReason ? addReasonId : undefined}
                    loading={adding}
                    loadingLabel="Adding…"
                    icon={<i className="ti ti-plus" aria-hidden="true" />}
                    onClick={() => void handleSubmit()}
                  >
                    Add image
                  </Button>
                  {!canSubmit && addReason && (
                    <span id={addReasonId} className="sr-only">
                      {addReason}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <ImageNameHint errorText={tokenErrorText} previewToken={previewToken} />
          </div>
          {formError ? (
            <Notice variant="error" role="alert">
              {formError}
            </Notice>
          ) : null}
          {disabled && (
            <p className="field-hint event-settings-archived-note">
              This event is archived - the image library cannot be changed.
            </p>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="image-asset-library__file-input"
          disabled={disabled || working}
          onChange={(e) => void handleFilePick(e.target.files?.[0] ?? null)}
          aria-label="Image file"
          aria-hidden="true"
          tabIndex={-1}
        />
      </Card>

      <Card title="Your images" className="event-settings-card">
        {renderAssetsList()}
      </Card>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title={deletingAsset ? `Remove "${deletingAsset.filename}"?` : "Remove image?"}
        message="Remove this image from the event?"
        confirmLabel="Remove"
        confirmVariant="danger"
        loading={deleting}
        errorMessage={deleteError}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setConfirmDeleteId(null);
          setDeleteError(null);
          setDeleteBlockedByTemplate(false);
        }}
      >
        {deletingAsset ? (
          <Notice variant="warning" role="alert">
            {deleteNoticeForAsset(deletingAsset, deleteBlockedByTemplate)}
          </Notice>
        ) : null}
      </ConfirmDialog>

      {pendingCrop ? (
        <CropImageModal
          open
          title="Adjust image"
          imageSrc={pendingCrop.imageSrc}
          sourceMime={pendingCrop.sourceMime}
          onCancel={() => {
            discardPreCropUpload();
            closePendingCrop();
            if (fileRef.current) fileRef.current.value = "";
          }}
          onApply={(blob, meta) => {
            const outMime = resolveCropOutputMime(pendingCrop.sourceMime);
            const base = pendingCrop.originalName.replace(/\.[^.]+$/, "") || "asset";
            setFile(new File([blob], `${base}${extensionForMime(outMime)}`, { type: outMime }));
            setPendingOriginal({ url: pendingCrop.imageSrc, crop: toLogoCropMeta(meta) });
            closePendingCrop();
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
      ) : null}

      {editSession ? (
        <CropImageModal
          open
          title="Adjust image"
          imageSrc={editSession.imageSrc}
          sourceMime={editSession.sourceMime}
          initialCrop={editSession.initialCrop}
          initialZoom={editSession.initialZoom}
          onCancel={() => setEditSession(null)}
          onApply={async (blob, meta) => {
            const outMime = resolveCropOutputMime(editSession.sourceMime);
            const file = new File([blob], `${editSession.filenameBase}${extensionForMime(outMime)}`, {
              type: outMime,
            });
            try {
              const updated = await updateEventImageAsset(
                eventId,
                editSession.assetId,
                file,
                toLogoCropMeta(meta),
              );
              setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
              setEditSession(null);
              addToast(`Updated "${updated.filename}"`, "success", 2500);
            } catch (err) {
              throw new Error(operatorApiErrorMessage(err, "Could not update image."));
            }
          }}
        />
      ) : null}
    </>
  );
}
