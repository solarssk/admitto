import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, ModalBackdrop, Tooltip } from "@admitto/ui";
import type { MailTemplateListItem } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
import { IconPicker } from "../requirements/IconPicker.js";
import { DEFAULT_TEMPLATE_ICON, TEMPLATE_ICONS } from "./templateIcons.js";
import "../attendees/add-attendee-modal.css";

/** Identity-only draft - label/icon/description, never subject/body/format. */
export interface EditTemplateDraft {
  label: string;
  icon: string | null;
  description: string | null;
}

export interface EditTemplateModalProps {
  open: boolean;
  template: MailTemplateListItem | null;
  /** Localized timestamp from the event's timezone, available after opening the pencil dialog
   * for touch users who cannot inspect the toolbar hover tooltip. */
  lastEdited?: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (templateId: string, draft: EditTemplateDraft) => void;
  onDelete: (templateId: string) => void;
}

/** Rename/re-icon/describe a saved template, with delete nested at the bottom - the picker bar's
 * pencil button is the only entry point for both, now that identity edits and content edits (the
 * main subject/body editor) are separate concerns. */
export function EditTemplateModal({
  open,
  template,
  lastEdited = null,
  busy,
  onClose,
  onSave,
  onDelete,
}: Readonly<EditTemplateModalProps>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef, open);
  const submittingRef = useRef(false);

  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useModalFocusTrap(panelRef, open && !deleteConfirmOpen, onClose);

  useEffect(() => {
    if (!open || !template) {
      submittingRef.current = false;
      setDeleteConfirmOpen(false);
      return;
    }
    setLabel(template.label);
    setIcon(template.icon);
    setDescription(template.description ?? "");
    setError(null);
  }, [open, template]);

  useEffect(() => {
    if (!busy) submittingRef.current = false;
  }, [busy]);

  if (!open || !template) return null;

  const canDelete = template.name !== "ticket";
  const dirty =
    label.trim() !== template.label ||
    icon !== template.icon ||
    (description.trim() || null) !== template.description;

  const submit = () => {
    if (busy || submittingRef.current) return;
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Enter a template label.");
      return;
    }
    submittingRef.current = true;
    onSave(template.id, { label: trimmed, icon, description: description.trim() || null });
  };

  return (
    <dialog className="add-attendee-modal" open aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop onClose={busy ? undefined : onClose} />
      <div className="add-attendee-modal__panel" ref={panelRef}>
        <div className="add-attendee-modal__scroll at-scroll" ref={scrollRef}>
          <h2 className="add-attendee-modal__title" id={titleId}>
            Edit template
          </h2>
          <p className="add-attendee-modal__hint">
            Rename this template, give it an icon, and add a short description to tell it apart
            from the others in the picker. This does not change its subject or body.
          </p>
          {lastEdited && <p className="add-attendee-modal__hint">Last edited {lastEdited}</p>}
          <div className="add-attendee-modal__fields">
            <Input
              label="Template label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setError(null);
              }}
              disabled={busy}
              autoFocus
            />
            <div className="at-field">
              <span className="at-label">Icon</span>
              <IconPicker
                key={template.id}
                value={icon}
                onChange={setIcon}
                icons={TEMPLATE_ICONS}
                defaultIcon={DEFAULT_TEMPLATE_ICON}
              />
              <span className="at-hint">Shown in the template picker.</span>
            </div>
            <Input
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              placeholder="Sent 24 hours before the event."
            />
          </div>
          {error && (
            <p className="add-attendee-modal__error" role="alert">
              {error}
            </p>
          )}
          <div className="add-attendee-modal__actions">
            <Tooltip content={canDelete ? undefined : "The default ticket template can't be deleted."}>
              <Button
                type="button"
                variant="danger"
                icon={<i className="ti ti-trash" aria-hidden="true" />}
                disabled={busy || !canDelete}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Delete
              </Button>
            </Tooltip>
            <div className="add-attendee-modal__actions-buttons">
              <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" variant="primary" disabled={busy || !dirty} onClick={submit}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete template?"
        message={`Delete "${template.label}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={busy}
        onCancel={() => {
          if (busy) return;
          setDeleteConfirmOpen(false);
        }}
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          onDelete(template.id);
        }}
      />
    </dialog>
  );
}
