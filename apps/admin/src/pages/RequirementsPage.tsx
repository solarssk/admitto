import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Card, Input, PageHeader, Switch } from "@admitto/ui";
import {
  ApiError,
  createEventItem,
  fetchEventItems,
  fetchOpsConfig,
  updateEventItem,
  updateOpsConfig,
} from "../api/client.js";
import type { EventItemDto, OpsConfigDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { EventItemDrawer } from "../requirements/EventItemDrawer.js";
import { slugifyItemKey, uniqueItemKey } from "../requirements/itemKey.js";
import "../requirements/requirements.css";

/** One-line summary of item config for the Requirements table. */
function configSummary(config: EventItemDto["config"]): string {
  if (!config) return "—";
  const parts: string[] = [];
  if (config.contents?.length) {
    parts.push(
      config.contents.map((c) => `${c.label} ← ${c.source_field}`).join(", "),
    );
  }
  if (config.requires_return) parts.push("requires return");
  if (config.issue_on_checkin) parts.push("issue on check-in");
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** Admin screen for per-event item configuration and operational behaviour. */
export function RequirementsPage() {
  const { eventId } = useParams();
  const { reportApiError } = useConnectionState();
  const listAbortRef = useRef<AbortController | null>(null);

  const [items, setItems] = useState<EventItemDto[]>([]);
  const [opsConfig, setOpsConfig] = useState<OpsConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<EventItemDto | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const addKeyPreview = uniqueItemKey(addLabel, items.map((i) => i.key));

  const [opsSaving, setOpsSaving] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);

  useEffect(() => {
    setItems([]);
    setOpsConfig(null);
    setSelectedItem(null);
    setError(null);
    setOpsError(null);
  }, [eventId]);

  const load = useCallback(async () => {
    if (!eventId) return;

    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const [itemRows, ops] = await Promise.all([
        fetchEventItems(eventId, ac.signal),
        fetchOpsConfig(eventId, ac.signal),
      ]);
      if (ac.signal.aborted) return;
      setItems(itemRows);
      setOpsConfig(ops);
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
        setError(err.status === 403 ? "You do not have access to this event." : "Failed to load requirements.");
      } else {
        setError("Failed to load requirements.");
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

  async function handleToggleEnabled(item: EventItemDto) {
    if (!eventId) return;
    try {
      const updated = await updateEventItem(eventId, item.id, { enabled: !item.enabled });
      setItems((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.message === "item_in_use") {
        setError(
          "This item has been issued to attendees — record returns before disabling it.",
        );
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to update item.");
      }
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId) return;
    const label = addLabel.trim();
    const key = uniqueItemKey(label, items.map((i) => i.key));
    if (!label || !key) {
      setAddError("Enter a name using letters or numbers.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      await createEventItem(eventId, { key, label });
      setAddLabel("");
      setAddOpen(false);
      setReloadToken((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setAddError("An item with this name already exists.");
      } else {
        setAddError(err instanceof ApiError ? err.message : "Failed to create item.");
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
    setOpsError(null);
    const prev = opsConfig;
    setOpsConfig({ ...opsConfig, [field]: value });
    try {
      const next = await updateOpsConfig(eventId, { [field]: value });
      setOpsConfig(next);
    } catch (err) {
      setOpsConfig(prev);
      setOpsError(err instanceof ApiError ? err.message : "Failed to save event behaviour.");
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
      {error && <p className="text-error">{error}</p>}

      <section className="requirements-section">
        <div className="requirements-section__header">
          <h2 className="requirements-section__title">Event items</h2>
          <Button
            variant="secondary"
            icon={<i className="ti ti-plus" />}
            onClick={() => {
              setAddOpen((o) => !o);
              setAddError(null);
            }}
          >
            Add item
          </Button>
        </div>

        <Card padded={false}>
          {addOpen && (
            <form className="requirements-add-form" onSubmit={(e) => void handleAddItem(e)}>
              <div className="requirements-add-form__main">
                <Input
                  label="Item name"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="Gift bag"
                  required
                  autoFocus
                />
                {addLabel.trim() && (
                  <p className="requirements-add-form__hint">
                    Internal ID:{" "}
                    <code>{addKeyPreview || slugifyItemKey(addLabel) || "—"}</code>
                    {addKeyPreview && addKeyPreview !== slugifyItemKey(addLabel) && (
                      <> (name already taken — using unique suffix)</>
                    )}
                  </p>
                )}
              </div>
              <div className="requirements-add-form__actions">
                <Button type="submit" variant="primary" disabled={adding || !addLabel.trim()}>
                  {adding ? "Creating…" : "Create item"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAddOpen(false);
                    setAddLabel("");
                    setAddError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
              {addError && <p className="text-error requirements-add-form__error">{addError}</p>}
            </form>
          )}

          <div className="attendees-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Active</th>
                  <th>Rules</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="attendees-empty">
                      Loading…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="attendees-empty">
                      No items yet. Add one to configure what operators issue at check-in.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="requirements-item-name">{item.label}</div>
                        <div className="requirements-item-id">{item.key}</div>
                      </td>
                      <td>
                        <Switch
                          label={item.enabled ? "On" : "Off"}
                          checked={item.enabled}
                          onChange={() => void handleToggleEnabled(item)}
                          aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.label}`}
                        />
                      </td>
                      <td>
                        <span className="requirements-config-summary" title={configSummary(item.config)}>
                          {configSummary(item.config)}
                        </span>
                      </td>
                      <td>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedItem(item)}>
                          Edit
                        </Button>
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
        <h2 className="requirements-section__title">Event behaviour</h2>
        {opsError && <p className="text-error">{opsError}</p>}
        <Card>
          {opsConfig == null && loading ? (
            <p>Loading…</p>
          ) : opsConfig ? (
            <>
              <div className="requirements-behaviour-row">
                <div className="requirements-behaviour-row__text">
                  <strong>Issue badge at entry</strong>
                  <p>Automatically issue the badge item when an attendee is admitted.</p>
                </div>
                <Switch
                  checked={opsConfig.badge_at_entry}
                  disabled={opsSaving}
                  onChange={(e) => void handleOpsToggle("badge_at_entry", e.target.checked)}
                  aria-label="Issue badge at entry"
                />
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
                  <p>Scan shows a preview; operator must confirm before check-in.</p>
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
                  <p>Operators can search attendees by name when scan is unavailable.</p>
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
                  <strong>Auto-advance on valid scan</strong>
                  <p>After a successful scan, move to the next attendee automatically.</p>
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
