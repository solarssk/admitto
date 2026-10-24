import { useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, HintLabel, IconButton, Switch, Tooltip, useToast } from "@admitto/ui";
import { ApiError, deleteEventCustomField } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AddSuggestedFieldsResponse, EventCustomFieldDto, EventDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { SuggestedQuestionsDialog } from "../registration/SuggestedQuestionsDialog.js";
import { addedMessage } from "../registration/suggestedQuestions.js";
import { customFieldTypeIcon, customFieldTypeLabel } from "./customFieldType.js";
import { disambiguatedLabel, findDuplicateLabels } from "./duplicateLabels.js";
import { EventCustomFieldModal } from "./EventCustomFieldModal.js";
import { conditionLine, deleteBlockedMessage } from "./fieldDependencies.js";
import { guestFormIconGlyph, guestFormIconLabel } from "./guestFormIcons.js";
import { moveKey, useFieldFormControls, type FieldsChange, type MoveDirection } from "./useFieldFormControls.js";
import "../attendees/attendees.css";
import "./requirements.css";

/** Where the card is shown: on Requirements, as it always was, or on the Registration page, where each field also has an
 * "On the form" switch and the arrows that order the fields, and a field that is added starts on the form. */
export type EventCustomFieldsPlacement = "requirements" | "registration";

const CARD_TEXT: Record<
  EventCustomFieldsPlacement,
  { readonly title: string; readonly hint: string; readonly emptyTitle: string; readonly emptyText: string }
> = {
  requirements: {
    title: "Custom attendee fields",
    hint: "Also used in the attendee form, CSV import, and exports. Fields used as item hints can't be deleted until removed from the item.",
    emptyTitle: "No custom fields yet",
    emptyText: "Add one to collect extra attendee data, like dietary requirements or shirt size.",
  },
  registration: {
    title: "Attendee fields",
    hint: "Guests answer the fields that are on the form. The same fields are used in the attendee form, CSV import, and exports. Fields used as item hints can't be deleted until removed from the item.",
    emptyTitle: "No attendee fields yet",
    emptyText: "Add a field to ask guests a question on the registration form, like dietary requirements or shirt size.",
  },
};

export interface EventCustomFieldsCardProps {
  readonly eventId: string;
  readonly event: EventDto;
  readonly fields: EventCustomFieldDto[];
  /** A field was added, changed or deleted, or the list is out of date: the host reads it again. */
  readonly onChanged: () => void;
  readonly placement?: EventCustomFieldsPlacement;
  /** Registration only: shows what the server answered to a switch or an arrow on the list the host has now, at once. Left
   * out, the host reads the list again (`onChanged`) instead. */
  readonly onUpdated?: (change: FieldsChange) => void;
}

/** What a row of the Registration page's card does besides what every row does. */
interface RowFormControls {
  readonly switchBusy: boolean;
  readonly first: boolean;
  readonly last: boolean;
  /** The arrow whose reorder is on its way (`moveKey`). */
  readonly moving: string | null;
  readonly onToggleOnForm: () => void;
  readonly onMove: (direction: MoveDirection) => void;
}

function OnFormCell({
  field,
  event,
  name,
  busy,
  onToggle,
}: Readonly<{ field: EventCustomFieldDto; event: EventDto; name: string; busy: boolean; onToggle: () => void }>) {
  return (
    <td className="requirements-item-form-col">
      <div className="requirements-status-cell">
        <ArchivedGuard event={event} reasonId={`on-form-custom-field-reason-${field.id}`}>
          {(guard) => (
            <Switch
              id={`custom-field-on-form-${field.id}`}
              aria-label={`${name} on the form`}
              checked={field.show_on_form}
              // Off while its own request is on its way, but still focusable: a switch that turns `disabled` under the
              // keyboard that has just flipped it would drop the focus on <body>. A change made meanwhile is ignored.
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              onChange={onToggle}
              {...guard}
            />
          )}
        </ArchivedGuard>
      </div>
    </td>
  );
}

function MoveButton({
  field,
  event,
  name,
  direction,
  atEnd,
  moving,
  onMove,
}: Readonly<{
  field: EventCustomFieldDto;
  event: EventDto;
  name: string;
  direction: MoveDirection;
  atEnd: boolean;
  moving: string | null;
  onMove: (direction: MoveDirection) => void;
}>) {
  const key = moveKey(field.id, direction);
  return (
    <ArchivedGuard event={event} reasonId={`move-${direction}-custom-field-reason-${field.id}`} disabled={atEnd}>
      {(guard) => (
        <IconButton
          label={`Move ${name} ${direction}`}
          size="sm"
          icon={<i className={`ti ti-arrow-${direction}`} aria-hidden="true" />}
          loading={moving === key}
          data-reorder={key}
          onClick={() => onMove(direction)}
          {...guard}
        />
      )}
    </ArchivedGuard>
  );
}

function CustomFieldRow({
  field,
  fields,
  event,
  duplicateLabels,
  formControls,
  onEdit,
  onDelete,
}: {
  readonly field: EventCustomFieldDto;
  /** All the fields of the event, to name the question this one depends on. */
  readonly fields: readonly EventCustomFieldDto[];
  readonly event: EventDto;
  readonly duplicateLabels: ReadonlySet<string>;
  /** Only on the Registration page. */
  readonly formControls: RowFormControls | null;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const description = field.description?.trim() ?? "";
  const typeLabel = customFieldTypeLabel(field.type);
  const name = disambiguatedLabel(field.label, field.source_field, duplicateLabels);
  const iconGlyph = guestFormIconGlyph(field.rules?.icon);
  const condition = conditionLine(field, fields);
  return (
    <tr>
      <td>
        <div className="requirements-item-cell">
          <Tooltip content={typeLabel}>
            <span className="requirements-item-type-icon" role="img" aria-label={typeLabel}>
              <i className={`ti ${customFieldTypeIcon(field.type)}`} aria-hidden="true" />
            </span>
          </Tooltip>
          <div className="requirements-item-info">
            <div className="requirements-item-name">
              {iconGlyph ? (
                <span className="requirements-item-form-icon" role="img" aria-label={`Icon on the form: ${guestFormIconLabel(field.rules?.icon)}`}>
                  <i className={`ti ti-${iconGlyph}`} aria-hidden="true" />
                </span>
              ) : null}
              {name}
            </div>
            {condition ? <div className="requirements-item-condition">{condition}</div> : null}
          </div>
        </div>
      </td>
      <td className="requirements-item-desc-col">
        {description !== "" ? (
          <div className="requirements-item-desc">{description}</div>
        ) : null}
      </td>
      <td className="requirements-item-status-col">{field.required ? "Yes" : "No"}</td>
      {formControls ? (
        <OnFormCell field={field} event={event} name={name} busy={formControls.switchBusy} onToggle={formControls.onToggleOnForm} />
      ) : null}
      <td className="requirements-item-actions">
        <div className="requirements-item-actions__wrap">
          {formControls
            ? (["up", "down"] as const).map((direction) => (
                <MoveButton
                  key={direction}
                  field={field}
                  event={event}
                  name={name}
                  direction={direction}
                  atEnd={direction === "up" ? formControls.first : formControls.last}
                  moving={formControls.moving}
                  onMove={formControls.onMove}
                />
              ))
            : null}
          <ArchivedGuard event={event} reasonId={`edit-custom-field-reason-${field.id}`}>
            {(guard) => (
              <IconButton
                label="Edit field"
                size="sm"
                icon={<i className="ti ti-pencil" aria-hidden="true" />}
                onClick={onEdit}
                {...guard}
              />
            )}
          </ArchivedGuard>
          <ArchivedGuard event={event} reasonId={`delete-custom-field-reason-${field.id}`}>
            {(guard) => (
              <IconButton
                label="Delete field"
                size="sm"
                icon={<i className="ti ti-trash" aria-hidden="true" />}
                onClick={onDelete}
                {...guard}
              />
            )}
          </ArchivedGuard>
        </div>
      </td>
    </tr>
  );
}

/** The card that manages the event's custom attendee data field registry (dietary, shirt size, ...): the single source of
 * truth consumed by attendee edit/create, import, export, the registration form, and referenced by items as operator hints
 * (see EventItemDrawer). It is on Requirements and, with the form controls, on the Registration page: the same fields,
 * the same editor. */
export function EventCustomFieldsCard({ eventId, event, fields, onChanged, placement = "requirements", onUpdated }: EventCustomFieldsCardProps) {
  const { addToast } = useToast();
  const sectionRef = useRef<HTMLElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editField, setEditField] = useState<EventCustomFieldDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventCustomFieldDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const suggestButtonRef = useRef<HTMLButtonElement>(null);
  // The suggested-questions window unmounts when it closes, and a browser leaves the focus on <body> then: closing it is counted, and
  // the effect that follows the render puts the focus back on the button that opened it.
  const [suggestFocusBack, setSuggestFocusBack] = useState(0);
  const form = useFieldFormControls({ eventId, fields, onChanged, onUpdated, rootRef: sectionRef });

  useEffect(() => {
    if (suggestFocusBack > 0) suggestButtonRef.current?.focus();
  }, [suggestFocusBack]);

  const onRegistrationPage = placement === "registration";
  const text = CARD_TEXT[placement];
  const deleteBlocked = deleteTarget ? deleteBlockedMessage(deleteTarget, fields) : "";
  const showTable = fields.length > 0;

  function closeModal() {
    setAddOpen(false);
    setEditField(null);
  }

  function closeSuggested() {
    setSuggestOpen(false);
    setSuggestFocusBack((count) => count + 1);
  }

  /** The server has answered: tell how many questions it added, and read the list again (it also changes when another admin added
   * the same questions first, and the answer is that none were added). */
  function handleSuggestedAdded(outcome: AddSuggestedFieldsResponse) {
    closeSuggested();
    addToast(addedMessage(outcome.added.length), outcome.added.length > 0 ? "success" : "info");
    onChanged();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteEventCustomField(eventId, deleteTarget.id);
      setDeleteTarget(null);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "field_in_use")) {
        addToast("This field is used as a hint on an item. Remove it there first.", "warning");
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to delete field."), "error");
      }
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  function renderBody() {
    if (fields.length === 0) {
      return (
        <EmptyState
          icon={<i className="ti ti-forms" aria-hidden="true" />}
          title={text.emptyTitle}
          description={text.emptyText}
        />
      );
    }
    const duplicateLabels = findDuplicateLabels(fields.map((field) => field.label));
    return (
      <div className="attendees-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Field</th>
              <th className="requirements-item-desc-col">Description</th>
              <th className="requirements-item-status-col">Required</th>
              {onRegistrationPage ? <th className="requirements-item-form-col">On the form</th> : null}
              <th className="requirements-item-actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => (
              <CustomFieldRow
                key={field.id}
                field={field}
                fields={fields}
                event={event}
                duplicateLabels={duplicateLabels}
                formControls={
                  onRegistrationPage
                    ? {
                        // Also while a move is on its way: a switch made then is ignored.
                        switchBusy: form.switching.has(field.id) || form.moving !== null,
                        first: index === 0,
                        last: index === fields.length - 1,
                        moving: form.moving,
                        onToggleOnForm: () => void form.toggleOnForm(field),
                        onMove: (direction) => void form.move(index, direction),
                      }
                    : null
                }
                onEdit={() => setEditField(field)}
                onDelete={() => setDeleteTarget(field)}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section ref={sectionRef} className={`requirements-section${onRegistrationPage ? " requirements-section--registration" : ""}`}>
      <Card
        /* Table bleeds edge-to-edge; the empty state keeps the normal card padding (Import history). */
        padded={!showTable}
        title={<HintLabel hint={text.hint}>{text.title}</HintLabel>}
        actions={
          <>
            {onRegistrationPage ? (
              <ArchivedGuard event={event} reasonId="add-suggested-questions-reason">
                {(guard) => (
                  <Button
                    ref={suggestButtonRef}
                    variant="secondary"
                    size="sm"
                    icon={<i className="ti ti-wand" />}
                    {...guard}
                    onClick={() => setSuggestOpen(true)}
                  >
                    Add suggested questions
                  </Button>
                )}
              </ArchivedGuard>
            ) : null}
            <ArchivedGuard event={event} reasonId="add-custom-field-reason">
              {(guard) => (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<i className="ti ti-plus" />}
                  {...guard}
                  onClick={() => setAddOpen(true)}
                >
                  Add field
                </Button>
              )}
            </ArchivedGuard>
          </>
        }
      >
        {renderBody()}
      </Card>

      {(addOpen || editField) && (
        <EventCustomFieldModal
          eventId={eventId}
          field={editField}
          fields={fields}
          showOnForm={onRegistrationPage}
          onClose={closeModal}
          onSaved={() => {
            closeModal();
            onChanged();
          }}
        />
      )}

      {suggestOpen && <SuggestedQuestionsDialog eventId={eventId} fields={fields} onClose={closeSuggested} onAdded={handleSuggestedAdded} />}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete custom field"
        message={deleteBlocked || `Delete "${deleteTarget?.label}"? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel={deleteBlocked ? "Close" : "Cancel"}
        confirmVariant="danger"
        // A field that other fields are shown for is not deleted: the dialog says which, and the server would refuse it as well.
        disableConfirm={deleteBlocked !== ""}
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </section>
  );
}
