import { useRef, useEffect, useState } from "react";
import { Button, IconButton, Input, ModalBackdrop, Notice, Switch, Tooltip, useToast } from "@admitto/ui";
import {
  ApiError,
  deleteEventItem,
  updateEventItem,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventCustomFieldDto, EventItemConfigDto, EventItemDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { customFieldTypeIcon } from "./customFieldType.js";
import { DEFAULT_EVENT_ITEM_ICON, IconPicker, normalizeEventItemIconForForm } from "./IconPicker.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import "./requirements.css";

export interface EventItemDrawerProps {
  eventId: string;
  item: EventItemDto;
  /** The event's full custom field registry, for the "show as hint here" picker. */
  customFields: EventCustomFieldDto[];
  onClose: () => void;
  onUpdated: () => void;
}

type FormState = {
  label: string;
  description: string;
  enabled: boolean;
  requires_return: boolean;
  issue_on_checkin: boolean;
  icon: string | null;
  content_fields: string[];
};

/** Map API item row to editable drawer form state. */
function toForm(item: EventItemDto): FormState {
  const cfg = item.config ?? null;
  return {
    label: item.label,
    description: item.description ?? "",
    enabled: item.enabled,
    requires_return: cfg?.requires_return ?? false,
    // Match check-in runtime: only explicit false disables auto-issue.
    issue_on_checkin: cfg?.issue_on_checkin !== false,
    icon: normalizeEventItemIconForForm(item.icon),
    content_fields: cfg?.content_fields ?? [],
  };
}

/** Build PATCH payload; `issue_on_checkin` is persisted only for the badge item.
 * content_fields is always included, even empty - omitting it when the operator unchecks
 * everything would leave the server unable to tell "clear it" apart from "don't touch it". */
function toConfig(form: FormState, itemKey: string): EventItemConfigDto {
  const config: EventItemConfigDto = {
    requires_return: form.requires_return,
    content_fields: form.content_fields,
  };
  if (itemKey === "badge") {
    config.issue_on_checkin = form.issue_on_checkin;
  }
  return config;
}

/** Centered modal to edit or delete a single event item. */
export function EventItemDrawer({ eventId, item, customFields, onClose, onUpdated }: EventItemDrawerProps) {
  const { addToast } = useToast();
  const [form, setForm] = useState<FormState>(() => toForm(item));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, !deleteConfirmOpen, onClose);
  // "badge" is auto-recreated by the server (ensureBadgeEventItem) — deleting it
  // would silently reappear, so deletion is blocked; disable it instead.
  const isDefaultItem = item.key === "badge";
  const headerIcon = form.icon ?? item.icon ?? DEFAULT_EVENT_ITEM_ICON;
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(item));

  useEffect(() => {
    setForm(toForm(item));
  }, [item]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateEventItem(eventId, item.id, {
        label: form.label.trim(),
        description: form.description.trim() || null,
        enabled: form.enabled,
        icon: form.icon,
        config: toConfig(form, item.key),
      });
      onUpdated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "item_in_use")) {
        addToast(
          "This item has been issued to attendees. Record returns before disabling it.",
          "warning",
        );
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to save item."), "error");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteEventItem(eventId, item.id);
      onUpdated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "item_in_use")) {
        addToast(
          "This item has been issued to attendees. Disable it instead of deleting.",
          "warning",
        );
      } else if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "default_item")) {
        addToast(
          "“Badge” is a default item and can't be deleted. Turn off Active instead.",
          "warning",
        );
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to delete item."), "error");
      }
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }

  function toggleContentField(sourceField: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      content_fields: checked
        ? [...f.content_fields, sourceField]
        : f.content_fields.filter((sf) => sf !== sourceField),
    }));
  }

  return (
    <>
      <dialog
        open
        className="event-item-modal"
        aria-modal="true"
        aria-labelledby="item-modal-title"
      >
        <ModalBackdrop onClose={onClose} />
        <div ref={panelRef} className="event-item-modal__panel">
          <div className="event-item-modal__scroll at-scroll">
            <div className="event-item-modal__header">
              <div>
                <h2 id="item-modal-title" className="event-item-modal__title">
                  <i className={`ti ti-${headerIcon}`} aria-hidden="true" />
                  {item.label}
                </h2>
                <p className="event-item-modal__id">
                  Internal ID: <code>{item.key}</code>
                </p>
              </div>
              <IconButton label="Close" onClick={onClose} icon={<i className="ti ti-x" />} />
            </div>
            <form id="item-edit-form" className="event-item-modal__body" onSubmit={(e) => void handleSave(e)}>
              {isDefaultItem && (
                <Notice variant="info">
                  Badge is the default item used by "Issue badge at entry". It cannot be deleted, but you can turn it
                  off when automatic badge issuing is not needed.
                </Notice>
              )}
              <div>
                <h3 className="event-item-modal__section-title">Details</h3>
                <div className="requirements-field-stack">
                  <Input
                    label="Display name"
                    value={form.label}
                    onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                    required
                  />
                  <Input
                    label="Description (shown to operators)"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Physical package distributed at the door."
                  />
                  <div className="requirements-toggle-row">
                    <div className="requirements-toggle-row__text">
                      <strong>Active</strong>
                      <p>Inactive items are hidden from check-in operators.</p>
                    </div>
                    <Switch
                      label={form.enabled ? "On" : "Off"}
                      checked={form.enabled}
                      onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                      aria-label="Item active"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="event-item-modal__section-title">Icon</h3>
                <p className="requirements-section-hint">Shown on the check-in card for operators.</p>
                <IconPicker
                  key={item.id}
                  value={form.icon}
                  onChange={(icon) => setForm((f) => ({ ...f, icon }))}
                />
              </div>

              <div>
                <h3 className="event-item-modal__section-title">Attendee data field</h3>
                <p className="requirements-section-hint">
                  Show one or more custom attendee fields next to this item at check-in. Useful when
                  the item varies per person (e.g. shirt size on a gift bag). Manage the fields
                  themselves in the "Custom attendee fields" card above.
                </p>
                {customFields.length === 0 ? (
                  <Notice variant="info">
                    No custom fields defined for this event yet. Add fields in Custom attendee fields
                    above, then link them here.
                  </Notice>
                ) : (
                  <div className="requirements-field-stack">
                    {customFields.map((field) => (
                      <label
                        key={field.id}
                        className="requirements-item-cell requirements-field-picker-row"
                      >
                        <input
                          type="checkbox"
                          aria-label={field.label}
                          checked={form.content_fields.includes(field.source_field)}
                          onChange={(e) => toggleContentField(field.source_field, e.target.checked)}
                        />
                        <i className={`ti ${customFieldTypeIcon(field.type)}`} aria-hidden="true" />
                        <div className="requirements-item-info">
                          <div className="requirements-item-name">{field.label}</div>
                          <div className="requirements-item-id">
                            <code>{field.source_field}</code>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="event-item-modal__section-title">Item behaviour</h3>
                <div className="requirements-field-stack">
                  <div className="requirements-toggle-row">
                    <div className="requirements-toggle-row__text">
                      <strong>Requires return</strong>
                      <p>Track when this item must be returned (e.g. headset).</p>
                    </div>
                    <Switch
                      label={form.requires_return ? "On" : "Off"}
                      checked={form.requires_return}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, requires_return: e.target.checked }))
                      }
                      aria-label="Requires return"
                    />
                  </div>
                  {item.key === "badge" && (
                    <div className="requirements-toggle-row">
                      <div className="requirements-toggle-row__text">
                        <strong>Issue on check-in</strong>
                        <p>Automatically mark badge as issued when attendee is admitted.</p>
                      </div>
                      <Switch
                        label={form.issue_on_checkin ? "On" : "Off"}
                        checked={form.issue_on_checkin}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, issue_on_checkin: e.target.checked }))
                        }
                        aria-label="Issue on check-in"
                      />
                    </div>
                  )}
                </div>
              </div>
            </form>
            <div className="event-item-modal__footer">
              <Tooltip
                content={
                  isDefaultItem
                    ? "Default item required for “Issue badge at entry”. Turn off Active instead."
                    : undefined
                }
              >
                {isDefaultItem && (
                  <span id="delete-item-reason" className="sr-only">
                    Default item required for "Issue badge at entry". Turn off Active instead.
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={deleting || isDefaultItem}
                  onClick={() => setDeleteConfirmOpen(true)}
                  aria-describedby={isDefaultItem ? "delete-item-reason" : undefined}
                >
                  Delete item
                </Button>
              </Tooltip>
              <div className="event-item-modal__footer-end">
                <Button type="button" variant="ghost" disabled={saving || deleting} onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" form="item-edit-form" variant="primary" disabled={saving || deleting || !dirty}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </dialog>
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete item"
        message={`Delete item "${item.label}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
