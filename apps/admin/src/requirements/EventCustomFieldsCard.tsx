import { useState } from "react";
import { Button, Card, HintLabel, IconButton, useToast } from "@admitto/ui";
import { ApiError, deleteEventCustomField } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventCustomFieldDto, EventDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { customFieldTypeIcon } from "./customFieldType.js";
import { EventCustomFieldModal } from "./EventCustomFieldModal.js";

const CUSTOM_FIELDS_HINT =
  "Also used in the attendee form, CSV import, and exports. Fields used as item hints can't be deleted until removed from the item.";

export interface EventCustomFieldsCardProps {
  readonly eventId: string;
  readonly event: EventDto;
  readonly fields: EventCustomFieldDto[];
  readonly loading: boolean;
  readonly showLoading: boolean;
  readonly onChanged: () => void;
}

function CustomFieldRow({
  field,
  event,
  onEdit,
  onDelete,
}: {
  readonly field: EventCustomFieldDto;
  readonly event: EventDto;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <tr>
      <td>
        <div className="requirements-item-cell">
          <i className={`ti ${customFieldTypeIcon(field.type)}`} aria-hidden="true" />
          <div className="requirements-item-info">
            <div className="requirements-item-name">{field.label}</div>
            <div className="requirements-item-id">{field.source_field}</div>
          </div>
        </div>
      </td>
      <td className="requirements-type-col">{field.type}</td>
      <td>{field.required ? "Yes" : "No"}</td>
      <td className="requirements-item-actions">
        <div className="requirements-item-actions__wrap">
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

/** Requirements screen card: manages the event's custom attendee data field registry
 * (dietary, shirt size, ...) — the single source of truth consumed by attendee edit/create,
 * import, export, and referenced by items as operator hints (see EventItemDrawer). */
export function EventCustomFieldsCard({ eventId, event, fields, loading, showLoading, onChanged }: EventCustomFieldsCardProps) {
  const { addToast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editField, setEditField] = useState<EventCustomFieldDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventCustomFieldDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  function closeModal() {
    setAddOpen(false);
    setEditField(null);
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

  function renderRows() {
    if (loading) {
      if (!showLoading) return null;
      return (
        <tr>
          <td colSpan={4} className="attendees-empty">
            Loading…
          </td>
        </tr>
      );
    }
    if (fields.length === 0) {
      return (
        <tr>
          <td colSpan={4} className="attendees-empty">
            No custom fields yet. Add one to collect extra attendee data, like dietary
            requirements.
          </td>
        </tr>
      );
    }
    return fields.map((field) => (
      <CustomFieldRow
        key={field.id}
        field={field}
        event={event}
        onEdit={() => setEditField(field)}
        onDelete={() => setDeleteTarget(field)}
      />
    ));
  }

  return (
    <section className="requirements-section">
      <Card
        padded={false}
        title={<HintLabel hint={CUSTOM_FIELDS_HINT}>Custom attendee fields</HintLabel>}
        actions={
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
        }
      >
        <div className="attendees-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Field</th>
                <th className="requirements-type-col">Type</th>
                <th>Required</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>{renderRows()}</tbody>
          </table>
        </div>
      </Card>

      {(addOpen || editField) && (
        <EventCustomFieldModal
          eventId={eventId}
          field={editField}
          onClose={closeModal}
          onSaved={() => {
            closeModal();
            onChanged();
          }}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete custom field"
        message={`Delete "${deleteTarget?.label}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </section>
  );
}
