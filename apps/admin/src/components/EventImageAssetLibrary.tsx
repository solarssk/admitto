import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Card, EmptyState, Input, useToast } from "@admitto/ui";
import { createEventImageAsset, deleteEventImageAsset, fetchEventImageAssets } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventImageAssetDto } from "../api/types.js";
import { brandingLogoImgSrc } from "../utils/safeBrandingLogoHref.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import "./event-image-asset-library.css";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const TOKEN_MAX_LENGTH = 40;
const TOKEN_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface EventImageAssetLibraryProps {
  readonly eventId: string;
  /** Disables uploading and deleting assets (e.g. archived event). Viewing the list stays allowed. */
  readonly disabled?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

/**
 * Named branding image library for an event: upload extra images (e.g. sponsor logos) and give
 * each one a short token, then use `{{token}}` in an email template's body to insert it.
 */
export function EventImageAssetLibrary({ eventId, disabled = false }: EventImageAssetLibraryProps) {
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<EventImageAssetDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [token, setToken] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tokenTouched, setTokenTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [dragging, setDragging] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    setLoadError(null);
    fetchEventImageAssets(eventId, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        setAssets(items);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoadError(operatorApiErrorMessage(err, "Could not load image assets."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [eventId]);

  useEffect(() => {
    load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  const tokenTrimmed = token.trim();
  const tokenValid =
    tokenTrimmed.length > 0 && tokenTrimmed.length <= TOKEN_MAX_LENGTH && TOKEN_PATTERN.test(tokenTrimmed);
  const tokenErrorText =
    tokenTouched && tokenTrimmed && !tokenValid
      ? "Must start with a letter, and use only lowercase letters, numbers, and underscores (max 40 characters)."
      : undefined;
  const canSubmit = Boolean(file) && tokenValid && !uploading && !disabled;

  const resetForm = () => {
    setToken("");
    setTokenTouched(false);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFilePick = (picked: File | null) => {
    setFormError(null);
    if (picked && picked.size > MAX_UPLOAD_BYTES) {
      setFormError("File must be 2 MB or smaller.");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(picked);
  };

  const openFilePicker = () => {
    if (!disabled && !uploading) fileRef.current?.click();
  };

  const handleSubmit = async () => {
    if (!file || !tokenValid) return;
    setUploading(true);
    setFormError(null);
    try {
      const created = await createEventImageAsset(eventId, file, tokenTrimmed);
      setAssets((prev) => [...prev, created]);
      resetForm();
      addToast(`Added {{${created.token}}}`, "success", 2500);
    } catch (err) {
      setFormError(operatorApiErrorMessage(err, "Could not add asset."));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteEventImageAsset(eventId, confirmDeleteId);
      setAssets((prev) => prev.filter((a) => a.id !== confirmDeleteId));
      setConfirmDeleteId(null);
    } catch (err) {
      setDeleteError(operatorApiErrorMessage(err, "Could not delete asset."));
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

  const deletingAsset = assets.find((a) => a.id === confirmDeleteId) ?? null;

  function renderAssetsList(): ReactNode {
    if (loading) return <p className="field-hint">Loading assets…</p>;
    if (loadError) {
      return (
        <EmptyState
          title="Could not load image assets"
          description={loadError}
          action={
            <Button type="button" variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      );
    }
    if (assets.length === 0) {
      return (
        <p className="field-hint">
          No image assets yet. Upload one above to use it as a placeholder in email templates.
        </p>
      );
    }
    return (
      <>
        <p className="field-hint">
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
                      className="image-asset-library__delete-btn"
                      aria-label={`Delete ${a.filename}`}
                      disabled={disabled}
                      onClick={() => {
                        setDeleteError(null);
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
      <Card title="Upload images" className="event-settings-card">
        <p className="field-hint">
          Upload extra images (like sponsor logos) and give each one a short name. Use{" "}
          <code>{"{{name}}"}</code> in an email template to add it.
        </p>
        <div
          className={[
            "image-asset-library__dropzone",
            dragging && "image-asset-library__dropzone--dragging",
            uploading && "image-asset-library__dropzone--busy",
            disabled && "image-asset-library__dropzone--disabled",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={openFilePicker}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (disabled || uploading) return;
            const dropped = e.dataTransfer.files[0];
            if (dropped) handleFilePick(dropped);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled && !uploading) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          role="button"
          tabIndex={disabled ? undefined : 0}
          aria-disabled={disabled || undefined}
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
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="image-asset-library__file-input"
            disabled={disabled || uploading}
            onChange={(e) => handleFilePick(e.target.files?.[0] ?? null)}
            aria-label="Image file"
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>
        <div className="image-asset-library__add-fields">
          <div className="image-asset-library__token-field">
            <Input
              label="Name"
              value={token}
              disabled={disabled || uploading}
              onChange={(e) => setToken(e.target.value)}
              onBlur={() => setTokenTouched(true)}
              placeholder="sponsor_logo"
              error={tokenErrorText}
              hint={
                tokenErrorText
                  ? undefined
                  : "Lowercase letters, numbers, and underscores only. Used as {{name}} in email templates."
              }
            />
          </div>
          <div className="image-asset-library__add-btn-wrap">
            <span className="at-label image-asset-library__add-btn-spacer" aria-hidden="true">
              &nbsp;
            </span>
            <Button type="button" variant="secondary" disabled={!canSubmit} onClick={() => void handleSubmit()}>
              {uploading ? "Adding…" : "Add asset"}
            </Button>
          </div>
        </div>
        {formError ? (
          <p className="at-hint at-hint--error" role="alert">
            {formError}
          </p>
        ) : null}
        {disabled && (
          <p className="field-hint event-settings-archived-note">
            This event is archived - the asset library cannot be changed.
          </p>
        )}
      </Card>

      <Card title="Your images" className="event-settings-card">
        {renderAssetsList()}
      </Card>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete image asset"
        message={
          deletingAsset
            ? `Delete "${deletingAsset.filename}"? If its {{${deletingAsset.token}}} placeholder is still used in this event's email template, deletion will be blocked until you remove it from the template.`
            : "Delete this image asset?"
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
        errorMessage={deleteError}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setConfirmDeleteId(null);
          setDeleteError(null);
        }}
      />
    </>
  );
}
