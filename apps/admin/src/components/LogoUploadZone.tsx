import { useMemo, useRef, useState } from "react";
import { Button, useToast } from "@admitto/ui";
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
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [dragging, setDragging] = useState(false);

  const isUploadedFile = value.startsWith("/uploads/");
  const previewSrc = useMemo(() => brandingLogoImgSrc(value), [value]);

  const handleFile = async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      addToast("File must be 2 MB or smaller.", "error");
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
      addToast(err instanceof ApiError ? err.message : "Upload failed.", "error");
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
          previewSrc && "logo-upload__zone--has-preview",
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
          if (!previewSrc) openFilePicker();
        }}
        role={previewSrc ? undefined : "button"}
        tabIndex={previewSrc ? undefined : 0}
        onKeyDown={(e) => {
          if (!previewSrc && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openFilePicker();
          }
        }}
      >
        {previewSrc ? (
          <>
            <div className="logo-upload__preview-inner">
              <img
                src={previewSrc}
                alt="Organisation logo preview"
                className="logo-upload__img"
                onError={() => {
                  if (!isUploadedFile) {
                    addToast(
                      "Could not load logo preview from this URL. Check the link or try again later.",
                      "error",
                    );
                    return;
                  }
                  addToast(
                    "Uploaded file appears corrupt or unsupported. Please try another image.",
                    "error",
                  );
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
                onChange("");
                onDirty?.();
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
      <div className="logo-upload__actions">
        {previewSrc ? (
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
