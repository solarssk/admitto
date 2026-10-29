import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, Card, Input, ModalBackdrop, Notice } from "@admitto/ui";
import type { AttendeeCompanionDto, EventDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { attendeeFieldAttrs } from "../utils/no-autofill.js";
import { companionAnswerEntries, companionFormChanged, companionFormFrom, type CompanionFormState } from "./companionForm.js";
import { CustomDataFieldInput } from "./CustomDataFieldInput.js";
import { isLongAnswer, shownCustomFields, type CustomDataFieldDef } from "./customData.js";
import { useCompanionActions, type CompanionActionsInput } from "./useCompanionActions.js";
import "./attendees.css";
import "./attendee-fields-grid.css";

export interface CompanionCardProps extends Pick<CompanionActionsInput, "eventId" | "attendeeId" | "onChanged" | "onArchived" | "onOutOfDate"> {
  event: EventDto;
  companion: AttendeeCompanionDto;
  /** The questions about the companion. */
  fields: readonly CustomDataFieldDef[];
  /** Whether the questions could be read. The dialog replaces the companion's answers with what it holds, so one that could not know the
   * questions would clear them: it is not offered. */
  fieldsLoaded: boolean;
}

const FIELDS_NOT_LOADED = "The questions about the companion could not be loaded. Reload the page to edit.";

/** A label longer than this is read above its answer, from the left: beside a long answer, a long question leaves the answer a column of a
 * few letters on a phone. */
const LONG_LABEL_CHARS = 30;

/** The dialog that corrects the name and the answers of the guest's companion. Mounted when it opens, so that it starts from the companion as
 * the page has it and what was typed is gone when it closes. */
function CompanionEditDialog({
  companion,
  fields,
  event,
  saving,
  error,
  onSave,
  onCancel,
}: Readonly<{
  companion: AttendeeCompanionDto;
  fields: readonly CustomDataFieldDef[];
  event: EventDto;
  saving: boolean;
  error: string | null;
  onSave: (form: CompanionFormState) => void;
  onCancel: () => void;
}>) {
  const titleId = useId();
  const panelRef = useRef<HTMLFormElement>(null);
  const base = useMemo(() => companionFormFrom(companion, fields), [companion, fields]);
  const [form, setForm] = useState<CompanionFormState>(base);
  useModalFocusTrap(panelRef, true, onCancel);
  const changed = companionFormChanged(form, base, fields);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!saving && changed) onSave(form);
  }

  return (
    <dialog className="attendee-edit-modal" open aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop />
      <form ref={panelRef} className="attendee-edit-modal__panel" onSubmit={submit}>
        <h2 id={titleId} className="attendee-edit-modal__title">
          <i className="ti ti-users" aria-hidden="true" /> Edit companion
        </h2>
        <p className="attendee-edit-modal__subtitle">Correct the name and the answers of the person this guest brings.</p>
        {error && (
          <Notice variant="error" role="alert">
            {error}
          </Notice>
        )}
        <div className="attendee-fields-grid">
          <div className="attendee-fields-grid__full">
            <Input
              label="Full name"
              icon={<i className="ti ti-user" aria-hidden="true" />}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              readOnly={saving}
              required
              {...attendeeFieldAttrs("edit-companion-name")}
            />
          </div>
          {shownCustomFields(fields, form.answers).map((field) => (
            <CustomDataFieldInput
              key={field.source_field}
              field={field}
              eventTimeZone={event.timezone}
              value={form.answers[field.source_field] ?? ""}
              disabled={saving}
              onChange={(next) => setForm({ ...form, answers: { ...form.answers, [field.source_field]: next } })}
            />
          ))}
        </div>
        <div className="attendee-form__actions">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <ArchivedGuard event={event} reasonId="save-companion-reason" disabled={saving || !changed}>
            {(guard) => (
              <Button type="submit" variant="primary" {...guard} loading={saving}>
                Save
              </Button>
            )}
          </ArchivedGuard>
        </div>
      </form>
    </dialog>
  );
}

/**
 * The guest's companion on the attendee's page (D-E5): the name and the answers, and what an Administrator may do with them. Edit
 * corrects them, and Remove takes the person out (their data, the copy in the guest's registration, and the place they held), which is
 * said in the dialog in those words. Both are off on an archived event, as every change is. The page shows the card only for a guest
 * who has a companion; the registration window shows the same person, read-only, as the guest sent them.
 */
export function CompanionCard({ event, companion, fields, fieldsLoaded, ...actionInput }: Readonly<CompanionCardProps>) {
  const actions = useCompanionActions({ ...actionInput, fields });
  const answers = companionAnswerEntries(companion, fields, event.timezone);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  // A dialog that closes leaves the keyboard on <body>: the controls it held are gone or hidden. The keyboard goes back to the button that
  // opened it, in an effect that follows the render that closed it (never a timer). A removal that worked takes the card away with the
  // button, so the page puts the focus somewhere else (AttendeeDetailPage, handleCompanionChanged).
  const wasOpen = useRef({ edit: false, removal: false });
  useEffect(() => {
    if (wasOpen.current.edit && !actions.edit.open) editButtonRef.current?.focus();
    if (wasOpen.current.removal && !actions.removal.open) removeButtonRef.current?.focus();
    wasOpen.current = { edit: actions.edit.open, removal: actions.removal.open };
  }, [actions.edit.open, actions.removal.open]);
  return (
    <>
      <Card
        title="Companion"
        actions={
          <>
            <ArchivedGuard event={event} reasonId="edit-companion-reason" disabled={!fieldsLoaded} tooltip={FIELDS_NOT_LOADED}>
              {(guard) => (
                <Button ref={editButtonRef} variant="secondary" size="sm" icon={<i className="ti ti-pencil" aria-hidden="true" />} {...guard} onClick={actions.edit.show}>
                  Edit
                </Button>
              )}
            </ArchivedGuard>
            <ArchivedGuard event={event} reasonId="remove-companion-reason">
              {(guard) => (
                <Button ref={removeButtonRef} variant="secondary" size="sm" icon={<i className="ti ti-user-minus" aria-hidden="true" />} {...guard} onClick={actions.removal.show}>
                  Remove
                </Button>
              )}
            </ArchivedGuard>
          </>
        }
      >
        <div className="attendee-detail-readonly">
          <div className="attendee-detail-row">
            <span>Name</span>
            <span>{companion.name}</span>
          </div>
          {answers.map(([key, label, value]) => (
            <div className={`attendee-detail-row${isLongAnswer(value) || label.length > LONG_LABEL_CHARS ? " attendee-detail-row--long" : ""}`} key={key}>
              <span>{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </Card>
      {actions.edit.open && (
        <CompanionEditDialog
          companion={companion}
          fields={fields}
          event={event}
          saving={actions.edit.saving}
          error={actions.edit.error}
          onSave={(form) => void actions.edit.save(form)}
          onCancel={actions.edit.cancel}
        />
      )}
      <ConfirmDialog
        open={actions.removal.open}
        title="Remove the companion?"
        message="This deletes the companion's name and answers, including any copy in the guest's registration, and frees the place they held. It cannot be undone."
        confirmLabel="Remove companion"
        confirmVariant="danger"
        loading={actions.removal.busy}
        errorMessage={actions.removal.error}
        onConfirm={() => void actions.removal.confirm()}
        onCancel={actions.removal.cancel}
      />
    </>
  );
}
