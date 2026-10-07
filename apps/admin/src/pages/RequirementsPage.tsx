import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useOutletContext, useParams } from "react-router";
import { Button, Card, HintLabel, IconButton, PageHeader, Switch, useToast } from "@admitto/ui";
import {
  ApiError,
  createEventItem,
  fetchEventCustomFields,
  fetchEventItems,
  updateEventItem,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventCustomFieldDto, EventDto, EventItemDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { RefetchRegion } from "../components/RefetchRegion.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useCardLoad } from "../hooks/useCardLoad.js";
import { useInFlightIds } from "../hooks/useInFlightIds.js";
import { useListLoad } from "../hooks/useListLoad.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
import { orLoginRedirect } from "../identity/loginRedirect.js";
import { disambiguatedLabel, findDuplicateLabels } from "../requirements/duplicateLabels.js";
import { EventCustomFieldsCard } from "../requirements/EventCustomFieldsCard.js";
import { EventItemDrawer } from "../requirements/EventItemDrawer.js";
import { DEFAULT_EVENT_ITEM_ICON } from "../requirements/IconPicker.js";
import { slugifyItemKey, uniqueItemKey } from "../requirements/itemKey.js";
import { RequirementsSkeleton } from "../requirements/RequirementsSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";
import "../requirements/requirements.css";

const EVENT_ITEMS_HINT =
  "Once an item has been issued to attendees, you can't disable it until its returns are recorded.";

/** The region that stays whatever the read is doing (the placeholder, the error or the cards), and where the keyboard focus
 * goes when a Retry that held it works. */
const REQUIREMENTS_REGION = ".requirements-body";

/** What the page's first read answers: the event's items and its custom fields, together (the edit drawer needs both). */
interface RequirementsData {
  readonly items: EventItemDto[];
  readonly fields: EventCustomFieldDto[];
}

const NO_ITEMS: EventItemDto[] = [];
const NO_FIELDS: EventCustomFieldDto[] = [];

function EventItemsTableBody({
  items,
  event,
  togglingIds,
  onToggle,
  onEdit,
}: {
  readonly items: EventItemDto[];
  readonly event: EventDto;
  readonly togglingIds: ReadonlySet<string>;
  readonly onToggle: (item: EventItemDto) => void;
  readonly onEdit: (item: EventItemDto) => void;
}) {
  if (items.length === 0) {
    return (
      <tr>
        <td colSpan={4} className="attendees-empty">
          No items yet. Add one to configure what operators issue at check-in.
        </td>
      </tr>
    );
  }
  const duplicateLabels = findDuplicateLabels(items.map((item) => item.label));
  return (
    <>
      {items.map((item) => (
        <tr key={item.id}>
          <td>
            <div className="requirements-item-cell">
              <i className={`ti ti-${item.icon ?? DEFAULT_EVENT_ITEM_ICON}`} aria-hidden="true" />
              <div className="requirements-item-info">
                <div className="requirements-item-name">
                  {disambiguatedLabel(item.label, item.key, duplicateLabels)}
                </div>
              </div>
            </div>
          </td>
          <td className="requirements-item-desc-col">
            {item.description && (
              <span className="requirements-item-desc">{item.description}</span>
            )}
          </td>
          <td className="requirements-item-status-col">
            {/* Block wrapper so the cell's `vertical-align: middle` centers a normal block
             * box - ArchivedGuard's Tooltip trigger is an inline-flex span with no baseline
             * of its own, which table cells center inconsistently (a few px off). */}
            <div className="requirements-status-cell">
              <ArchivedGuard
                event={event}
                reasonId={`toggle-item-reason-${item.id}`}
                disabled={togglingIds.has(item.id)}
              >
                {(guard) => (
                  <Switch
                    id={`requirement-item-enabled-${item.id}`}
                    label={item.enabled ? "On" : "Off"}
                    checked={item.enabled}
                    aria-busy={togglingIds.has(item.id)}
                    onChange={() => onToggle(item)}
                    aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.label}`}
                    {...guard}
                  />
                )}
              </ArchivedGuard>
            </div>
          </td>
          <td className="requirements-item-actions">
            <div className="requirements-item-actions__wrap">
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
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef);
  return (
    <dialog className="event-item-modal" open aria-modal="true" aria-label="Add item">
      <button
        type="button"
        className="event-item-modal__backdrop"
        aria-label="Close add item dialog"
        onClick={onClose}
      />
      <div ref={addPanelRef} className="event-item-modal__panel">
        <div ref={scrollRef} className="event-item-modal__scroll at-scroll">
          <div className="event-item-modal__header">
            <div>
              <h2 className="event-item-modal__title">
                <i className="ti ti-package" aria-hidden="true" /> Add item
              </h2>
              <p className="event-item-modal__subtitle">
                A physical item or resource issued or tracked at check-in, for example a gift
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
                    ID: <code>{addKeyPreview || slugifyItemKey(addLabel) || "-"}</code>
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
                readOnly={adding}
                autoFocus
                aria-invalid={addNameError ? true : undefined}
                aria-describedby={addNameError ? "add-item-name-error" : undefined}
              />
              <span className="at-hint">
                The name shown to staff during check-in. Keep it short and clear, e.g. "Gift
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
            <Button type="button" variant="ghost" disabled={adding} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="add-item-form" variant="primary" loading={adding} disabled={!addLabel.trim()}>
              Create
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** One event, one page: a different `:eventId` is a fresh page (its own read, modals and drawer), never the previous one's. */
export function RequirementsPage() {
  const { eventId } = useParams();
  if (!eventId) return <p>Missing event.</p>;
  return <RequirementsPageBody key={eventId} eventId={eventId} />;
}

/** Admin screen for per-event item configuration and operational behaviour. */
function RequirementsPageBody({ eventId }: Readonly<{ eventId: string }>) {
  const { event } = useOutletContext<{ event: EventDto }>();
  const { reportApiError } = useConnectionState();
  const { addToast } = useToast();
  const [accessDenied, setAccessDenied] = useState(false);
  const [selectedItem, setSelectedItem] = useState<EventItemDto | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addNameError, setAddNameError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addPanelRef = useRef<HTMLDivElement>(null);

  // The first read is one answer for both cards: the edit drawer offers the fields of the event next to its items, so an
  // answer with one of them missing would be a wrong one. A failure is told to the connection state when the answer is
  // in, never when a Retry starts, so the wording of the error on screen does not change while a Retry runs; a 401 hands
  // the browser to the login page instead (`orLoginRedirect`, once the connection state has heard of it), and no error
  // flashes up first.
  const fetchRequirements = useMemo(
    () =>
      orLoginRedirect(async (signal: AbortSignal): Promise<RequirementsData> => {
        try {
          const [items, fields] = await Promise.all([fetchEventItems(eventId, signal), fetchEventCustomFields(eventId, signal)]);
          return { items, fields };
        } catch (err) {
          if (err instanceof ApiError) reportApiError(err.status);
          setAccessDenied(err instanceof ApiError && err.status === 403);
          throw err;
        }
      }),
    [eventId, reportApiError],
  );
  const list = useListLoad({ fetcher: fetchRequirements, fallback: "Could not load requirements." });
  const card = useCardLoad(list);
  const items = list.data?.items ?? NO_ITEMS;
  const customFields = list.data?.fields ?? NO_FIELDS;

  const addKeyPreview = uniqueItemKey(addLabel, items.map((i) => i.key));

  const { ids: togglingIds, start: startToggling, finish: finishToggling } = useInFlightIds();

  function closeAddModal() {
    setAddOpen(false);
    setAddLabel("");
    setAddNameError(null);
  }

  useModalFocusTrap(addPanelRef, addOpen, closeAddModal);

  // An item or a field that was added, changed or deleted is somewhere in the list that the page cannot tell, so a refresh
  // that fails replaces the cards with the error (they may be wrong), as the page always did; the rows stay on screen,
  // blocked and dimmed, while it runs.
  function refreshRequirements() {
    void list.reload({ keepRowsOnFailure: false });
  }

  async function handleToggleEnabled(item: EventItemDto) {
    if (togglingIds.has(item.id)) return;
    startToggling(item.id);
    try {
      const updated = await updateEventItem(eventId, item.id, { enabled: !item.enabled });
      list.update((data) => ({ ...data, items: data.items.map((r) => (r.id === updated.id ? updated : r)) }));
      addToast(updated.enabled ? "Item enabled" : "Item disabled", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "item_in_use")) {
        addToast(
          "This item has been issued to attendees. Record returns before disabling it.",
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
      refreshRequirements();
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

  let body: ReactNode;
  if (!card.gate.showContent) {
    body = <RequirementsSkeleton held={!card.gate.showIndicator} slow={card.slow} />;
  } else if (card.failure.error) {
    body = (
      <RetryEmptyState
        title={accessDenied ? "You do not have access to this event" : "Could not load requirements"}
        message={accessDenied ? "You do not have access to this event." : card.failure.error}
        retrying={card.failure.retrying}
        onRetry={card.failure.retry}
        landmark={REQUIREMENTS_REGION}
      />
    );
  } else {
    assertPresent(list.data);
    body = (
      <RefetchRegion refreshing={list.refreshing} label="Refreshing requirements">
        <section className="requirements-section">
          <Card
            padded={false}
            title={<HintLabel hint={EVENT_ITEMS_HINT}>Event items</HintLabel>}
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
                    Add
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
                    <th className="requirements-item-status-col">Active</th>
                    <th className="requirements-item-actions" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  <EventItemsTableBody
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

        <EventCustomFieldsCard eventId={eventId} event={event} fields={customFields} onChanged={refreshRequirements} />
      </RefetchRegion>
    );
  }

  return (
    <>
      <PageHeader
        className="requirements-pageheader"
        title="Requirements"
        subtitle="Configure what this event issues to attendees and operational behaviour."
        actions={
          <a
            href="https://github.com/solarssk/admitto/wiki/Requirements-and-Fulfilment"
            target="_blank"
            rel="noopener noreferrer"
            className="at-btn at-btn--secondary"
          >
            <span className="at-btn__icon" aria-hidden="true">
              <i className="ti ti-book" aria-hidden="true" />
            </span>
            <span>Documentation</span>
          </a>
        }
      />
      {/* The part of the page that stays whatever the read is doing, and where the focus goes when a Retry that held it works. */}
      <section className="requirements-body" aria-label="Requirements">
        {body}
      </section>

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
          items={items}
          onClose={() => setSelectedItem(null)}
          onUpdated={() => {
            refreshRequirements();
            setSelectedItem(null);
          }}
        />
      )}
    </>
  );
}
