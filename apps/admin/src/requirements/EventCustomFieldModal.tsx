import { useEffect, useRef, useState } from "react";
import { Button, IconButton, ModalBackdrop, Tooltip, useToast } from "@admitto/ui";
import {
  createEventCustomField,
  fetchEventCustomFieldOptionUsage,
  updateEventCustomField,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventCustomFieldDto } from "../api/types.js";
import { CUSTOM_FIELD_TYPES } from "./customFieldType.js";
import { slugifyItemKey } from "./itemKey.js";
import { optionRowsFromOptions, OptionsEditor, type OptionRow } from "./OptionsEditor.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
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
  options: OptionRow[];
};

function emptyForm(): FormState {
  return { label: "", source_field: "", description: "", type: "text", required: false, options: [] };
}

function formFromField(field: EventCustomFieldDto): FormState {
  return {
    label: field.label,
    source_field: field.source_field,
    description: field.description ?? "",
    type: field.type,
    required: field.required,
    options: optionRowsFromOptions(field.options),
  };
}

/** Add/edit modal for one EventCustomField registry row (dietary, shirt size, ...). */
export function EventCustomFieldModal({ eventId, field, onClose, onSaved }: EventCustomFieldModalProps) {
  const { addToast } = useToast();
  const isEdit = field !== null;
  const [form, setForm] = useState<FormState>(() => (field ? formFromField(field) : emptyForm()));
  const [saving, setSaving] = useState(false);
  // null = usage counts for the current select field are still loading; {} for create mode or a
  // non-select field, where there's nothing to fetch. Delete/rename-risk checks in OptionsEditor
  // and below both treat null as "unknown", never as "unused" - see the fetch effect below.
  const [usageCounts, setUsageCounts] = useState<Record<string, number> | null>(() =>
    isEdit && field.type === "select" ? null : {},
  );
  const [usageError, setUsageError] = useState(false);
  const [usageRetryToken, setUsageRetryToken] = useState(0);
  const [confirmRiskyRenames, setConfirmRiskyRenames] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Suspended while the risky-rename ConfirmDialog is open (same pattern as EventItemDrawer's
  // and UserEditModal's own nested confirm dialogs) - both dialogs otherwise register their own
  // capture-phase Escape listener on document, and this modal's runs first (mounted first), so
  // pressing Escape to dismiss just the confirmation would instead call this modal's own onClose
  // and discard the whole draft, options changes included.
  useModalFocusTrap(panelRef, !confirmRiskyRenames, onClose);
  useOverscrollBounceGuard(scrollRef);

  useEffect(() => {
    if (!isEdit || field.type !== "select") return;
    setUsageError(false);
    const controller = new AbortController();
    fetchEventCustomFieldOptionUsage(eventId, field.id, controller.signal)
      .then((counts) => setUsageCounts(counts))
      .catch(() => {
        if (!controller.signal.aborted) setUsageError(true);
      });
    return () => controller.abort();
    // Fetches once for the field this modal was opened with (eventId/field.id/field.type don't
    // change while it's open), and again each time usageRetryToken changes - a failed fetch
    // otherwise leaves usageCounts null (Save disabled) for good, with no way to recover short of
    // closing and reopening the whole modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usageRetryToken]);

  const usageLoading = usageCounts === null;
  let submitLabel = "Create field";
  if (saving) submitLabel = "Saving…";
  else if (usageLoading) submitLabel = "Checking usage…";
  else if (isEdit) submitLabel = "Save";

  const labelTrimmed = form.label.trim();
  const selectOptions = form.options.map((r) => r.text.trim()).filter(Boolean);
  const canSubmit =
    labelTrimmed.length > 0 &&
    form.source_field.length > 0 &&
    (form.type !== "select" || selectOptions.length > 0);
  // Create mode always has "something new to save" once canSubmit is true; edit mode also
  // requires the draft to actually differ from the field being edited.
  const dirty = field ? JSON.stringify(form) !== JSON.stringify(formFromField(field)) : true;

  // Options renamed - or blanked, which selectOptions below treats as a removal - away from a
  // value with attendees currently on it. Save gates on these with ConfirmDialog instead of
  // sending the PATCH straight away. A row removed via OptionsEditor's own trash button is
  // already confirmed in place, so it isn't repeated here.
  const riskyRenames = usageCounts
    ? form.options.filter((r) => {
        const trimmed = r.text.trim();
        const blanked = trimmed === "" && r.originalText !== "";
        const renamed = !blanked && trimmed !== r.originalText;
        return (blanked || renamed) && (usageCounts[r.originalText] ?? 0) > 0;
      })
    : [];

  function updateLabel(value: string) {
    setForm((f) => ({
      ...f,
      label: value,
      source_field: isEdit ? f.source_field : slugifyItemKey(value),
    }));
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || usageLoading) return;
    if (riskyRenames.length > 0) {
      setConfirmRiskyRenames(true);
      return;
    }
    void performSave();
  }

  async function performSave() {
    const label = labelTrimmed;
    const source_field = form.source_field;
    const description = form.description.trim();
    const options = selectOptions;
    setSaving(true);
    try {
      if (isEdit) {
        // Only send options when they actually changed (or the type just switched away from
        // "select"): re-sending the same list re-derived from the textarea on every save -
        // e.g. one that only flips "Required" - risks silently rewriting the stored options with
        // a round-trip artifact (a comma inside an option gets re-split into two) and, since
        // attendees' custom_data values match options by exact text, breaks their already-saved
        // selection for no reason tied to what the operator actually changed.
        const optionsChanged =
          form.type === "select"
            ? JSON.stringify(options) !== JSON.stringify(field.options ?? [])
            : field.type === "select";
        await updateEventCustomField(eventId, field.id, {
          label,
          // null (not undefined) so the server can tell "clear the previous description" apart
          // from "leave it untouched" - same convention as options below.
          description: description || null,
          type: form.type,
          required: form.required,
          // null clears a previous select's options when switching away from "select"; omitting
          // the key (undefined) leaves options untouched - PATCH only updates keys it receives.
          ...(optionsChanged ? { options: form.type === "select" ? options : null } : {}),
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
      <ModalBackdrop onClose={onClose} />
      <div ref={panelRef} className="event-item-modal__panel">
        <div ref={scrollRef} className="event-item-modal__scroll at-scroll">
          <div className="event-item-modal__header">
            <div>
              <h2 id="custom-field-modal-title" className="event-item-modal__title">
                <i className="ti ti-forms" aria-hidden="true" />
                {isEdit ? "Edit custom field" : "Add custom field"}
              </h2>
              <p className="event-item-modal__subtitle">
                {isEdit
                  ? "Update how this field appears to operators."
                  : "Collect extra attendee details on import and show them to operators during check-in."}
              </p>
            </div>
            <IconButton label="Close" onClick={onClose} icon={<i className="ti ti-x" />} />
          </div>
          <form id="custom-field-form" className="event-item-modal__body" onSubmit={handleFormSubmit}>
            <div className="at-field">
              <div className="add-item-label-row">
                <label className="at-label" htmlFor="cf-label">
                  Display label
                </label>
                {form.source_field && (
                  <span className="at-hint">
                    ID: <code className="requirements-item-id">{form.source_field}</code>
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
                        setForm((f) => ({ ...f, type: value, options: value === "select" ? f.options : [] }));
                      }}
                      aria-pressed={form.type === value}
                      aria-label={btnLabel}
                    >
                      <i className={`ti ${icon}`} />
                      <span>{btnLabel}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
              <span className="at-hint">
                {CUSTOM_FIELD_TYPES.find((type) => type.value === form.type)?.hint}
              </span>
              {form.type === "select" && (
                <>
                  <span className="at-label">Options</span>
                  {usageError && (
                    <p className="at-hint custom-field-usage-error" role="alert">
                      Could not load how many attendees use each option.
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setUsageRetryToken((t) => t + 1)}
                      >
                        Retry
                      </Button>
                    </p>
                  )}
                  <OptionsEditor
                    rows={form.options}
                    usageCounts={usageCounts}
                    disabled={saving}
                    onChange={(rows) => setForm((f) => ({ ...f, options: rows }))}
                  />
                </>
              )}
            </div>
          </form>
          <div className="event-item-modal__footer">
            <div className="event-item-modal__footer-end">
              <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="custom-field-form"
                variant="primary"
                disabled={!canSubmit || saving || !dirty || usageLoading}
              >
                {submitLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmRiskyRenames}
        icon={<i className="ti ti-alert-triangle" />}
        title="This will affect existing attendees"
        message="Renaming these options changes what attendees currently have selected - they'll show as unset until reassigned."
        confirmLabel="Save anyway"
        confirmVariant="warning"
        onCancel={() => setConfirmRiskyRenames(false)}
        onConfirm={() => {
          setConfirmRiskyRenames(false);
          void performSave();
        }}
      >
        <ul className="custom-field-risky-list">
          {riskyRenames.map((r) => {
            const trimmed = r.text.trim();
            const count = usageCounts?.[r.originalText] ?? 0;
            const attendeeWord = count === 1 ? "attendee" : "attendees";
            return (
              <li key={r.key}>
                {trimmed === "" ? (
                  <>
                    Removing &ldquo;{r.originalText}&rdquo; affects {count} {attendeeWord}.
                  </>
                ) : (
                  <>
                    Renaming &ldquo;{r.originalText}&rdquo; to &ldquo;{trimmed}&rdquo; affects {count} {attendeeWord}.
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
