import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Card, EmptyState, IconButton, PageHeader, Switch, useToast } from "@admitto/ui";
import {
  ApiError,
  createEventItem,
  fetchEventItems,
  fetchOpsConfig,
  updateEventItem,
  updateOpsConfig,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventItemDto, OpsConfigDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { EventItemDrawer } from "../requirements/EventItemDrawer.js";
import { DEFAULT_EVENT_ITEM_ICON } from "../requirements/IconPicker.js";
import { slugifyItemKey, uniqueItemKey } from "../requirements/itemKey.js";
import "../requirements/requirements.css";

/** One-line summary of item config for the Requirements table. */
/** Admin screen for per-event item configuration and operational behaviour. */
export function RequirementsPage() {
  const { eventId } = useParams();
  const { reportApiError } = useConnectionState();
  const { addToast } = useToast();
  const listAbortRef = useRef<AbortController | null>(null);

  const [items, setItems] = useState<EventItemDto[]>([]);
  const [opsConfig, setOpsConfig] = useState<OpsConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<EventItemDto | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const addKeyPreview = uniqueItemKey(addLabel, items.map((i) => i.key));

  const [opsSaving, setOpsSaving] = useState(false);

  useEffect(() => {
    setItems([]);
    setOpsConfig(null);
    setSelectedItem(null);
  }, [eventId]);

  const load = useCallback(async () => {
    if (!eventId) return;

    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;

    setLoading(true);
    try {
      const [itemRows, ops] = await Promise.all([
        fetchEventItems(eventId, ac.signal),
        fetchOpsConfig(eventId, ac.signal),
      ]);
      if (ac.signal.aborted) return;
      setItems(itemRows);
      setOpsConfig(ops);
      setLoadError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setItems([]);
      setOpsConfig(null);
      setSelectedItem(null);
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
        setLoadError(
          err.status === 403 ? "You do not have access to this event." : "Failed to load requirements.",
        );
      } else {
        setLoadError("Failed to load requirements.");
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [eventId, reportApiError]);

  useEffect(() => {
    void load();
    return () => listAbortRef.current?.abort();
  }, [load, reloadToken]);

  const badgeItem = items.find((i) => i.key === "badge");
  const badgeWarning =
    opsConfig?.badge_at_entry &&
    (!badgeItem ||
      !badgeItem.enabled ||
      badgeItem.config?.issue_on_checkin === false);
  // "Issue badge at entry" is a no-op without an active badge item — disable
  // the toggle instead of letting operators turn on a setting that can't work.
  const badgeInactive = !badgeItem || !badgeItem.enabled;

  async function handleToggleEnabled(item: EventItemDto) {
    if (!eventId) return;
    try {
      const updated = await updateEventItem(eventId, item.id, { enabled: !item.enabled });
      setItems((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "item_in_use")) {
        addToast(
          "This item has been issued to attendees — record returns before disabling it.",
          "warning",
        );
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to update item."), "error");
      }
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId) return;
    const label = addLabel.trim();
    const key = uniqueItemKey(label, items.map((i) => i.key));
    if (!label || !key) {
      addToast("Enter a name using letters or numbers.", "error");
      return;
    }
    setAdding(true);
    try {
      await createEventItem(eventId, {
        key,
        label,
        config: {
          requires_return: false,
          ...(key === "badge" ? { issue_on_checkin: true } : {}),
        },
      });
      setAddLabel("");
      setAddOpen(false);
      setReloadToken((n) => n + 1);
      addToast("Item added", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        addToast("An item with this name already exists.", "warning");
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to create item."), "error");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleOpsToggle(
    field: keyof OpsConfigDto,
    value: boolean,
  ) {
    if (!eventId || !opsConfig) return;
    setOpsSaving(true);
    const prev = opsConfig;
    setOpsConfig({ ...opsConfig, [field]: value });
    try {
      const next = await updateOpsConfig(eventId, { [field]: value });
      setOpsConfig(next);
      addToast("Setting updated", "success");
    } catch (err) {
      setOpsConfig(prev);
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "badge_item_inactive")) {
        addToast("Can't enable this — the badge item is disabled. Turn it back on first.", "warning");
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to save event behaviour."), "error");
      }
    } finally {
      setOpsSaving(false);
    }
  }

  if (!eventId) return <p>Missing event.</p>;

  return (
    <>
      <PageHeader
        title="Requirements"
        subtitle="Configure what this event issues to attendees and operational behaviour."
      />
      {loadError && !loading ? (
        <EmptyState
          title="Could not load requirements"
          description={loadError}
          action={
            <Button type="button" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
      <section className="requirements-section">
        <Card
          padded={false}
          title="Event items"
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<i className="ti ti-plus" />}
              onClick={() => {
                setAddOpen((o) => !o);
              }}
            >
              Add item
            </Button>
          }
        >
          <div className="attendees-table-wrap">
            <table className="table">
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={3} className="attendees-empty">
                      Loading…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="attendees-empty">
                      No items yet. Add one to configure what operators issue at check-in.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="requirements-item-cell">
                          <i className={`ti ti-${item.icon ?? DEFAULT_EVENT_ITEM_ICON}`} aria-hidden="true" />
                          <div className="requirements-item-info">
                            <div className="requirements-item-name">{item.label}</div>
                            <div className="requirements-item-id">{item.key}</div>
                          </div>
                        </div>
                      </td>
                      <td className="requirements-item-desc-col">
                        {item.description && (
                          <span className="requirements-item-desc">{item.description}</span>
                        )}
                      </td>
                      <td className="requirements-item-actions">
                        <div className="requirements-item-actions__wrap">
                          <Switch
                            label={item.enabled ? "On" : "Off"}
                            checked={item.enabled}
                            onChange={() => void handleToggleEnabled(item)}
                            aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.label}`}
                          />
                          <IconButton
                            label="Edit item"
                            icon={<i className="ti ti-pencil" aria-hidden="true" />}
                            onClick={() => setSelectedItem(item)}
                          />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section className="requirements-section">
        <Card title="Event behaviour" padded={false}>
          {opsConfig == null && loading ? (
            <p>Loading…</p>
          ) : opsConfig ? (
            <>
              <div className="requirements-behaviour-row">
                <div className="requirements-behaviour-row__text">
                  <strong>Issue badge at entry</strong>
                  <p>
                    Auto-issues the badge item when an attendee is admitted. Requires the badge
                    item to exist, be active, and have "Issue on check-in" enabled.
                  </p>
                </div>
                <span
                  className={badgeInactive ? "at-tooltip" : undefined}
                  data-tooltip={
                    badgeInactive
                      ? "Can't enable this — the badge item is disabled. Turn it back on first."
                      : undefined
                  }
                >
                  <Switch
                    checked={opsConfig.badge_at_entry}
                    disabled={opsSaving || badgeInactive}
                    onChange={(e) => void handleOpsToggle("badge_at_entry", e.target.checked)}
                    aria-label="Issue badge at entry"
                  />
                </span>
              </div>
              {badgeWarning && (
                <p className="requirements-warning">
                  Badge at entry is on, but check-in will not auto-issue a badge — enable the
                  badge item and turn on “Issue on check-in”.
                </p>
              )}
              <div className="requirements-behaviour-row">
                <div className="requirements-behaviour-row__text">
                  <strong>Require confirmation on scan</strong>
                  <p>Scan shows a preview; operator must confirm before check-in is recorded.</p>
                </div>
                <Switch
                  checked={opsConfig.require_confirm_on_scan}
                  disabled={opsSaving}
                  onChange={(e) =>
                    void handleOpsToggle("require_confirm_on_scan", e.target.checked)
                  }
                  aria-label="Require confirmation on scan"
                />
              </div>
              <div className="requirements-behaviour-row">
                <div className="requirements-behaviour-row__text">
                  <strong>Allow manual lookup</strong>
                  <p>
                    When off, operators can only check in via QR scan — name and short-query
                    search are blocked in the check-in screen. Does not affect the admin Attendees
                    page.
                  </p>
                </div>
                <Switch
                  checked={opsConfig.allow_manual_lookup}
                  disabled={opsSaving}
                  onChange={(e) => void handleOpsToggle("allow_manual_lookup", e.target.checked)}
                  aria-label="Allow manual lookup"
                />
              </div>
              <div className="requirements-behaviour-row">
                <div className="requirements-behaviour-row__text">
                  <strong>Auto-advance after valid check-in</strong>
                  <p>
                    After a valid scan, the check-in screen clears automatically for the next
                    attendee — without tapping Next.
                  </p>
                </div>
                <Switch
                  checked={opsConfig.auto_advance_on_valid}
                  disabled={opsSaving}
                  onChange={(e) =>
                    void handleOpsToggle("auto_advance_on_valid", e.target.checked)
                  }
                  aria-label="Auto-advance on valid scan"
                />
              </div>
            </>
          ) : null}
        </Card>
      </section>
        </>
      )}

      {addOpen && (
        <div className="event-item-modal" role="dialog" aria-modal="true" aria-label="Add item">
          <div
            className="event-item-modal__backdrop"
            onClick={() => {
              setAddOpen(false);
              setAddLabel("");
            }}
          />
          <div className="event-item-modal__panel">
            <div className="event-item-modal__header">
              <div>
                <h2 className="event-item-modal__title">Add item</h2>
                <p className="event-item-modal__subtitle">
                  A physical item or resource issued or tracked at check-in — for example a gift
                  bag, badge, or headset. You can configure rules after creating it.
                </p>
              </div>
            </div>
            <form
              id="add-item-form"
              className="event-item-modal__body"
              onSubmit={(e) => void handleAddItem(e)}
            >
              <div className="at-field">
                <div className="add-item-label-row">
                  <label className="at-label" htmlFor="add-item-input">
                    Item name
                  </label>
                  {addLabel.trim() && (
                    <span className="at-hint">
                      ID: <code>{addKeyPreview || slugifyItemKey(addLabel) || "—"}</code>
                      {addKeyPreview && addKeyPreview !== slugifyItemKey(addLabel) && (
                        <> (unique suffix added)</>
                      )}
                    </span>
                  )}
                </div>
                <input
                  id="add-item-input"
                  className="at-input"
                  type="text"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="Gift bag"
                  required
                  autoFocus
                />
                <span className="at-hint">
                  The name shown to staff during check-in. Keep it short and clear — e.g. "Gift
                  bag", "Name badge", "T-shirt".
                </span>
              </div>
            </form>
            <div className="event-item-modal__footer">
              <Button
                type="submit"
                form="add-item-form"
                variant="primary"
                disabled={adding || !addLabel.trim()}
              >
                {adding ? "Creating…" : "Create item"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAddOpen(false);
                  setAddLabel("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {selectedItem && (
        <EventItemDrawer
          eventId={eventId}
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdated={() => {
            setReloadToken((n) => n + 1);
            setSelectedItem(null);
          }}
        />
      )}
    </>
  );
}
