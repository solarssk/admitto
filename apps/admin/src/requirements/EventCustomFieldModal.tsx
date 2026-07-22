import { useRef, useState } from "react";
import { Button, IconButton, Tooltip, useToast } from "@admitto/ui";
import { createEventCustomField, updateEventCustomField } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventCustomFieldDto } from "../api/types.js";
import { CUSTOM_FIELD_TYPES } from "./customFieldType.js";
import { slugifyItemKey } from "./itemKey.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import "./requirements.css";

export interface EventCustomFieldModalProps {
  eventId: string;
  /** null = create a new field; a field row = edit it (source_field becomes read-only). */
  field: EventCustomFieldDto | null;
  onClose: () => void;
  onSaved: () => void;
}

type FormState = {
  label: string;
  source_field: string;
  description: string;
  type: "text" | "select" | "boolean";
  required: boolean;
  options: string;
};

function emptyForm(): FormState {
  return { label: "", source_field: "", description: "", type: "text", required: false, options: "" };
}

function formFromField(field: EventCustomFieldDto): FormState {
  return {
    label: field.label,
    source_field: field.source_field,
    description: field.description ?? "",
    type: field.type,
    required: field.required,
    options: field.options?.join("\n") ?? "",
  };
}

/** Add/edit modal for one EventCustomField registry row (dietary, shirt size, ...). */
export function EventCustomFieldModal({ eventId, field, onClose, onSaved }: EventCustomFieldModalProps) {
  const { addToast } = useToast();
  const isEdit = field !== null;
  const [form, setForm] = useState<FormState>(() => (field ? formFromField(field) : emptyForm()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, true, onClose);

  let submitLabel = "Create field";
  if (saving) submitLabel = "Saving…";
  else if (isEdit) submitLabel = "Save changes";

  function updateLabel(value: string) {
    setError(null);
    setForm((f) => ({
      ...f,
      label: value,
      source_field: isEdit ? f.source_field : slugifyItemKey(value),
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const label = form.label.trim();
    const source_field = form.source_field;
    if (!label || !source_field) {
      setError("Enter a display label using letters or numbers.");
      return;
    }
    const description = form.description.trim();
    const options = form.options
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (form.type === "select" && options.length === 0) {
      setError("Select fields need at least one option.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (isEdit) {
        await updateEventCustomField(eventId, field.id, {
          label,
          // null (not undefined) so the server can tell "clear the previous description" apart
          // from "leave it untouched" - same convention as options below.
          description: description || null,
          type: form.type,
          required: form.required,
          // null (not undefined) so the server can tell "clear the previous select's options"
          // apart from "leave options untouched" - PATCH only updates keys it actually receives.
          options: form.type === "select" ? options : null,
        });
      } else {
        await createEventCustomField(eventId, {
          source_field,
          label,
          description: description || undefined,
          type: form.type,
          required: form.required,
          options: form.type === "select" ? options : undefined,
        });
      }
      onSaved();
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save field."), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="event-item-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-field-modal-title"
    >
      <div className="event-item-modal__backdrop" role="presentation" onClick={onClose} />
      <div ref={panelRef} className="event-item-modal__panel">
        <div className="event-item-modal__header">
          <div>
            <h2 id="custom-field-modal-title" className="event-item-modal__title">
              {isEdit ? "Edit custom field" : "Add custom field"}
            </h2>
          </div>
          <IconButton label="Close" onClick={onClose} icon={<i className="ti ti-x" />} />
        </div>
        <form id="custom-field-form" className="event-item-modal__body" onSubmit={(e) => void handleSave(e)}>
          {error && (
            <p className="text-error" role="alert">
              {error}
            </p>
          )}
          <div className="at-field">
            <div className="add-item-label-row">
              <label className="at-label" htmlFor="cf-label">
                Display label
              </label>
              {form.source_field && (
                <span className="at-hint">
                  ID: <code>{form.source_field}</code>
                </span>
              )}
            </div>
            <div className="contents-row__key-row">
              <input
                id="cf-label"
                className="at-input"
                value={form.label}
                onChange={(e) => updateLabel(e.target.value)}
                placeholder="Dietary requirements"
                autoFocus
              />
              <div className="contents-row__type-picker">
                <Tooltip content="Required">
                  <button
                    type="button"
                    className={`contents-row__type-btn${form.required ? " contents-row__type-btn--active" : ""}`}
                    onClick={() => setForm((f) => ({ ...f, required: !f.required }))}
                    aria-pressed={form.required}
                    aria-label="Required"
                  >
                    <i className="ti ti-asterisk" />
                  </button>
                </Tooltip>
              </div>
            </div>
            <span className="at-hint">
              Used to reference this field from items and to match it elsewhere. Can't be
              changed after creation.
            </span>
          </div>
          <div className="at-field">
            <label className="at-label" htmlFor="cf-description">
              Description
            </label>
            <textarea
              id="cf-description"
              className="at-textarea"
              rows={2}
              maxLength={500}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Shown to operators on the import reference table"
            />
          </div>
          <div className="at-field">
            <span className="at-label" id="cf-type-label">
              Field type
            </span>
            <div
              className="contents-row__type-picker contents-row__type-picker--block"
              role="group"
              aria-labelledby="cf-type-label"
            >
              {CUSTOM_FIELD_TYPES.map(({ value, icon, label: btnLabel }) => (
                <Tooltip key={value} content={btnLabel}>
                  <button
                    type="button"
                    className={`contents-row__type-btn${form.type === value ? " contents-row__type-btn--active" : ""}`}
                    onClick={() => {
                      setError(null);
                      setForm((f) => ({ ...f, type: value, options: value === "select" ? f.options : "" }));
                    }}
                    aria-pressed={form.type === value}
                    aria-label={btnLabel}
                  >
                    <i className={`ti ${icon}`} />
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
          {form.type === "select" && (
            <div className="at-field">
              <label className="at-label" htmlFor="cf-options">
                Options (one per line)
              </label>
              <textarea
                id="cf-options"
                className="at-textarea"
                rows={3}
                value={form.options}
                onChange={(e) => setForm((f) => ({ ...f, options: e.target.value }))}
                placeholder={"Vegetarian\nVegan\nGluten-free"}
                aria-label="Select options"
              />
            </div>
          )}
        </form>
        <div className="event-item-modal__footer">
          <Button type="submit" form="custom-field-form" variant="primary" disabled={saving}>
            {submitLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
