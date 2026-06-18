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
import "../requirements/requirements.css";

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
  const [addKey, setAddKey] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [opsSaving, setOpsSaving] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);

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
    (!badgeItem || !badgeItem.enabled);

  async function handleToggleEnabled(item: EventItemDto) {
    if (!eventId) return;
    try {
      const updated = await updateEventItem(eventId, item.id, { enabled: !item.enabled });
      setItems((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update item.");
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId) return;
    setAdding(true);
    setAddError(null);
    try {
      await createEventItem(eventId, {
        key: addKey.trim(),
        label: addLabel.trim(),
      });
      setAddKey("");
      setAddLabel("");
      setAddOpen(false);
      setReloadToken((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setAddError("An item with this key already exists for this event.");
      } else {
        setAddError(err instanceof ApiError ? err.message : "Failed to create item.");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleOpsToggle(
    field: "badge_at_entry" | "require_confirm_on_scan",
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
          <h2 className="attendee-drawer__section-title" style={{ margin: 0 }}>
            Event items
          </h2>
          <Button
            variant="primary"
            icon={<i className="ti ti-plus" />}
            onClick={() => setAddOpen((o) => !o)}
          >
            Add item
          </Button>
        </div>

        <Card padded={false}>
          {addOpen && (
            <form className="requirements-add-form" onSubmit={(e) => void handleAddItem(e)}>
              <div className="requirements-add-form__field">
                <Input
                  label="Key"
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                  placeholder="socks"
                  pattern="[a-z0-9_]+"
                  required
                />
              </div>
              <div className="requirements-add-form__field">
                <Input
                  label="Label"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="Socks"
                  required
                />
              </div>
              <Button type="submit" variant="primary" disabled={adding}>
                {adding ? "Creating…" : "Create"}
              </Button>
              {addError && <p className="text-error">{addError}</p>}
            </form>
          )}

          <div className="attendees-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Key</th>
                  <th>Enabled</th>
                  <th>Config</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="attendees-empty">
                      Loading…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="attendees-empty">
                      No items configured yet.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.label}</td>
                      <td>
                        <span className="requirements-item-key">{item.key}</span>
                      </td>
                      <td>
                        <Switch
                          checked={item.enabled}
                          onChange={() => void handleToggleEnabled(item)}
                          aria-label={`Toggle ${item.label}`}
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
        <h2 className="attendee-drawer__section-title">Event behaviour</h2>
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
                  Badge at entry is on, but no enabled badge item exists — check-in will not auto-issue a badge.
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
