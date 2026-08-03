import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PercentCrop } from "react-image-crop";
import { Button, useToast } from "@admitto/ui";
import type { LogoCropMeta } from "../api/types.js";
import { uploadFile } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { brandingLogoImgSrc } from "../utils/safeBrandingLogoHref.js";
import { CropImageModal, type CropApplyMeta } from "./crop/CropImageModal.js";
import { resolveCropOutputMime } from "./crop/getCroppedImageBlob.js";
import {
  ALLOWED_BRANDING_IMAGE_TYPES,
  extensionForBrandingImageMime,
  MAX_BRANDING_IMAGE_UPLOAD_BYTES,
} from "./brandingImageConstraints.js";
import "./logo-upload.css";

const MAX_UPLOAD_BYTES = MAX_BRANDING_IMAGE_UPLOAD_BYTES;
const ALLOWED_IMAGE_TYPES = ALLOWED_BRANDING_IMAGE_TYPES;

export type LogoSourceChange = {
  originalUrl: string | null;
  crop: LogoCropMeta | null;
};

export interface LogoUploadZoneProps {
  /** Display logo URL (cropped upload or external https). */
  readonly value: string;
  /** Full pre-crop upload URL for re-Edit after reload (`/uploads/…`). */
  readonly originalUrl?: string | null;
  /** Last crop framing stored with the logo. */
  readonly cropMeta?: LogoCropMeta | null;
  readonly onChange: (url: string) => void;
  /** Fired whenever original/crop change (Apply, clear, external link). */
  readonly onSourceChange?: (source: LogoSourceChange) => void;
  readonly onDirty?: () => void;
  /** Field label above the drop zone. Defaults to "Organisation logo" for the existing usage. */
  readonly label?: string;
  /** Hides the visible label heading while still using `label` for alt text and the "Remove"
   * button's accessible name. Use when a parent already establishes context (e.g. a card title
   * and description right above), so the heading isn't a redundant repeat of "logo". */
  readonly hideLabel?: boolean;
  /** Format/size hint line under the drop zone. Defaults to the square-logo recommendation. */
  readonly hint?: string;
  /** Custom upload function (e.g. event-scoped upload). Defaults to the org-level upload endpoint. */
  readonly uploadFn?: (formData: FormData) => Promise<{ url: string }>;
  /** Disables all interaction (e.g. archived event). Defaults to false — org branding is never disabled. */
  readonly disabled?: boolean;
  /** Notified whenever an upload starts/finishes, so a caller can e.g. block Save while one is in flight. */
  readonly onUploadingChange?: (uploading: boolean) => void;
}

interface LogoPreviewProps {
  readonly label: string;
  readonly previewSrc: string;
  readonly isUploadedFile: boolean;
  readonly disabled: boolean;
  readonly onExternalUrlFailed: () => void;
  readonly onUploadedFileCorrupt: () => void;
  readonly onRemove: () => void;
}

type CropSession = {
  /** Same-origin `/uploads/…` URL (never `blob:` from File — CodeQL FilesSource barrier). */
  imageSrc: string;
  sourceMime: string;
  filename: string;
  /** Local file still needed when Apply must upload the original; null when already on server. */
  pendingFile: File | null;
  /** Set when the original was already uploaded (pick or prior Apply). */
  uploadedOriginalUrl: string;
  /** Restore framing from the last Apply. */
  initialCrop?: PercentCrop;
  initialZoom?: number;
};

/** Full pre-crop file kept so Edit can re-open the original without re-fetching mid-session. */
type SourceOriginal = {
  file: File;
  mime: string;
  lastCrop?: PercentCrop;
  lastZoom?: number;
};

/** Preview image with its two distinct failure modes, plus the remove button. */
function LogoPreview({
  label,
  previewSrc,
  isUploadedFile,
  disabled,
  onExternalUrlFailed,
  onUploadedFileCorrupt,
  onRemove,
}: LogoPreviewProps) {
  return (
    <>
      <div className="logo-upload__preview-inner">
        <img
          src={previewSrc}
          alt={`${label} preview`}
          className="logo-upload__img"
          onError={() => (isUploadedFile ? onUploadedFileCorrupt() : onExternalUrlFailed())}
        />
      </div>
      <button
        type="button"
        className="logo-upload__clear"
        aria-label={`Remove ${label.toLowerCase()}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </>
  );
}

interface LogoZoneClassNameFlags {
  readonly uploading: boolean;
  readonly dragging: boolean;
  readonly hasPreview: boolean;
  readonly hasError: boolean;
  readonly disabled: boolean;
}

function buildLogoZoneClassName({
  uploading,
  dragging,
  hasPreview,
  hasError,
  disabled,
}: LogoZoneClassNameFlags): string {
  return [
    "logo-upload__zone",
    uploading && "logo-upload__zone--busy",
    dragging && "logo-upload__zone--dragging",
    hasPreview && "logo-upload__zone--has-preview",
    hasError && "logo-upload__zone--invalid",
    disabled && "logo-upload__zone--disabled",
  ]
    .filter(Boolean)
    .join(" ");
}

function extensionForMime(mime: string): string {
  return extensionForBrandingImageMime(mime);
}

function mimeFromUploadPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function cropMetaToPercent(meta: LogoCropMeta | null | undefined): PercentCrop | undefined {
  if (meta?.unit !== "%") return undefined;
  return { unit: "%", x: meta.x, y: meta.y, width: meta.width, height: meta.height };
}

function toLogoCropMeta(meta: CropApplyMeta): LogoCropMeta {
  return {
    unit: "%",
    x: meta.crop.x,
    y: meta.crop.y,
    width: meta.crop.width,
    height: meta.crop.height,
    zoom: meta.zoom,
  };
}

/** @internal Unit-test surface for MIME/path helpers (keeps branch coverage explicit). */
export const logoUploadZoneTestUtils = {
  extensionForMime,
  mimeFromUploadPath,
  cropMetaToPercent,
  toLogoCropMeta,
  buildLogoZoneClassName,
};

async function postUpload(
  uploadFn: (formData: FormData) => Promise<{ url: string }>,
  blob: Blob,
  filename: string,
): Promise<string> {
  const fd = new FormData();
  fd.append("file", new File([blob], filename, { type: blob.type || "image/png" }));
  const result = await uploadFn(fd);
  return result.url;
}

/** Upload to server or link an external HTTPS image — both are supported. */
export function LogoUploadZone({
  value,
  originalUrl = null,
  cropMeta = null,
  onChange,
  onSourceChange,
  onDirty,
  label = "Organisation logo",
  hideLabel = false,
  hint = "PNG, JPG, WebP · max 2 MB · recommended 160×48 px",
  uploadFn = uploadFile,
  disabled = false,
  onUploadingChange,
}: LogoUploadZoneProps) {
  const { addToast } = useToast();
  const urlInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadSeqRef = useRef(0);
  /** Display URL we last wrote via Apply — keeps session original across parent re-renders. */
  const lastUploadedUrlRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [cropSession, setCropSession] = useState<CropSession | null>(null);
  const [sourceOriginal, setSourceOriginal] = useState<SourceOriginal | null>(null);

  const isUploadedFile = value.startsWith("/uploads/");
  const previewSrc = useMemo(() => brandingLogoImgSrc(value), [value]);
  const [previewFailed, setPreviewFailed] = useState(false);
  const showPreview = Boolean(previewSrc) && !previewFailed;

  useEffect(() => {
    onUploadingChange?.(uploading);
  }, [uploading, onUploadingChange]);

  useEffect(() => {
    setPreviewFailed(false);
    if (previewSrc) setZoneError(null);
  }, [previewSrc]);

  // Display URL changed from outside this zone's last Apply — drop the in-memory File.
  useEffect(() => {
    if (value !== lastUploadedUrlRef.current) {
      setSourceOriginal(null);
    }
  }, [value]);

  const closeCropSession = () => {
    setCropSession(null);
  };

  const clearLogo = () => {
    uploadSeqRef.current += 1;
    lastUploadedUrlRef.current = null;
    setSourceOriginal(null);
    setZoneError(null);
    setPreviewFailed(false);
    closeCropSession();
    onChange("");
    onSourceChange?.({ originalUrl: null, crop: null });
    onDirty?.();
  };

  const applyCroppedAndOriginal = async (
    cropped: Blob,
    filenameBase: string,
    applyMeta: CropApplyMeta,
    originalFile: File | null,
    existingOriginalUrl: string,
  ) => {
    const seq = ++uploadSeqRef.current;
    setZoneError(null);
    setUploading(true);
    try {
      const sourceMime =
        originalFile?.type.split(";")[0]?.trim().toLowerCase() ||
        mimeFromUploadPath(existingOriginalUrl);
      const outMime = resolveCropOutputMime(sourceMime || "image/png");
      const croppedName = `${filenameBase}${extensionForMime(outMime)}`;

      // Original was uploaded before the crop modal opened (CodeQL: no File→blob:→img.src).
      const originalUploadedUrl = existingOriginalUrl;

      const croppedUrl = await postUpload(
        uploadFn,
        new File([cropped], croppedName, { type: cropped.type || outMime }),
        croppedName,
      );
      if (seq !== uploadSeqRef.current) return;

      const crop = toLogoCropMeta(applyMeta);
      lastUploadedUrlRef.current = croppedUrl;
      if (originalFile) {
        setSourceOriginal({
          file: originalFile,
          mime: sourceMime || "image/png",
          lastCrop: applyMeta.crop,
          lastZoom: applyMeta.zoom,
        });
      } else {
        setSourceOriginal((prev) =>
          prev
            ? { ...prev, lastCrop: applyMeta.crop, lastZoom: applyMeta.zoom }
            : prev,
        );
      }
      onChange(croppedUrl);
      onSourceChange?.({ originalUrl: originalUploadedUrl, crop });
      onDirty?.();
      closeCropSession();
    } catch (err) {
      if (seq !== uploadSeqRef.current) return;
      setZoneError(operatorApiErrorMessage(err, "Upload failed."));
      closeCropSession();
    } finally {
      if (seq === uploadSeqRef.current) setUploading(false);
    }
  };

  /** Upload the original first, then open crop on the `/uploads/…` URL (no File→blob:→img.src). */
  const openCropForFile = async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      setZoneError("File must be 2 MB or smaller.");
      return;
    }
    const declared = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_IMAGE_TYPES.has(declared)) {
      setZoneError("Use a PNG, JPG, or WebP image.");
      return;
    }
    const seq = ++uploadSeqRef.current;
    setZoneError(null);
    setUploading(true);
    try {
      const filename = file.name || `logo${extensionForMime(declared)}`;
      const base = filename.replace(/\.[^.]+$/, "") || "logo";
      const originalName = `${base}-original${extensionForMime(declared)}`;
      const url = await postUpload(uploadFn, file, originalName);
      if (seq !== uploadSeqRef.current) return;
      setCropSession({
        imageSrc: url,
        sourceMime: declared,
        filename,
        pendingFile: file,
        uploadedOriginalUrl: url,
      });
    } catch (err) {
      if (seq !== uploadSeqRef.current) return;
      setZoneError(operatorApiErrorMessage(err, "Upload failed."));
    } finally {
      if (seq === uploadSeqRef.current) setUploading(false);
    }
  };

  const openCropForEdit = () => {
    if (!isUploadedFile || !previewSrc || disabled || uploading) return;
    setZoneError(null);

    if (originalUrl?.startsWith("/uploads/")) {
      const mime = sourceOriginal?.mime ?? mimeFromUploadPath(originalUrl);
      setCropSession({
        imageSrc: originalUrl,
        sourceMime: mime,
        filename: sourceOriginal?.file.name || `logo${extensionForMime(mime)}`,
        pendingFile: sourceOriginal?.file ?? null,
        uploadedOriginalUrl: originalUrl,
        initialCrop: sourceOriginal?.lastCrop ?? cropMetaToPercent(cropMeta),
        initialZoom: sourceOriginal?.lastZoom ?? cropMeta?.zoom,
      });
      return;
    }

    addToast(
      "The original image is not available for this logo. Choose the full file again to re-crop.",
      "info",
      4500,
    );
    fileRef.current?.click();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) void openCropForFile(file);
  };

  const openFilePicker = () => {
    if (!uploading && !disabled) fileRef.current?.click();
  };

  return (
    <div className="logo-upload">
      {!hideLabel && <span className="at-label">{label}</span>}
      <p className={hideLabel ? "settings-card-intro" : "at-hint"}>
        Upload an image file below, or use a link to an image that&apos;s already online. You can
        trim margins before saving.
      </p>
      <div
        className={buildLogoZoneClassName({
          uploading,
          dragging,
          hasPreview: showPreview,
          hasError: zoneError !== null,
          disabled,
        })}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onClick={() => {
          if (!showPreview) openFilePicker();
        }}
        role={showPreview ? undefined : "button"}
        tabIndex={showPreview || disabled ? undefined : 0}
        aria-disabled={disabled || undefined}
        onKeyDown={(e) => {
          if (!showPreview && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openFilePicker();
          }
        }}
      >
        {showPreview ? (
          <LogoPreview
            label={label}
            previewSrc={previewSrc!}
            isUploadedFile={isUploadedFile}
            disabled={disabled}
            onExternalUrlFailed={() => {
              setZoneError(
                "Could not load logo preview from this URL. Check the link or try again later.",
              );
              setPreviewFailed(true);
            }}
            onUploadedFileCorrupt={() => {
              setZoneError("Uploaded file appears corrupt or unsupported. Please try another image.");
              uploadSeqRef.current += 1;
              setPreviewFailed(false);
              lastUploadedUrlRef.current = null;
              setSourceOriginal(null);
              onChange("");
              onSourceChange?.({ originalUrl: null, crop: null });
              onDirty?.();
            }}
            onRemove={clearLogo}
          />
        ) : (
          <>
            <i className="ti ti-photo-up" aria-hidden="true" />
            <span className="logo-upload__zone-title">
              {uploading ? "Uploading…" : "Drop logo here or click to browse"}
            </span>
            <span className="logo-upload__hint">{hint}</span>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="logo-upload__file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openCropForFile(f);
            e.target.value = "";
          }}
          disabled={uploading || disabled}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>
      {zoneError ? (
        <span className="at-hint at-hint--error" role="alert">
          {zoneError}
        </span>
      ) : null}
      <div className="logo-upload__actions">
        {showPreview ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploading || disabled}
            icon={<i className="ti ti-refresh" aria-hidden="true" />}
            onClick={openFilePicker}
          >
            Replace image
          </Button>
        ) : null}
        {showPreview && isUploadedFile ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploading || disabled}
            icon={<i className="ti ti-crop" aria-hidden="true" />}
            onClick={openCropForEdit}
          >
            Edit image
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          icon={<i className={showUrlInput ? "ti ti-chevron-up" : "ti ti-link"} aria-hidden="true" />}
          onClick={() => setShowUrlInput((v) => !v)}
        >
          {showUrlInput ? "Hide web link" : "Use a web link instead"}
        </Button>
      </div>
      {showUrlInput && (
        <div className="at-field">
          <label className="at-label" htmlFor={urlInputId}>
            Web link to your logo (must start with https://)
          </label>
          <input
            id={urlInputId}
            className="at-input"
            type="url"
            value={isUploadedFile ? "" : value}
            disabled={disabled}
            onChange={(e) => {
              lastUploadedUrlRef.current = null;
              setSourceOriginal(null);
              onChange(e.target.value);
              onSourceChange?.({ originalUrl: null, crop: null });
              onDirty?.();
            }}
            placeholder="https://cdn.example.com/logo.png"
          />
        </div>
      )}
      {cropSession ? (
        <CropImageModal
          open
          title={`Adjust ${label.toLowerCase()}`}
          imageSrc={cropSession.imageSrc}
          sourceMime={cropSession.sourceMime}
          initialCrop={cropSession.initialCrop}
          initialZoom={cropSession.initialZoom}
          onCancel={closeCropSession}
          onApply={async (blob, meta) => {
            const base =
              cropSession.filename.replace(/\.[^.]+$/, "") ||
              label.toLowerCase().replaceAll(/\s+/g, "-") ||
              "logo";
            await applyCroppedAndOriginal(
              blob,
              base,
              meta,
              cropSession.pendingFile,
              cropSession.uploadedOriginalUrl,
            );
          }}
        />
      ) : null}
    </div>
  );
}
