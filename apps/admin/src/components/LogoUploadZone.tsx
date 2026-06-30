import { useRef, useState } from "react";
import { ApiError, uploadFile } from "../api/client.js";
import "./logo-upload.css";

export interface LogoUploadZoneProps {
  value: string;
  onChange: (url: string) => void;
  onDirty?: () => void;
}

/** Drop zone + optional HTTPS URL fallback for organisation logo upload. */
export function LogoUploadZone({ value, onChange, onDirty }: LogoUploadZoneProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);

  const isUploadedFile = value.startsWith("/uploads/");

  const handleFile = async (file: File) => {
    setError(null);
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
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="logo-upload">
      <span className="at-label">Organisation logo</span>
      {value && (
        <div className="logo-upload__preview">
          <img src={value} alt="Organisation logo preview" className="logo-upload__img" />
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
          className={`logo-upload__zone${uploading ? " logo-upload__zone--busy" : ""}`}
          onDrop={(e) => void onDrop(e)}
          onDragOver={(e) => e.preventDefault()}
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
        {showUrlInput ? "Hide URL field" : "Or enter image URL instead"}
      </button>
      {showUrlInput && (
        <div className="at-field">
          <label className="at-label" htmlFor="logo-url-fallback">
            Logo URL (HTTPS)
          </label>
          <input
            id="logo-url-fallback"
            className="at-input"
            type="url"
            value={isUploadedFile ? "" : value}
            onChange={(e) => {
              onChange(e.target.value);
              onDirty?.();
            }}
            placeholder="https://example.com/logo.png"
          />
        </div>
      )}
    </div>
  );
}
