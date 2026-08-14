import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, HintLabel, IconButton, Input, Notice, TICKET_TYPE_COLORS, TicketTypeBadge, useToast } from "@admitto/ui";
import type { TicketTypeColor } from "@admitto/ui";
import { ApiError, createTicketType, deleteTicketType, fetchTicketTypes, updateTicketType } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventSettingsDto, TicketTypeDto, UpdateTicketTypePatch } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useDelayedLoading, whenShown } from "../hooks/useDelayedLoading.js";
import { SettingsFooter } from "./mailTransportFormParts.js";
import "./ticket-types-card.css";

export interface TicketTypesCardProps {
  readonly eventId: string;
  readonly event: EventSettingsDto;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly onSavingChange?: (saving: boolean) => void;
  /** Called after a successful save so the shell can refresh is_deletable/deletion_blockers. */
  readonly onSaved?: () => void;
}

/** A not-yet-created row: no server id yet, so Save must POST it instead of PATCHing. */
type DraftTicketType = TicketTypeDto & { pending?: boolean };

const COLOR_ENTRIES = Object.entries(TICKET_TYPE_COLORS) as Array<
  [TicketTypeColor, (typeof TICKET_TYPE_COLORS)[TicketTypeColor]]
>;

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

const TICKET_TYPES_HINT =
  "Types used across attendees, check-in, and reports.";

function isTicketTypeDirty(item: DraftTicketType, saved: TicketTypeDto[]): boolean {
  if (item.pending) return true;
  const original = saved.find((s) => s.id === item.id);
  return !original || original.label !== item.label || original.color !== item.color;
}

/** Only the fields this draft actually changed vs. `original` - never the untouched one, even
 * though it's still sent along unchanged today. Otherwise, if another admin edits the same type
 * between this card's load and Save, saving only a color change here would resend this card's own
 * stale label and silently revert their edit (CodeRabbit review). */
function buildTicketTypePatch(
  item: DraftTicketType,
  original: TicketTypeDto | undefined,
): UpdateTicketTypePatch {
  if (!original) return { label: item.label, color: item.color };
  const patch: UpdateTicketTypePatch = {};
  if (item.label !== original.label) patch.label = item.label;
  if (item.color !== original.color) patch.color = item.color;
  return patch;
}

function describeTicketTypeSaveError(label: string, err: unknown): string {
  if (err instanceof ApiError && hasApiErrorCode(err, "label_conflict")) {
    return `"${label}" is already used by another ticket type in this event.`;
  }
  if (err instanceof ApiError && hasApiErrorCode(err, "type_limit_reached")) {
    return "Ticket type limit reached for this event.";
  }
  return operatorApiErrorMessage(err, `Failed to save "${label}".`);
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
  onLabelChange,
  onColorChange,
  onRemove,
  onLocalDirtyChange,
}: {
  readonly type: DraftTicketType;
  readonly disabled: boolean;
  readonly onLabelChange: (id: string, label: string) => void;
  readonly onColorChange: (id: string, color: TicketTypeColor) => void;
  readonly onRemove: () => void;
  /** A typed-but-not-yet-blurred label edit doesn't reach `draft` (and so isn't reflected in the
   * card's own dirty flag) until commitLabel runs - report it separately so the page's unsaved-
   * changes guard still fires if the operator navigates away mid-edit (CodeRabbit review). */
  readonly onLocalDirtyChange: (isDirty: boolean) => void;
}) {
  const [label, setLabel] = useState(type.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setLabel(type.label), [type.label]);

  function commitLabel() {
    onLocalDirtyChange(false);
    const trimmed = label.trim();
    if (!trimmed || trimmed === type.label) {
      setLabel(type.label);
      return;
    }
    onLabelChange(type.id, trimmed);
  }

  return (
    <div className="tt-row">
      <div className="tt-row__identity">
        <ColorSwatchPicker
          color={type.color}
          disabled={disabled}
          onChange={(color) => onColorChange(type.id, color)}
        />
        <div className="tt-row__label-input">
          <Input
            ref={inputRef}
            id={`ticket-type-label-${type.id}`}
            name={`ticket-type-label-${type.id}`}
            aria-label={`Ticket type label for ${type.label}`}
            value={label}
            disabled={disabled}
            onChange={(e) => {
              setLabel(e.target.value);
              onLocalDirtyChange(e.target.value.trim() !== type.label);
            }}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
      </div>
      <div className="tt-row__meta">
        <TicketTypeBadge label={type.label} color={type.color} />
        <span className="tt-row__count">
          {type.attendee_count} attendee{pluralSuffix(type.attendee_count)}
        </span>
        <IconButton
          label={`Remove ${type.label}`}
          size="sm"
          className="tt-row__delete"
          icon={<i className="ti ti-trash" aria-hidden="true" />}
          disabled={disabled}
          onClick={onRemove}
        />
      </div>
    </div>
  );
}

/** The not-yet-added row shown after "Add ticket type" - committing it queues a pending row in
 * the draft list (Save creates it for real); it holds label/color locally until then so the
 * type's `key` (slugified from the label at create time, then immutable) derives from the name
 * the admin actually typed instead of a throwaway placeholder. */
function DraftTicketTypeRow({
  disabled,
  onCommit,
  onCancel,
  onLocalDirtyChange,
}: {
  readonly disabled: boolean;
  readonly onCommit: (label: string, color: TicketTypeColor) => void;
  readonly onCancel: () => void;
  /** Same reasoning as TicketTypeRow's own prop - a typed-but-uncommitted name for a brand new
   * type doesn't exist in `draft` at all yet, so it needs its own signal into the dirty flag. */
  readonly onLocalDirtyChange: (isDirty: boolean) => void;
}) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<TicketTypeColor>("blue");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function commit() {
    const trimmed = label.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onCommit(trimmed, color);
  }

  return (
    <div
      className="tt-row"
      onBlur={(e) => {
        // Commit only once focus actually leaves the whole row - clicking the color swatch (or a
        // color inside its popover) blurs the label input first, and committing right then would
        // queue the row with whatever `color` was still set at that moment (the "blue" default,
        // if the admin clicked the swatch before typing a color choice) instead of the one they
        // were about to pick (CodeRabbit review).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          commit();
        }
      }}
    >
      <div className="tt-row__identity">
        <ColorSwatchPicker color={color} disabled={disabled} onChange={setColor} />
        <div className="tt-row__label-input">
          <Input
            ref={inputRef}
            id="ticket-type-label-draft"
            name="ticket-type-label-draft"
            aria-label="New ticket type label"
            placeholder="Type a name…"
            value={label}
            disabled={disabled}
            onChange={(e) => {
              setLabel(e.target.value);
              onLocalDirtyChange(e.target.value.trim().length > 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") onCancel();
            }}
          />
        </div>
      </div>
    </div>
  );
}

let pendingIdSeq = 0;
function nextPendingId(): string {
  pendingIdSeq += 1;
  return `pending-${pendingIdSeq}`;
}

/** Sentinel key for the new-type draft row's own uncommitted-input tracking (it has no ticket
 * type id yet - see `uncommittedIds` below). */
const DRAFT_ROW_KEY = "__new_ticket_type__";

/** Event Settings tab: the only place a ticket type's name and color are set (batch 04 / #351).
 * Every other screen (add/edit attendee, import, filters, bulk-send, check-in, Reports) reads
 * this catalog through TicketTypeBadge's resolver instead of accepting free text.
 *
 * Adding a type and editing a label/color are buffered in a local draft and only sent to the
 * server on Save (Reset discards them) - the standard explicit Save/Reset pattern every other
 * Event Settings tab uses. Deleting stays immediate: its own confirm dialog is already the
 * explicit gesture, and it needs the instant "still assigned to attendees" feedback a deferred
 * batch save couldn't attach anywhere once the row was gone from the draft. */
export function TicketTypesCard({ eventId, event, onDirtyChange, onSavingChange, onSaved }: TicketTypesCardProps) {
  const { addToast } = useToast();
  const [saved, setSaved] = useState<TicketTypeDto[]>([]);
  const [draft, setDraft] = useState<DraftTicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const showLoading = useDelayedLoading(loading);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DraftTicketType | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBlockedByAttendees, setDeleteBlockedByAttendees] = useState(false);
  // Ids (or DRAFT_ROW_KEY) of rows with a locally typed label that hasn't reached `draft` yet -
  // see TicketTypeRow/DraftTicketTypeRow's onLocalDirtyChange.
  const [uncommittedIds, setUncommittedIds] = useState<ReadonlySet<string>>(new Set());
  const disabled = event.status === "archived";
  const loadAbortRef = useRef<AbortController | null>(null);
  const validationErrorsRef = useRef<HTMLUListElement | null>(null);

  const setRowUncommitted = useCallback((id: string, isDirty: boolean) => {
    setUncommittedIds((prev) => {
      if (prev.has(id) === isDirty) return prev;
      const next = new Set(prev);
      if (isDirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // The draft row itself unmounts as soon as it closes (commit, cancel, Escape, or Reset), so
  // its own onBlur/onCancel can't reliably clear DRAFT_ROW_KEY first in every case - clear it
  // centrally whenever draftOpen flips false instead.
  useEffect(() => {
    if (!draftOpen) setRowUncommitted(DRAFT_ROW_KEY, false);
  }, [draftOpen, setRowUncommitted]);

  const load = useCallback(() => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    setLoadError(null);
    fetchTicketTypes(eventId, controller.signal)
      .then((types) => {
        if (controller.signal.aborted) return;
        setSaved(types);
        setDraft(types);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoadError(operatorApiErrorMessage(err, "Failed to load ticket types."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [eventId]);

  useEffect(() => {
    load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  const dirty = uncommittedIds.size > 0 || draft.some((item) => isTicketTypeDirty(item, saved));

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  function updateDraft(id: string, patch: { label?: string; color?: TicketTypeColor }) {
    setDraft((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function commitDraftRow(label: string, color: TicketTypeColor) {
    setDraft((prev) => [
      ...prev,
      {
        id: nextPendingId(),
        key: "",
        label,
        color,
        sort_order: prev.length,
        attendee_count: 0,
        created_at: "",
        pending: true,
      },
    ]);
    setDraftOpen(false);
  }

  async function handleSave() {
    setSaving(true);
    const nextDraft: DraftTicketType[] = [];
    const nextSaved: TicketTypeDto[] = [];
    let failureCount = 0;

    for (const item of draft) {
      const original = item.pending ? undefined : saved.find((s) => s.id === item.id);
      if (!item.pending && !isTicketTypeDirty(item, saved)) {
        nextDraft.push(item);
        if (original) nextSaved.push(original);
        continue;
      }
      try {
        const result = item.pending
          ? await createTicketType(eventId, { label: item.label, color: item.color })
          : await updateTicketType(eventId, item.id, buildTicketTypePatch(item, original));
        nextDraft.push(result);
        nextSaved.push(result);
      } catch (err) {
        failureCount += 1;
        addToast(describeTicketTypeSaveError(item.label, err), "error");
        nextDraft.push(item);
        if (original) nextSaved.push(original);
      }
    }

    setDraft(nextDraft);
    setSaved(nextSaved);
    setSaving(false);

    if (failureCount === 0) {
      addToast("Ticket types saved.", "success");
      onSaved?.();
    }
  }

  function handleReset() {
    setDraft(saved);
    setDraftOpen(false);
    setUncommittedIds(new Set());
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    // A pending row only exists in `draft` - it has no server id to delete and never reached the
    // server in the first place, so just drop it from the draft instead of calling the API with
    // an id that can't exist (CodeRabbit review).
    if (deleteTarget.pending) {
      setDraft((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      setDeleteTarget(null);
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    setDeleteBlockedByAttendees(false);
    try {
      await deleteTicketType(eventId, deleteTarget.id);
      setDraft((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      setSaved((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      setDeleteTarget(null);
      onSaved?.();
    } catch (err) {
      // Keep the dialog open on failure instead of closing it out from under the user - the
      // "in use" case in particular is retryable once attendees are reassigned, without having to
      // find and re-click the same row's delete button again (CodeRabbit review).
      if (err instanceof ApiError && hasApiErrorCode(err, "type_in_use")) {
        setDeleteBlockedByAttendees(true);
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
        title={<HintLabel hint={TICKET_TYPES_HINT}>Ticket types</HintLabel>}
        className="event-settings-card ticket-types-card"
        actions={
          <>
            <span className="tt-count-badge">
              {draft.length} type{pluralSuffix(draft.length)}
            </span>
            <ArchivedGuard event={event} reasonId="add-ticket-type-reason" disabled={draftOpen}>
              {(guard) => (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  icon={<i className="ti ti-plus" aria-hidden="true" />}
                  {...guard}
                  onClick={() => setDraftOpen(true)}
                >
                  Add ticket type
                </Button>
              )}
            </ArchivedGuard>
          </>
        }
      >
        <div className="settings-card-stack">
          <p className="field-hint ticket-types-card__intro settings-card-intro">
            Define the names and colours attendees can be assigned.
          </p>
          {loadError ? (
            <EmptyState
              title="Could not load ticket types"
              description={loadError}
              action={
                <Button type="button" variant="secondary" onClick={load}>
                  Retry
                </Button>
              }
            />
          ) : (
            <>
              {loading ? (
                whenShown(showLoading, <p className="field-hint">Loading…</p>)
              ) : (
                <div className="tt-list">
                  {draft.map((type) => (
                    <TicketTypeRow
                      key={type.id}
                      type={type}
                      disabled={disabled || saving}
                      onLabelChange={(id, label) => updateDraft(id, { label })}
                      onColorChange={(id, color) => updateDraft(id, { color })}
                      onRemove={() => setDeleteTarget(type)}
                      onLocalDirtyChange={(isDirty) => setRowUncommitted(type.id, isDirty)}
                    />
                  ))}
                  {draftOpen && (
                    <DraftTicketTypeRow
                      disabled={disabled || saving}
                      onCommit={commitDraftRow}
                      onCancel={() => setDraftOpen(false)}
                      onLocalDirtyChange={(isDirty) => setRowUncommitted(DRAFT_ROW_KEY, isDirty)}
                    />
                  )}
                  {draft.length === 0 && !draftOpen && (
                    <p className="field-hint">No ticket types yet. Add at least one before sending tickets.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {disabled ? (
        <p className="field-hint event-settings-archived-note">
          This event is archived - ticket types cannot be changed.
        </p>
      ) : (
        <SettingsFooter
          validationErrors={[]}
          validationErrorsRef={validationErrorsRef}
          hasUnsavedChanges={dirty}
          saving={saving}
          onReset={handleReset}
          onSave={() => void handleSave()}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Remove "${deleteTarget?.label}"?`}
        message="This type will no longer be available for new attendee assignments."
        confirmLabel="Remove"
        confirmVariant="danger"
        loading={deleting}
        errorMessage={deleteError}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
          setDeleteBlockedByAttendees(false);
        }}
        onConfirm={() => void handleDelete()}
      >
        {deleteBlockedByAttendees && (
          <Notice variant="warning" role="alert">
            This type is still assigned to attendees. Reassign them before removing it.
          </Notice>
        )}
      </ConfirmDialog>
    </>
  );
}
