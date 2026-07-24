import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useOutletContext, useParams } from "react-router";
import { Button, Card, EmptyState, IconButton, PageHeader, Switch, useToast } from "@admitto/ui";
import {
  ApiError,
  createEventItem,
  fetchEventCustomFields,
  fetchEventItems,
  fetchOpsConfig,
  updateEventItem,
  updateOpsConfig,
} from "../api/client.js";
import { isBadgeItemUsable } from "@admitto/tickets";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventCustomFieldDto, EventDto, EventItemDto, OpsConfigDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useInFlightIds } from "../hooks/useInFlightIds.js";
import { EventCustomFieldsCard } from "../requirements/EventCustomFieldsCard.js";
import { EventItemDrawer } from "../requirements/EventItemDrawer.js";
import { DEFAULT_EVENT_ITEM_ICON } from "../requirements/IconPicker.js";
import { slugifyItemKey, uniqueItemKey } from "../requirements/itemKey.js";
import "../requirements/requirements.css";

/** Redirect to the login page, preserving the current path to return to after auth. */
function redirectToLogin(): void {
  const next = encodeURIComponent(window.location.pathname);
  window.location.assign(`/login?next=${next}`);
}

/** Operator-facing message for a failed requirements load (401 is handled separately by redirect). */
function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 403 ? "You do not have access to this event." : "Failed to load requirements.";
  }
  return "Failed to load requirements.";
}

function EventItemsTableBody({
  loading,
  items,
  event,
  togglingIds,
  onToggle,
  onEdit,
}: {
  readonly loading: boolean;
  readonly items: EventItemDto[];
  readonly event: EventDto;
  readonly togglingIds: ReadonlySet<string>;
  readonly onToggle: (item: EventItemDto) => void;
  readonly onEdit: (item: EventItemDto) => void;
}) {
  if (loading) {
    return (
      <tr>
        <td colSpan={3} className="attendees-empty">
          Loading…
        </td>
      </tr>
    );
  }
  if (items.length === 0) {
    return (
      <tr>
        <td colSpan={3} className="attendees-empty">
          No items yet. Add one to configure what operators issue at check-in.
        </td>
      </tr>
    );
  }
  return (
    <>
      {items.map((item) => (
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
              <ArchivedGuard
                event={event}
                reasonId={`toggle-item-reason-${item.id}`}
                disabled={togglingIds.has(item.id)}
              >
                {(guard) => (
                  <Switch
                    label={item.enabled ? "On" : "Off"}
                    checked={item.enabled}
                    aria-busy={togglingIds.has(item.id)}
                    onChange={() => onToggle(item)}
                    aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.label}`}
                    {...guard}
                  />
                )}
              </ArchivedGuard>
              <ArchivedGuard event={event} reasonId={`edit-item-reason-${item.id}`}>
                {(guard) => (
                  <IconButton
                    label="Edit item"
                    size="sm"
                    icon={<i className="ti ti-pencil" aria-hidden="true" />}
                    onClick={() => onEdit(item)}
                    {...guard}
                  />
                )}
              </ArchivedGuard>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

function EventBehaviourContent({
  opsConfig,
  loading,
  event,
  opsTogglingIds,
  badgeInactive,
  onToggle,
}: {
  readonly opsConfig: OpsConfigDto | null;
  readonly loading: boolean;
  readonly event: EventDto;
  readonly opsTogglingIds: ReadonlySet<string>;
  readonly badgeInactive: boolean;
  readonly onToggle: (field: keyof OpsConfigDto, value: boolean) => void;
}) {
  if (opsConfig == null && loading) return <p>Loading…</p>;
  if (!opsConfig) return null;
  return (
    <>
      <div className="requirements-behaviour-row">
        <div className="requirements-behaviour-row__text">
          <strong>Issue badge at entry</strong>
          <p>
            Auto-issues the badge item when an attendee is admitted. Requires the badge
            item to exist, be active, and have "Issue on check-in" enabled.
          </p>
        </div>
        <ArchivedGuard
          event={event}
          reasonId="badge-at-entry-reason"
          disabled={opsTogglingIds.has("badge_at_entry") || badgeInactive}
          tooltip={
            badgeInactive
              ? "Can't enable this — the badge item is disabled or has \"Issue on check-in\" turned off."
              : undefined
          }
        >
          {(guard) => (
            <Switch
              checked={opsConfig.badge_at_entry}
              aria-busy={opsTogglingIds.has("badge_at_entry")}
              onChange={(e) => onToggle("badge_at_entry", e.target.checked)}
              aria-label="Issue badge at entry"
              {...guard}
            />
          )}
        </ArchivedGuard>
      </div>
      <div className="requirements-behaviour-row">
        <div className="requirements-behaviour-row__text">
          <strong>Require confirmation on scan</strong>
          <p>Scan shows a preview; operator must confirm before check-in is recorded.</p>
        </div>
        <ArchivedGuard
          event={event}
          reasonId="confirm-on-scan-reason"
          disabled={opsTogglingIds.has("require_confirm_on_scan")}
        >
          {(guard) => (
            <Switch
              checked={opsConfig.require_confirm_on_scan}
              aria-busy={opsTogglingIds.has("require_confirm_on_scan")}
              onChange={(e) => onToggle("require_confirm_on_scan", e.target.checked)}
              aria-label="Require confirmation on scan"
              {...guard}
            />
          )}
        </ArchivedGuard>
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
        <ArchivedGuard
          event={event}
          reasonId="manual-lookup-reason"
          disabled={opsTogglingIds.has("allow_manual_lookup")}
        >
          {(guard) => (
            <Switch
              checked={opsConfig.allow_manual_lookup}
              aria-busy={opsTogglingIds.has("allow_manual_lookup")}
              onChange={(e) => onToggle("allow_manual_lookup", e.target.checked)}
              aria-label="Allow manual lookup"
              {...guard}
            />
          )}
        </ArchivedGuard>
      </div>
      <div className="requirements-behaviour-row">
        <div className="requirements-behaviour-row__text">
          <strong>Auto-advance after valid check-in</strong>
          <p>
            After a valid scan, the check-in screen clears automatically for the next
            attendee — without tapping Next.
          </p>
        </div>
        <ArchivedGuard
          event={event}
          reasonId="auto-advance-reason"
          disabled={opsTogglingIds.has("auto_advance_on_valid")}
        >
          {(guard) => (
            <Switch
              checked={opsConfig.auto_advance_on_valid}
              aria-busy={opsTogglingIds.has("auto_advance_on_valid")}
              onChange={(e) => onToggle("auto_advance_on_valid", e.target.checked)}
              aria-label="Auto-advance on valid scan"
              {...guard}
            />
          )}
        </ArchivedGuard>
      </div>
    </>
  );
}

function AddItemModal({
  addPanelRef,
  addLabel,
  addNameError,
  adding,
  addKeyPreview,
  onLabelChange,
  onSubmit,
  onClose,
}: {
  readonly addPanelRef: RefObject<HTMLDivElement | null>;
  readonly addLabel: string;
  readonly addNameError: string | null;
  readonly adding: boolean;
  readonly addKeyPreview: string;
  readonly onLabelChange: (value: string) => void;
  readonly onSubmit: (e: React.FormEvent) => void;
  readonly onClose: () => void;
}) {
  return (
    <dialog className="event-item-modal" open aria-modal="true" aria-label="Add item">
      <button
        type="button"
        className="event-item-modal__backdrop"
        aria-label="Close add item dialog"
        onClick={onClose}
      />
      <div ref={addPanelRef} className="event-item-modal__panel">
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
          onSubmit={onSubmit}
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
              onChange={(e) => onLabelChange(e.target.value)}
              placeholder="Gift bag"
              required
              autoFocus
              aria-invalid={addNameError ? true : undefined}
              aria-describedby={addNameError ? "add-item-name-error" : undefined}
            />
            <span className="at-hint">
              The name shown to staff during check-in. Keep it short and clear — e.g. "Gift
              bag", "Name badge", "T-shirt".
            </span>
            {addNameError && (
              <p id="add-item-name-error" className="text-error" role="alert">
                {addNameError}
              </p>
            )}
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
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** Admin screen for per-event item configuration and operational behaviour. */
export function RequirementsPage() {
  const { eventId } = useParams();
  const { event } = useOutletContext<{ event: EventDto }>();
  const { reportApiError } = useConnectionState();
  const { addToast } = useToast();
  const listAbortRef = useRef<AbortController | null>(null);

  const [items, setItems] = useState<EventItemDto[]>([]);
  const [customFields, setCustomFields] = useState<EventCustomFieldDto[]>([]);
  const [opsConfig, setOpsConfig] = useState<OpsConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<EventItemDto | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addNameError, setAddNameError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addPanelRef = useRef<HTMLDivElement>(null);

  const addKeyPreview = uniqueItemKey(addLabel, items.map((i) => i.key));

  const { ids: togglingIds, start: startToggling, finish: finishToggling } = useInFlightIds();
  const { ids: opsTogglingIds, start: startOpsToggle, finish: finishOpsToggle } = useInFlightIds();

  function closeAddModal() {
    setAddOpen(false);
    setAddLabel("");
    setAddNameError(null);
  }

  useModalFocusTrap(addPanelRef, addOpen, closeAddModal);

  const hasLoadedRef = useRef(false);

  useEffect(() => {
    setItems([]);
    setCustomFields([]);
    setOpsConfig(null);
    setSelectedItem(null);
    hasLoadedRef.current = false;
  }, [eventId]);

  const load = useCallback(async () => {
    if (!eventId) return;

    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;

    // Only show the Loading… placeholder on the true first load for this
    // event — a reloadToken-triggered refresh after add/edit/delete already
    // has valid rows on screen, so blanking them out for the refetch just
    // reads as a flash/jump instead of a smooth in-place update.
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const [itemRows, fields, ops] = await Promise.all([
        fetchEventItems(eventId, ac.signal),
        fetchEventCustomFields(eventId, ac.signal),
        fetchOpsConfig(eventId, ac.signal),
      ]);
      if (ac.signal.aborted) return;
      setItems(itemRows);
      setCustomFields(fields);
      setOpsConfig(ops);
      setLoadError(null);
      hasLoadedRef.current = true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // A background refresh (reloadToken) can fail after an earlier load already succeeded -
      // reset so the next attempt (e.g. clicking Retry below) shows the Loading… state again
      // instead of silently skipping it forever.
      hasLoadedRef.current = false;
      setItems([]);
      setCustomFields([]);
      setOpsConfig(null);
      setSelectedItem(null);
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          redirectToLogin();
          return;
        }
      }
      setLoadError(loadErrorMessage(err));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [eventId, reportApiError]);

  useEffect(() => {
    void load();
    return () => listAbortRef.current?.abort();
  }, [load, reloadToken]);

  const badgeItem = items.find((i) => i.key === "badge");
  // "Issue badge at entry" is a no-op unless the badge item exists, is
  // active, and has "Issue on check-in" enabled — disable the toggle in any
  // of those cases instead of letting operators turn on a setting that
  // can't work (single source of truth; no separate warning banner needed).
  const badgeInactive = !badgeItem || !isBadgeItemUsable(badgeItem.enabled, badgeItem.config);

  async function handleToggleEnabled(item: EventItemDto) {
    if (!eventId || togglingIds.has(item.id)) return;
    startToggling(item.id);
    try {
      const updated = await updateEventItem(eventId, item.id, { enabled: !item.enabled });
      setItems((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      addToast(updated.enabled ? "Item enabled — saved" : "Item disabled — saved", "success");
      if (updated.key === "badge" && !updated.enabled) {
        // Server auto-disables badge_at_entry when the badge item is turned
        // off — refresh so the Event behaviour toggle doesn't show stale ON.
        // Best-effort: the item update already succeeded and was already
        // toasted above, so a failure here shouldn't surface as an error —
        // opsConfig just stays stale until the next full page load.
        try {
          setOpsConfig(await fetchOpsConfig(eventId));
        } catch {
          // Ignored — see comment above.
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "item_in_use")) {
        addToast(
          "This item has been issued to attendees — record returns before disabling it.",
          "warning",
        );
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to update item."), "error");
      }
    } finally {
      finishToggling(item.id);
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId) return;
    const label = addLabel.trim();
    const key = uniqueItemKey(label, items.map((i) => i.key));
    if (!label || !key) {
      setAddNameError("Enter a name using letters or numbers.");
      return;
    }
    setAddNameError(null);
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
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "key_conflict")) {
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
    if (!eventId || !opsConfig || !startOpsToggle(field)) return;
    const prev = opsConfig;
    setOpsConfig({ ...opsConfig, [field]: value });
    try {
      const next = await updateOpsConfig(eventId, { [field]: value });
      setOpsConfig(next);
      addToast("Setting updated", "success");
    } catch (err) {
      setOpsConfig(prev);
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "badge_item_inactive")) {
        addToast(
          "Can't enable this — the badge item is disabled or has \"Issue on check-in\" turned off.",
          "warning",
        );
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to save event behaviour."), "error");
      }
    } finally {
      finishOpsToggle(field);
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
            <ArchivedGuard event={event} reasonId="add-item-reason">
              {(guard) => (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<i className="ti ti-plus" />}
                  {...guard}
                  onClick={() => {
                    if (addOpen) closeAddModal();
                    else setAddOpen(true);
                  }}
                >
                  Add item
                </Button>
              )}
            </ArchivedGuard>
          }
        >
          <div className="attendees-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="requirements-item-desc-col">Description</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                <EventItemsTableBody
                  loading={loading}
                  items={items}
                  event={event}
                  togglingIds={togglingIds}
                  onToggle={(item) => void handleToggleEnabled(item)}
                  onEdit={(item) => setSelectedItem(item)}
                />
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <EventCustomFieldsCard
        eventId={eventId}
        event={event}
        fields={customFields}
        loading={loading}
        onChanged={() => setReloadToken((n) => n + 1)}
      />

      <section className="requirements-section">
        <Card title="Event behaviour" padded={false}>
          <EventBehaviourContent
            opsConfig={opsConfig}
            loading={loading}
            event={event}
            opsTogglingIds={opsTogglingIds}
            badgeInactive={badgeInactive}
            onToggle={(field, value) => void handleOpsToggle(field, value)}
          />
        </Card>
      </section>
        </>
      )}

      {addOpen && (
        <AddItemModal
          addPanelRef={addPanelRef}
          addLabel={addLabel}
          addNameError={addNameError}
          adding={adding}
          addKeyPreview={addKeyPreview}
          onLabelChange={(value) => {
            setAddLabel(value);
            setAddNameError(null);
          }}
          onSubmit={(e) => void handleAddItem(e)}
          onClose={closeAddModal}
        />
      )}

      {selectedItem && (
        <EventItemDrawer
          eventId={eventId}
          item={selectedItem}
          customFields={customFields}
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
