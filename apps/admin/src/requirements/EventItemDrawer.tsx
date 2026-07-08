import { useRef, useEffect, useState } from "react";
import { Button, IconButton, Input, Switch, useToast } from "@admitto/ui";
import {
  ApiError,
  deleteEventItem,
  updateEventItem,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventItemConfigDto, EventItemContentDto, EventItemDto } from "../api/types.js";
import {
  type ContentRow,
  contentRowFromDto,
  isValidSourceFieldSlug,
  validateContentsRows,
} from "./eventItemContentsForm.js";
import { IconPicker, normalizeEventItemIconForForm } from "./IconPicker.js";
import { slugifyItemKey } from "./itemKey.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import "./requirements.css";

export interface EventItemDrawerProps {
  eventId: string;
  item: EventItemDto;
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
  contents: ContentRow[];
};

function emptyContentRow(): ContentRow {
  return { label: "", source_field: "", type: "text", required: false, options: "" };
}

/** Resolve contents rows from API config, including legacy `size_field`. */
function contentsFromConfig(cfg: EventItemConfigDto | null): ContentRow[] {
  if (!cfg) return [];
  if (cfg.contents?.length) {
    return cfg.contents.map(contentRowFromDto);
  }
  const legacy = cfg as EventItemConfigDto & { size_field?: string };
  if (typeof legacy.size_field === "string" && legacy.size_field.trim()) {
    const source_field = legacy.size_field.trim();
    if (isValidSourceFieldSlug(source_field)) {
      return [{ label: "Shirt size", source_field, type: "text", required: false, options: "" }];
    }
  }
  return [];
}

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
    contents: contentsFromConfig(cfg),
  };
}

/** Build PATCH payload; `issue_on_checkin` is persisted only for the badge item. */
function toConfig(
  form: FormState,
  itemKey: string,
  contents: EventItemContentDto[],
): EventItemConfigDto {
  const config: EventItemConfigDto = {
    requires_return: form.requires_return,
  };
  if (itemKey === "badge") {
    config.issue_on_checkin = form.issue_on_checkin;
  }
  if (contents.length > 0) {
    config.contents = contents;
  }
  return config;
}

/** Centered modal to edit or delete a single event item. */
export function EventItemDrawer({ eventId, item, onClose, onUpdated }: EventItemDrawerProps) {
  const { addToast } = useToast();
  const [form, setForm] = useState<FormState>(() => toForm(item));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [contentsError, setContentsError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, !deleteConfirmOpen, onClose);
  // "badge" is auto-recreated by the server (ensureBadgeEventItem) — deleting it
  // would silently reappear, so deletion is blocked; disable it instead.
  const isDefaultItem = item.key === "badge";

  useEffect(() => {
    setForm(toForm(item));
  }, [item]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const contentsResult = validateContentsRows(form.contents);
    if (!contentsResult.ok) {
      setContentsError(contentsResult.message);
      setSaving(false);
      return;
    }
    setContentsError(null);

    try {
      await updateEventItem(eventId, item.id, {
        label: form.label.trim(),
        description: form.description.trim() || null,
        enabled: form.enabled,
        icon: form.icon,
        config: toConfig(form, item.key, contentsResult.contents),
      });
      onUpdated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "item_in_use")) {
        addToast(
          "This item has been issued to attendees — record returns before disabling it.",
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
          "This item has been issued to attendees — disable it instead of deleting.",
          "warning",
        );
      } else if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "default_item")) {
        addToast(
          "\u201cBadge\u201d is a default item and can't be deleted — turn off Active instead.",
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

  function updateContent(index: number, field: "label" | "source_field", value: string) {
    setContentsError(null);
    setForm((f) => {
      const contents = [...f.contents];
      const row = { ...contents[index], [field]: value };
      if (field === "label") {
        const prevSlug = slugifyItemKey(contents[index].label);
        const currentField = contents[index].source_field.trim();
        if (!currentField || currentField === prevSlug) {
          row.source_field = slugifyItemKey(value);
        }
      }
      contents[index] = row;
      return { ...f, contents };
    });
  }

  function updateContentMeta(
    index: number,
    field: "type" | "required" | "options",
    value: string | boolean,
  ) {
    setContentsError(null);
    setForm((f) => {
      const contents = [...f.contents];
      const row = { ...contents[index], [field]: value };
      if (field === "type" && value !== "select") {
        row.options = "";
      }
      contents[index] = row;
      return { ...f, contents };
    });
  }

  return (
    <>
      <div
        className="event-item-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-modal-title"
      >
        <div className="event-item-modal__backdrop" role="presentation" onClick={onClose} />
        <div ref={panelRef} className="event-item-modal__panel">
          <div className="event-item-modal__header">
            <div>
              <h2 id="item-modal-title" className="event-item-modal__title">
                {item.label}
              </h2>
              <p className="requirements-item-id">Internal ID: {item.key}</p>
            </div>
            <IconButton label="Close" onClick={onClose} icon={<i className="ti ti-x" />} />
          </div>
          <form id="item-edit-form" className="event-item-modal__body" onSubmit={(e) => void handleSave(e)}>
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
                Display an attendee data field (e.g. shirt size) next to this item at check-in — useful
                when the item varies per person.
              </p>
              {contentsError && (
                <p id="contents-error" className="text-error" role="alert">
                  {contentsError}
                </p>
              )}
              <div className="requirements-field-stack">
                {form.contents.map((row, i) => (
                  <div key={i} className="requirements-contents-row">
                    <div className="contents-row__label-group">
                      <div className="contents-row__label-line">
                        <label className="at-label" htmlFor={`hint-label-${i}`}>
                          Display label
                        </label>
                        <div className="contents-row__label-line-actions">
                          <label className="contents-row__required">
                            <input
                              type="checkbox"
                              checked={row.required}
                              onChange={(e) => updateContentMeta(i, "required", e.target.checked)}
                            />
                            Required
                          </label>
                          <IconButton
                            label="Remove row"
                            type="button"
                            size="sm"
                            onClick={() => {
                              setContentsError(null);
                              setForm((f) => ({
                                ...f,
                                contents: f.contents.filter((_, j) => j !== i),
                              }));
                            }}
                            icon={<i className="ti ti-trash" />}
                          />
                        </div>
                      </div>
                      <input
                        id={`hint-label-${i}`}
                        className="at-input"
                        value={row.label}
                        onChange={(e) => updateContent(i, "label", e.target.value)}
                        placeholder="Shirt size"
                      />
                    </div>

                    <div className="contents-row__key-row">
                      <div className="at-field" style={{ flex: 1 }}>
                        <label className="at-label" htmlFor={`hint-key-${i}`}>
                          Import key
                        </label>
                        <input
                          id={`hint-key-${i}`}
                          className="at-input"
                          value={row.source_field}
                          onChange={(e) => updateContent(i, "source_field", e.target.value)}
                          placeholder="shirt_size"
                          pattern="[a-z0-9_]+"
                          title="Lowercase letters, numbers, and underscores only"
                        />
                      </div>
                      <div
                        className="contents-row__type-picker"
                        role="group"
                        aria-label="Field type"
                      >
                        {(
                          [
                            { value: "text", icon: "ti-letter-case", label: "Text" },
                            { value: "select", icon: "ti-list", label: "Select" },
                            { value: "boolean", icon: "ti-checkbox", label: "Boolean" },
                          ] as const
                        ).map(({ value, icon, label: btnLabel }) => (
                          <button
                            key={value}
                            type="button"
                            className={`contents-row__type-btn${row.type === value ? " contents-row__type-btn--active" : ""}`}
                            onClick={() => updateContentMeta(i, "type", value)}
                            data-tooltip={btnLabel}
                            aria-pressed={row.type === value}
                            aria-label={btnLabel}
                          >
                            <i className={`ti ${icon}`} />
                          </button>
                        ))}
                      </div>
                    </div>

                    {row.type === "select" && (
                      <div className="at-field">
                        <label className="at-label" htmlFor={`hint-opts-${i}`}>
                          Options (one per line)
                        </label>
                        <textarea
                          id={`hint-opts-${i}`}
                          className="at-textarea"
                          rows={3}
                          value={row.options}
                          onChange={(e) =>
                            updateContentMeta(i, "options", e.target.value)
                          }
                          placeholder={"XL\nL\nM\nS"}
                          aria-label="Select options"
                        />
                      </div>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={<i className="ti ti-plus" />}
                  onClick={() => {
                    setContentsError(null);
                    setForm((f) => ({
                      ...f,
                      contents: [...f.contents, emptyContentRow()],
                    }));
                  }}
                >
                  Add field hint
                </Button>
              </div>
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
            <Button type="submit" form="item-edit-form" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            {/* Tooltip wraps the button rather than living on it directly: a
                disabled button gets opacity:0.5 from .at-btn:disabled, which
                would otherwise wash out the tooltip's own dark background
                since it's rendered as that button's ::after pseudo-element. */}
            <span
              className={isDefaultItem ? "at-tooltip" : undefined}
              data-tooltip={
                isDefaultItem
                  ? "Default item — required for \u201cIssue badge at entry\u201d. Turn off Active instead."
                  : undefined
              }
            >
              {isDefaultItem && (
                <span id="delete-item-reason" className="sr-only">
                  Default item — required for "Issue badge at entry". Turn off Active instead.
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
            </span>
          </div>
        </div>
      </div>
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
