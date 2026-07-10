import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@admitto/ui";
import { ApiError, uploadFile } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { brandingLogoImgSrc } from "../utils/safeBrandingLogoHref.js";
import "./logo-upload.css";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export interface LogoUploadZoneProps {
  readonly value: string;
  readonly onChange: (url: string) => void;
  readonly onDirty?: () => void;
  /** Field label above the drop zone. Defaults to "Organisation logo" for the existing usage. */
  readonly label?: string;
  /** Format/size hint line under the drop zone. Defaults to the square-logo recommendation. */
  readonly hint?: string;
  /** Custom upload function (e.g. event-scoped upload). Defaults to the org-level upload endpoint. */
  readonly uploadFn?: (formData: FormData) => Promise<{ url: string }>;
  /** Disables all interaction (e.g. archived event). Defaults to false — org branding is never disabled. */
  readonly disabled?: boolean;
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

/** Upload to server or link an external HTTPS image — both are supported. */
export function LogoUploadZone({
  value,
  onChange,
  onDirty,
  label = "Organisation logo",
  hint = "PNG, JPG, WebP · max 2 MB · recommended 160×48 px",
  uploadFn = uploadFile,
  disabled = false,
}: LogoUploadZoneProps) {
  const urlInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadSeqRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [zoneError, setZoneError] = useState<string | null>(null);

  const isUploadedFile = value.startsWith("/uploads/");
  const previewSrc = useMemo(() => brandingLogoImgSrc(value), [value]);
  const [previewFailed, setPreviewFailed] = useState(false);
  const showPreview = Boolean(previewSrc) && !previewFailed;

  useEffect(() => {
    setPreviewFailed(false);
    if (previewSrc) setZoneError(null);
  }, [previewSrc]);

  const clearLogo = () => {
    uploadSeqRef.current += 1;
    setZoneError(null);
    setPreviewFailed(false);
    onChange("");
    onDirty?.();
  };

  const handleFile = async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      setZoneError("File must be 2 MB or smaller.");
      return;
    }
    const seq = ++uploadSeqRef.current;
    setZoneError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadFn(fd);
      if (seq !== uploadSeqRef.current) return;
      onChange(result.url);
      onDirty?.();
    } catch (err) {
      if (seq !== uploadSeqRef.current) return;
      setZoneError(operatorApiErrorMessage(err, "Upload failed."));
    } finally {
      if (seq === uploadSeqRef.current) setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const openFilePicker = () => {
    if (!uploading && !disabled) fileRef.current?.click();
  };

  return (
    <div className="logo-upload">
      <span className="at-label">{label}</span>
      <p className="logo-upload__intro">
        Upload a file to this server, or use an image hosted elsewhere (HTTPS).
      </p>
      <div
        className={[
          "logo-upload__zone",
          uploading && "logo-upload__zone--busy",
          dragging && "logo-upload__zone--dragging",
          previewSrc && showPreview && "logo-upload__zone--has-preview",
          zoneError && "logo-upload__zone--invalid",
          disabled && "logo-upload__zone--disabled",
        ]
          .filter(Boolean)
          .join(" ")}
        onDrop={(e) => void onDrop(e)}
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
              onChange("");
              onDirty?.();
            }}
            onRemove={clearLogo}
          />
        ) : (
          <>
            <i className="ti ti-photo-up" aria-hidden="true" />
            <span>{uploading ? "Uploading…" : "Drop logo here or click to browse"}</span>
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
            if (f) void handleFile(f);
            e.target.value = "";
          }}
          disabled={uploading || disabled}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>
      {zoneError ? (
        <p className="at-hint at-hint--error" role="alert">
          {zoneError}
        </p>
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          icon={<i className={showUrlInput ? "ti ti-chevron-up" : "ti ti-link"} aria-hidden="true" />}
          onClick={() => setShowUrlInput((v) => !v)}
        >
          {showUrlInput ? "Hide external URL" : "Use external HTTPS URL"}
        </Button>
      </div>
      {showUrlInput && (
        <div className="at-field">
          <label className="at-label" htmlFor={urlInputId}>
            External logo URL (HTTPS)
          </label>
          <input
            id={urlInputId}
            className="at-input"
            type="url"
            value={isUploadedFile ? "" : value}
            disabled={disabled}
            onChange={(e) => {
              onChange(e.target.value);
              onDirty?.();
            }}
            placeholder="https://cdn.example.com/logo.png"
          />
        </div>
      )}
    </div>
  );
}
