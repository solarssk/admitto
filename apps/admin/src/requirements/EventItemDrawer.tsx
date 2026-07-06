import { useEffect, useState } from "react";
import { Button, IconButton, Input, Switch } from "@admitto/ui";
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
import { DEFAULT_EVENT_ITEM_ICON, IconPicker, normalizeEventItemIconForForm } from "./IconPicker.js";
import { slugifyItemKey } from "./itemKey.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import "../attendees/attendees.css";
import "./requirements.css";

export interface EventItemDrawerProps {
  eventId: string;
  item: EventItemDto;
  onClose: () => void;
  onUpdated: () => void;
}

type FormState = {
  label: string;
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
    enabled: item.enabled,
    requires_return: cfg?.requires_return ?? false,
    issue_on_checkin: cfg?.issue_on_checkin ?? false,
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

/** Side drawer to edit or delete a single event item. */
export function EventItemDrawer({ eventId, item, onClose, onUpdated }: EventItemDrawerProps) {
  const [form, setForm] = useState<FormState>(() => toForm(item));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteBlockReason, setDeleteBlockReason] = useState<"in_use" | "default" | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    setForm(toForm(item));
    setError(null);
    setDeleteBlockReason(null);
  }, [item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleteConfirmOpen) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, deleteConfirmOpen]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const contentsResult = validateContentsRows(form.contents);
    if (!contentsResult.ok) {
      setError(contentsResult.message);
      setSaving(false);
      return;
    }

    try {
      await updateEventItem(eventId, item.id, {
        label: form.label.trim(),
        enabled: form.enabled,
        icon: form.icon,
        config: toConfig(form, item.key, contentsResult.contents),
      });
      onUpdated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "item_in_use")) {
        setError(
          "This item has been issued to attendees — record returns before disabling it.",
        );
      } else {
        setError(operatorApiErrorMessage(err, "Failed to save item."));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    setDeleteBlockReason(null);
    try {
      await deleteEventItem(eventId, item.id);
      onUpdated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDeleteBlockReason(
          hasApiErrorCode(err, "default_item_not_deletable") ? "default" : "in_use",
        );
      } else {
        setError(operatorApiErrorMessage(err, "Failed to delete item."));
      }
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }

  function updateContent(index: number, field: "label" | "source_field", value: string) {
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
      <div className="attendee-drawer-backdrop" onClick={onClose} aria-hidden />
      <aside className="attendee-drawer" role="dialog" aria-labelledby="item-drawer-title">
        <div className="attendee-drawer__header">
          <div>
            <h2 id="item-drawer-title" className="attendee-drawer__title">
              {item.label}
            </h2>
            <p className="requirements-item-id">Internal ID: {item.key}</p>
          </div>
          <IconButton label="Close" onClick={onClose} icon={<i className="ti ti-x" />} />
        </div>
        <form className="attendee-drawer__body" onSubmit={(e) => void handleSave(e)}>
          {error && <p className="text-error">{error}</p>}
          {deleteBlockReason === "in_use" && (
            <p className="text-error">
              This item has been issued to attendees — disable it instead of deleting.
            </p>
          )}
          {deleteBlockReason === "default" && (
            <p className="text-error">
              Default items (giftbag, badge, headset) cannot be deleted — disable them instead.
            </p>
          )}

          <div>
            <h3 className="attendee-drawer__section-title">Details</h3>
            <div className="requirements-field-stack">
              <Input
                label="Display name"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                required
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
            <h3 className="attendee-drawer__section-title">Icon</h3>
            <p className="requirements-section-hint">
              Shown on check-in item rows for operators (Tabler outline icon).
            </p>
            <div className="item-icon-preview">
              <i className={`ti ti-${form.icon ?? DEFAULT_EVENT_ITEM_ICON}`} aria-hidden="true" />
              <span>{form.icon ? form.icon : "Default"}</span>
            </div>
            <IconPicker
              key={item.id}
              value={form.icon}
              onChange={(icon) => setForm((f) => ({ ...f, icon }))}
            />
          </div>

          <div>
            <h3 className="attendee-drawer__section-title">Operator hints</h3>
            <p className="requirements-section-hint">
              Shown on the attendee profile and check-in card. Type, required, and select options are
              enforced when admins create or edit attendees.
            </p>
            <div className="requirements-field-stack">
              {form.contents.map((row, i) => (
                <div key={i} className="requirements-contents-row">
                  <Input
                    label="Field label"
                    value={row.label}
                    onChange={(e) => updateContent(i, "label", e.target.value)}
                    placeholder="Shirt size"
                  />
                  <Input
                    label="Import column"
                    value={row.source_field}
                    onChange={(e) => updateContent(i, "source_field", e.target.value)}
                    placeholder="shirt_size"
                    pattern="[a-z0-9_]+"
                    title="Lowercase letters, numbers, and underscores only"
                  />
                  <div className="contents-row__meta">
                    <select
                      value={row.type}
                      onChange={(e) =>
                        updateContentMeta(
                          i,
                          "type",
                          e.target.value as ContentRow["type"],
                        )
                      }
                      className="contents-row__type"
                      aria-label="Field type"
                    >
                      <option value="text">Text</option>
                      <option value="select">Select</option>
                      <option value="boolean">Boolean</option>
                    </select>
                    {row.type === "select" && (
                      <input
                        type="text"
                        placeholder="Options (comma-separated)"
                        value={row.options}
                        onChange={(e) => updateContentMeta(i, "options", e.target.value)}
                        className="contents-row__options"
                        aria-label="Select options"
                      />
                    )}
                    <label className="contents-row__required">
                      <input
                        type="checkbox"
                        checked={row.required}
                        onChange={(e) => updateContentMeta(i, "required", e.target.checked)}
                      />
                      Required
                    </label>
                  </div>
                  <IconButton
                    label="Remove row"
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        contents: f.contents.filter((_, j) => j !== i),
                      }))
                    }
                    icon={<i className="ti ti-trash" />}
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<i className="ti ti-plus" />}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    contents: [...f.contents, emptyContentRow()],
                  }))
                }
              >
                Add field hint
              </Button>
            </div>
          </div>

          <div>
            <h3 className="attendee-drawer__section-title">Item behaviour</h3>
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

          <div className="attendee-form__actions">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={deleting}
              onClick={() => setDeleteConfirmOpen(true)}
            >
              Delete item
            </Button>
          </div>
        </form>
      </aside>
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
