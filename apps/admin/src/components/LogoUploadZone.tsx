import { useMemo, useRef, useState } from "react";
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [dragging, setDragging] = useState(false);

  const isUploadedFile = value.startsWith("/uploads/");
  const previewSrc = useMemo(() => brandingLogoImgSrc(value), [value]);

  const handleFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("File must be 2 MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadFile(fd);
      onChange(result.url);
      onDirty?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="logo-upload">
      <span className="at-label">Organisation logo</span>
      <p className="logo-upload__intro">
        Upload a file to this server, or use an image hosted elsewhere (HTTPS).
      </p>
      {previewSrc && (
        <div className="logo-upload__preview">
          <img
            src={previewSrc}
            alt="Organisation logo preview"
            className="logo-upload__img"
            onError={() => {
              onChange("");
              onDirty?.();
              setError("Uploaded file appears corrupt or unsupported. Please try another image.");
            }}
          />
          <button
            type="button"
            className="logo-upload__clear"
            aria-label="Remove logo"
            onClick={() => {
              onChange("");
              onDirty?.();
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      )}
      {!value && (
        <div
          className={[
            "logo-upload__zone",
            uploading && "logo-upload__zone--busy",
            dragging && "logo-upload__zone--dragging",
          ]
            .filter(Boolean)
            .join(" ")}
          onDrop={(e) => void onDrop(e)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
        >
          <i className="ti ti-photo-up" aria-hidden="true" />
          <span>{uploading ? "Uploading…" : "Drop logo here or click to browse"}</span>
          <span className="logo-upload__hint">PNG, JPG, WebP · max 2 MB · recommended 160×48 px</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="logo-upload__file-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
            disabled={uploading}
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>
      )}
      {error && (
        <p className="text-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="logo-upload__toggle"
        onClick={() => setShowUrlInput((v) => !v)}
      >
        {showUrlInput ? "Hide external URL" : "Use external HTTPS URL"}
      </button>
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
