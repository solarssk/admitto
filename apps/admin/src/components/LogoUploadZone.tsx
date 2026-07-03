import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@admitto/ui";
import { ApiError, uploadFile } from "../api/client.js";
import { brandingLogoImgSrc } from "../utils/safeBrandingLogoHref.js";
import "./logo-upload.css";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export interface LogoUploadZoneProps {
  value: string;
  onChange: (url: string) => void;
  onDirty?: () => void;
}

/** Upload to server or link an external HTTPS image — both are supported. */
export function LogoUploadZone({ value, onChange, onDirty }: LogoUploadZoneProps) {
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
      const result = await uploadFile(fd);
      if (seq !== uploadSeqRef.current) return;
      onChange(result.url);
      onDirty?.();
    } catch (err) {
      if (seq !== uploadSeqRef.current) return;
      setZoneError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      if (seq === uploadSeqRef.current) setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const openFilePicker = () => {
    if (!uploading) fileRef.current?.click();
  };

  return (
    <div className="logo-upload">
      <span className="at-label">Organisation logo</span>
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
        ]
          .filter(Boolean)
          .join(" ")}
        onDrop={(e) => void onDrop(e)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onClick={() => {
          if (!showPreview) openFilePicker();
        }}
        role={showPreview ? undefined : "button"}
        tabIndex={showPreview ? undefined : 0}
        onKeyDown={(e) => {
          if (!showPreview && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openFilePicker();
          }
        }}
      >
        {showPreview ? (
          <>
            <div className="logo-upload__preview-inner">
              <img
                src={previewSrc!}
                alt="Organisation logo preview"
                className="logo-upload__img"
                onError={() => {
                  if (!isUploadedFile) {
                    setZoneError(
                      "Could not load logo preview from this URL. Check the link or try again later.",
                    );
                    setPreviewFailed(true);
                    return;
                  }
                  setZoneError(
                    "Uploaded file appears corrupt or unsupported. Please try another image.",
                  );
                  uploadSeqRef.current += 1;
                  setPreviewFailed(false);
                  onChange("");
                  onDirty?.();
                }}
              />
            </div>
            <button
              type="button"
              className="logo-upload__clear"
              aria-label="Remove logo"
              onClick={(e) => {
                e.stopPropagation();
                clearLogo();
              }}
            >
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <i className="ti ti-photo-up" aria-hidden="true" />
            <span>{uploading ? "Uploading…" : "Drop logo here or click to browse"}</span>
            <span className="logo-upload__hint">PNG, JPG, WebP · max 2 MB · recommended 160×48 px</span>
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
          disabled={uploading}
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
            disabled={uploading}
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
          icon={<i className={showUrlInput ? "ti ti-chevron-up" : "ti ti-link"} aria-hidden="true" />}
          onClick={() => setShowUrlInput((v) => !v)}
        >
          {showUrlInput ? "Hide external URL" : "Use external HTTPS URL"}
        </Button>
      </div>
      {showUrlInput && (
        <div className="at-field">
          <label className="at-label" htmlFor="logo-url-external">
            External logo URL (HTTPS)
          </label>
          <input
            id="logo-url-external"
            className="at-input"
            type="url"
            value={isUploadedFile ? "" : value}
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
