import { useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, IconButton, Input, TICKET_TYPE_COLORS, TicketTypeBadge, useToast } from "@admitto/ui";
import type { TicketTypeColor } from "@admitto/ui";
import { ApiError, createTicketType, deleteTicketType, updateTicketType } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventSettingsDto, TicketTypeDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { whenShown } from "../hooks/useDelayedLoading.js";
import "./ticket-types-card.css";

export interface TicketTypesCardProps {
  readonly eventId: string;
  readonly event: EventSettingsDto;
  readonly types: TicketTypeDto[];
  readonly loading: boolean;
  readonly showLoading: boolean;
  /** Set when the catalog failed to load (initial load or a background refresh) - renders in
   * place of the list, with a Retry button (CodeRabbit review, batch 04 / #351). */
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly onChanged: () => void;
}

const COLOR_ENTRIES = Object.entries(TICKET_TYPE_COLORS) as Array<
  [TicketTypeColor, (typeof TICKET_TYPE_COLORS)[TicketTypeColor]]
>;

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

/** Click the current color to open a small swatch grid — same popover pattern as the app's other
 * menus (ExportMenu, ActionMenu): one clean chip that reveals choices on demand. */
function ColorSwatchPicker({
  color,
  disabled,
  onChange,
}: {
  readonly color: TicketTypeColor;
  readonly disabled: boolean;
  readonly onChange: (color: TicketTypeColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = TICKET_TYPE_COLORS[color] ?? TICKET_TYPE_COLORS.gray;

  return (
    <div className="tt-color-wrap" ref={ref}>
      <button
        type="button"
        className="tt-color-btn"
        style={{ background: current.solid }}
        title={current.label}
        aria-label={`Color: ${current.label}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="tt-color-popover" role="menu">
          {COLOR_ENTRIES.map(([key, c]) => (
            <button
              key={key}
              type="button"
              className={`tt-color-swatch${color === key ? " tt-color-swatch--active" : ""}`}
              style={{ background: c.solid }}
              title={c.label}
              aria-label={c.label}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TicketTypeRow({
  type,
  disabled,
  autoFocus,
  onUpdate,
  onRemove,
}: {
  readonly type: TicketTypeDto;
  readonly disabled: boolean;
  readonly autoFocus: boolean;
  readonly onUpdate: (id: string, patch: { label?: string; color?: TicketTypeColor }) => Promise<boolean>;
  readonly onRemove: () => void;
}) {
  const [label, setLabel] = useState(type.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setLabel(type.label), [type.label]);
  useEffect(() => {
    if (autoFocus) inputRef.current?.select();
  }, [autoFocus]);

  async function commitLabel() {
    const trimmed = label.trim();
    if (!trimmed || trimmed === type.label) {
      setLabel(type.label);
      return;
    }
    // Revert the optimistically-typed value on failure - otherwise the field keeps showing an
    // edit that was never actually saved, with only a transient toast as a clue (CodeRabbit
    // review).
    const ok = await onUpdate(type.id, { label: trimmed });
    if (!ok) setLabel(type.label);
  }

  return (
    <div className="tt-row">
      <div className="tt-row__identity">
        <ColorSwatchPicker
          color={type.color}
          disabled={disabled}
          onChange={(color) => onUpdate(type.id, { color })}
        />
        <Input
          ref={inputRef}
          aria-label={`Ticket type label for ${type.label}`}
          value={label}
          disabled={disabled}
          className="tt-row__label-input"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="tt-row__meta">
        <TicketTypeBadge label={type.label} color={type.color} />
        <span className="tt-row__count">
          {type.attendee_count} attendee{pluralSuffix(type.attendee_count)}
        </span>
        <IconButton
          label={`Remove ${type.label}`}
          size="sm"
          icon={<i className="ti ti-trash" aria-hidden="true" />}
          disabled={disabled}
          onClick={onRemove}
        />
      </div>
    </div>
  );
}

/** Event Settings tab: the only place a ticket type's name and color are set (batch 04 / #351).
 * Every other screen (add/edit attendee, import, filters, bulk-send, check-in, Reports) reads
 * this catalog through TicketTypeBadge's resolver instead of accepting free text. */
export function TicketTypesCard({
  eventId,
  event,
  types,
  loading,
  showLoading,
  error,
  onRetry,
  onChanged,
}: TicketTypesCardProps) {
  const { addToast } = useToast();
  const [adding, setAdding] = useState(false);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TicketTypeDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const disabled = event.status === "archived";

  // No per-row "mutating" disabled state here on purpose: PATCH (color/label) is idempotent and
  // safe to fire again before the previous one lands, and briefly disabling the row's own input/
  // icon for the ~10-20ms round trip read as a visible flicker on every click (PO review).
  //
  // Requests for the SAME id are still serialized through this per-id chain, though — rapid edits
  // (e.g. clicking through colors quickly) fire concurrent PATCHes that could land out of order
  // over the network and leave an older value as the last write. Different rows stay fully
  // independent (CodeRabbit review).
  const pendingByIdRef = useRef(new Map<string, Promise<boolean>>());
  function handleUpdate(id: string, patch: { label?: string; color?: TicketTypeColor }): Promise<boolean> {
    const prior = pendingByIdRef.current.get(id) ?? Promise.resolve(true);
    const run = prior.then(async () => {
      try {
        await updateTicketType(eventId, id, patch);
        onChanged();
        return true;
      } catch (err) {
        if (err instanceof ApiError && hasApiErrorCode(err, "label_conflict")) {
          addToast(`"${patch.label}" is already used by another ticket type in this event.`, "warning");
        } else {
          addToast(operatorApiErrorMessage(err, "Failed to update ticket type."), "error");
        }
        return false;
      }
    });
    pendingByIdRef.current.set(id, run);
    return run;
  }

  async function handleAdd() {
    setAdding(true);
    try {
      const created = await createTicketType(eventId, { label: "New type", color: "blue" });
      setJustAddedId(created.id);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && hasApiErrorCode(err, "type_limit_reached")) {
        addToast("Ticket type limit reached for this event.", "warning");
      } else if (err instanceof ApiError && hasApiErrorCode(err, "label_conflict")) {
        addToast('A ticket type named "New type" already exists for this event.', "warning");
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to add ticket type."), "error");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTicketType(eventId, deleteTarget.id);
      setDeleteTarget(null);
      onChanged();
    } catch (err) {
      // Keep the dialog open on failure instead of closing it out from under the user - the
      // "in use" case in particular is retryable once attendees are reassigned, without having to
      // find and re-click the same row's delete button again (CodeRabbit review).
      if (err instanceof ApiError && hasApiErrorCode(err, "type_in_use")) {
        setDeleteError(`Can't remove "${deleteTarget.label}" because attendees still have this type.`);
      } else {
        setDeleteError(operatorApiErrorMessage(err, "Failed to remove ticket type."));
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card
        title="Ticket types"
        className="event-settings-card ticket-types-card"
        actions={
          <>
            <span className="tt-count-badge">
              {types.length} type{pluralSuffix(types.length)}
            </span>
            <ArchivedGuard event={event} reasonId="add-ticket-type-reason" disabled={adding}>
              {(guard) => (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  icon={<i className="ti ti-plus" aria-hidden="true" />}
                  {...guard}
                  onClick={() => void handleAdd()}
                >
                  {adding ? "Adding…" : "Add ticket type"}
                </Button>
              )}
            </ArchivedGuard>
          </>
        }
      >
        {error && !loading ? (
          <EmptyState
            title="Could not load ticket types"
            description={error}
            action={
              onRetry && (
                <Button type="button" variant="secondary" onClick={onRetry}>
                  Retry
                </Button>
              )
            }
          />
        ) : (
          <>
            <p className="field-hint">
              Set each ticket type's name and color here. Every other screen in the app uses this
              list.
            </p>
            {loading ? (
              whenShown(showLoading, <p className="field-hint">Loading…</p>)
            ) : (
              <div className="tt-list">
                {types.map((type) => (
                  <TicketTypeRow
                    key={type.id}
                    type={type}
                    disabled={disabled}
                    autoFocus={justAddedId === type.id}
                    onUpdate={handleUpdate}
                    onRemove={() => setDeleteTarget(type)}
                  />
                ))}
                {types.length === 0 && (
                  <p className="field-hint">No ticket types yet. Add at least one before sending tickets.</p>
                )}
              </div>
            )}

            <p className="field-hint">
              Used in the add attendee form, CSV import, the attendees list, check-in, and reports.
            </p>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Remove ticket type"
        message={`Remove "${deleteTarget?.label}"? This cannot be undone.`}
        confirmLabel="Remove"
        confirmVariant="danger"
        loading={deleting}
        errorMessage={deleteError}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
