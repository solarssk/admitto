import { useRef, useState } from "react";
import type { EventCustomFieldType } from "@admitto/shared";
import { Button, IconButton, ModalBackdrop, Notice, Tooltip, useToast } from "@admitto/ui";
import { createEventCustomField, updateEventCustomField } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventCustomFieldDto } from "../api/types.js";
import { CUSTOM_FIELD_TYPES } from "./customFieldType.js";
import { dependencyMessage, dependencyProblem } from "./fieldDependencies.js";
import { createFieldBody, fieldSaveOf, sameFieldSave, updateFieldPatch, type FieldSave } from "./fieldRequests.js";
import { FieldRulesEditor } from "./FieldRulesEditor.js";
import { FieldTypePicker } from "./FieldTypePicker.js";
import {
  EMPTY_RULES_DRAFT,
  formatRulesFromDraft,
  hasRulesProblem,
  rulesDraftFromRules,
  rulesProblems,
  rulesToSave,
  sameRules,
  typeTakesRules,
  type RulesDraft,
} from "./fieldRules.js";
import { FormRulesEditor } from "./FormRulesEditor.js";
import { slugifyItemKey } from "./itemKey.js";
import { optionRowsFromOptions, OptionsEditor, type OptionRow } from "./OptionsEditor.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { RetryHint } from "../components/RetryHint.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
import { useOptionUsage } from "./useOptionUsage.js";
import "./requirements.css";

export interface EventCustomFieldModalProps {
  eventId: string;
  /** null = create a new field; a field row = edit it (source_field becomes read-only). */
  field: EventCustomFieldDto | null;
  /** The event's fields as the card shows them, the one being edited among them: the question a condition depends on is picked from
   * them, and the ones that depend on this field hold back a change that would leave them without their answer. */
  fields: readonly EventCustomFieldDto[];
  onClose: () => void;
  onSaved: () => void;
  /** A new field is created on the registration form, which is where the Registration page adds it from; left out, it starts
   * off the form, as the API does by default. Only a new field takes it: an edit leaves the form alone. */
  showOnForm?: boolean;
}

type FormState = {
  label: string;
  source_field: string;
  description: string;
  type: EventCustomFieldDto["type"];
  required: boolean;
  options: OptionRow[];
  /** The rules, as typed: the format rules, the icon, the condition and the suggestions. What was typed for a type that does not take
   * it stays, so that going back to a type that does gives it back; what counts as an edit and what is sent follows the type
   * (`rulesToSave`). */
  rules: RulesDraft;
};

function emptyForm(): FormState {
  return { label: "", source_field: "", description: "", type: "text", required: false, options: [], rules: EMPTY_RULES_DRAFT };
}

function formFromField(field: EventCustomFieldDto): FormState {
  return {
    label: field.label,
    source_field: field.source_field,
    description: field.description ?? "",
    type: field.type,
    required: field.required,
    options: optionRowsFromOptions(field.options),
    rules: rulesDraftFromRules(field.rules),
  };
}

/** Add/edit modal for one EventCustomField registry row (dietary, shirt size, ...). */
export function EventCustomFieldModal({ eventId, field, fields, onClose, onSaved, showOnForm = false }: Readonly<EventCustomFieldModalProps>) {
  const { addToast } = useToast();
  const isEdit = field !== null;
  const [form, setForm] = useState<FormState>(() => (field ? formFromField(field) : emptyForm()));
  const [saving, setSaving] = useState(false);
  // How many attendees hold each option of a select field being edited (null = still being read, or the read failed): the
  // delete and rename-risk checks in OptionsEditor and below treat null as "unknown", never as "unused".
  const usage = useOptionUsage(eventId, field);
  const usageCounts = usage.counts;
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

  const usageUnknown = usageCounts === null;

  const labelTrimmed = form.label.trim();
  const selectOptions = form.options.map((r) => r.text.trim()).filter(Boolean);
  // What the server would refuse in the rules, said where the boxes are. A type that takes no format rules has none to refuse.
  const problems = rulesProblems(form.type, form.rules);
  // The rules this save would leave on the field: what the form says for its type, and the rules it has no control for.
  const nextRules = rulesToSave(form.rules, form.type, field?.rules);
  const save: FieldSave = {
    type: form.type,
    label: labelTrimmed,
    description: form.description.trim(),
    required: form.required,
    options: selectOptions,
    rules: nextRules,
  };
  // What the other fields of the event say about it, as the server would (the same checks): a condition on a question that is not on the
  // form, and a change that leaves a field that is shown for an answer of this one without it. An edit leaves the form flag as it is.
  const onForm = field ? field.show_on_form : showOnForm;
  const dependency = dependencyProblem(
    {
      source_field: form.source_field,
      type: form.type,
      show_on_form: onForm,
      options: form.type === "select" ? selectOptions : null,
      rules: nextRules,
    },
    fields,
  );
  const canSubmit =
    labelTrimmed.length > 0 &&
    form.source_field.length > 0 &&
    (form.type !== "select" || selectOptions.length > 0) &&
    !hasRulesProblem(problems) &&
    dependency === null;
  // Create mode always has "something new to save" once canSubmit is true; edit mode also
  // requires the draft to actually differ from the field being edited.
  const dirty = field ? !sameFieldSave(save, fieldSaveOf(field)) : true;
  // Whether this changes the type or the format rules of a field that already has answers: they are not converted, only checked against
  // the new type and rules from now on. The icon, the condition and the suggestions do not judge an answer.
  const nextFormatRules = typeTakesRules(form.type) ? formatRulesFromDraft(form.rules) : null;
  const changesAnswerFormat = field !== null && (form.type !== field.type || !sameRules(nextFormatRules, field.rules));

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

  function selectType(type: EventCustomFieldType) {
    setForm((f) => ({ ...f, type, options: type === "select" ? f.options : [] }));
  }

  function updateLabel(value: string) {
    setForm((f) => ({
      ...f,
      label: value,
      source_field: isEdit ? f.source_field : slugifyItemKey(value),
    }));
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Enter in a field submits the form without going through the Save button, which swallows a click while it works.
    if (!canSubmit || usageUnknown || saving) return;
    if (riskyRenames.length > 0) {
      setConfirmRiskyRenames(true);
      return;
    }
    void performSave();
  }

  async function performSave() {
    setSaving(true);
    try {
      if (isEdit) {
        await updateEventCustomField(eventId, field.id, updateFieldPatch(field, save));
      } else {
        await createEventCustomField(eventId, createFieldBody(form.source_field, save, showOnForm));
      }
      onSaved();
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save field."), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog open className="event-item-modal" aria-modal="true" aria-labelledby="custom-field-modal-title">
      <ModalBackdrop />
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
                  readOnly={saving}
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
                readOnly={saving}
              />
            </div>
            <div className="at-field">
              <span className="at-label" id="cf-type-label">
                Field type
              </span>
              <FieldTypePicker value={form.type} onChange={selectType} labelledBy="cf-type-label" disabled={saving} />
              <span className="at-hint">
                {CUSTOM_FIELD_TYPES.find((type) => type.value === form.type)?.hint}
              </span>
              {form.type === "select" && (
                <>
                  <span className="at-label">Options</span>
                  {usage.error && (
                    <RetryHint
                      message={usage.error}
                      busy={usage.retrying}
                      onRetry={usage.retry}
                      retryLabel="Retry loading option usage"
                    />
                  )}
                  <OptionsEditor
                    rows={form.options}
                    usageCounts={usageCounts}
                    usageLoading={usage.loading}
                    disabled={saving}
                    onChange={(rows) => setForm((f) => ({ ...f, options: rows }))}
                  />
                </>
              )}
            </div>
            {dependency?.kind === "controls_others" && (
              <Notice variant="warning" as="output">
                {dependencyMessage(dependency, fields)}
              </Notice>
            )}
            {/* Says nothing for a type that takes no rules. */}
            <FieldRulesEditor
              type={form.type}
              draft={form.rules}
              problems={problems}
              saving={saving}
              onChange={(rules) => setForm((f) => ({ ...f, rules }))}
            />
            <FormRulesEditor
              type={form.type}
              required={form.required}
              draft={form.rules}
              problems={problems}
              fields={fields}
              sourceField={form.source_field}
              onForm={onForm}
              conditionError={dependency && dependency.kind !== "controls_others" ? dependencyMessage(dependency, fields) : ""}
              saving={saving}
              onChange={(rules) => setForm((f) => ({ ...f, rules }))}
            />
            {changesAnswerFormat && (
              <Notice variant="warning" as="output">
                Answers already saved are not changed, but they are checked against the new type and rules. An attendee whose
                saved answer no longer fits can&apos;t be edited until that answer is replaced or cleared.
              </Notice>
            )}
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
                loading={saving}
                disabled={!canSubmit || !dirty || usageUnknown}
              >
                {isEdit ? "Save" : "Create field"}
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
    </dialog>
  );
}
