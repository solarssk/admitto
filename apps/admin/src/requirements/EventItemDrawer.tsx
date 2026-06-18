import { useEffect, useState } from "react";
import { Button, Checkbox, IconButton, Input, Switch } from "@admitto/ui";
import {
  ApiError,
  deleteEventItem,
  updateEventItem,
} from "../api/client.js";
import type { EventItemConfigDto, EventItemDto } from "../api/types.js";
import "../attendees/attendees.css";

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
  contents: { label: string; source_field: string }[];
};

const SLUG_PATTERN = /^[a-z0-9_]+$/;

/** Resolve contents rows from API config, including legacy `size_field`. */
function contentsFromConfig(cfg: EventItemConfigDto | null): { label: string; source_field: string }[] {
  if (!cfg) return [];
  if (cfg.contents?.length) {
    return cfg.contents.map((c) => ({ label: c.label, source_field: c.source_field }));
  }
  const legacy = cfg as EventItemConfigDto & { size_field?: string };
  if (typeof legacy.size_field === "string" && legacy.size_field.trim()) {
    const source_field = legacy.size_field.trim();
    if (SLUG_PATTERN.test(source_field)) {
      return [{ label: "Shirt size", source_field }];
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
    contents: contentsFromConfig(cfg),
  };
}

/** Build PATCH payload; `issue_on_checkin` is persisted only for the badge item. */
function toConfig(form: FormState, itemKey: string): EventItemConfigDto {
  const config: EventItemConfigDto = {
    requires_return: form.requires_return,
  };
  if (itemKey === "badge") {
    config.issue_on_checkin = form.issue_on_checkin;
  }
  const contents = form.contents
    .map((c) => ({ label: c.label.trim(), source_field: c.source_field.trim() }))
    .filter((c) => c.label && c.source_field && SLUG_PATTERN.test(c.source_field));
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

  useEffect(() => {
    setForm(toForm(item));
    setError(null);
    setDeleteBlockReason(null);
  }, [item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateEventItem(eventId, item.id, {
        label: form.label.trim(),
        enabled: form.enabled,
        config: toConfig(form, item.key),
      });
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete item "${item.label}"? This cannot be undone.`)) return;
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
          err.message === "default_item_not_deletable" ? "default" : "in_use",
        );
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to delete item.");
      }
    } finally {
      setDeleting(false);
    }
  }

  function updateContent(index: number, field: "label" | "source_field", value: string) {
    setForm((f) => {
      const contents = [...f.contents];
      contents[index] = { ...contents[index], [field]: value };
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
              Edit item
            </h2>
            <p className="requirements-item-key">{item.key}</p>
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
            <div className="attendee-form">
              <Input
                label="Label"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                required
              />
              <Checkbox
                label="Enabled"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
            </div>
          </div>

          <div>
            <h3 className="attendee-drawer__section-title">Contents hints</h3>
            <p className="requirements-behaviour-row__text">
              <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
                Shown to operators on the attendee card for this item.
              </span>
            </p>
            <div className="attendee-form">
              {form.contents.map((row, i) => (
                <div key={i} className="requirements-contents-row">
                  <Input
                    label="Label"
                    value={row.label}
                    onChange={(e) => updateContent(i, "label", e.target.value)}
                    placeholder="Shirt size"
                  />
                  <Input
                    label="Source field"
                    value={row.source_field}
                    onChange={(e) => updateContent(i, "source_field", e.target.value)}
                    placeholder="shirt_size"
                  />
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
                    contents: [...f.contents, { label: "", source_field: "" }],
                  }))
                }
              >
                Add row
              </Button>
            </div>
          </div>

          <div>
            <h3 className="attendee-drawer__section-title">Item behaviour</h3>
            <div className="attendee-form">
              <Checkbox
                label="Requires return"
                checked={form.requires_return}
                onChange={(e) =>
                  setForm((f) => ({ ...f, requires_return: e.target.checked }))
                }
              />
              {item.key === "badge" && (
                <Checkbox
                  label="Issue on check-in"
                  checked={form.issue_on_checkin}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, issue_on_checkin: e.target.checked }))
                  }
                />
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
              onClick={() => void handleDelete()}
            >
              Delete item
            </Button>
          </div>
        </form>
      </aside>
    </>
  );
}
