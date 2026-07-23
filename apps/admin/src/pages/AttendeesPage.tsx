import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Button, EmptyState, PageHeader, Tooltip, useToast, type ToastVariant } from "@admitto/ui";
import {
  ApiError,
  bulkChangeRsvpStatus,
  bulkChangeTicketType,
  bulkCheckInAttendees,
  bulkRevokeCheckIn,
  bulkRevokePass,
  bulkDeleteAttendees,
  bulkResendTickets,
  bulkRevokeItems,
  exportAttendees,
  exportSelectedAttendees,
  fetchEventAttendees,
  fetchEventItems,
  fetchTicketTypes,
  sendEventBulk,
  updateAttendee,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  AttendeeDetailDto,
  AttendeeRowDto,
  AttendeeSortBy,
  AttendeeSortDir,
  AttendeeMailStatusFilter,
  EventDto,
  RsvpStatus,
  TicketTypeDto,
} from "../api/types.js";
import { AddAttendeeModal } from "../attendees/AddAttendeeModal.js";
import { AttendeesTable } from "../attendees/AttendeesTable.js";
import { RSVP_LABELS, RsvpStatusBadge } from "../attendees/rsvpStatusBadge.js";
import { TicketTypeBadge } from "../attendees/ticketTypeBadge.js";
import { useMailConfigured } from "../attendees/useMailConfigured.js";
import { ArchivedGuard, isEventArchived } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import "../attendees/add-attendee-modal.css";
import "../attendees/attendees.css";

const DEBOUNCE_MS = 300;
/** Matches EventSettingsPage's Danger Zone bulk actions — a brief "don't act on reflex" pause
 * before a bulk, irreversible action's confirm button becomes clickable. */
const BULK_DELETE_CONFIRM_DELAY_SECONDS = 10;
/** Same "don't act on reflex" pause as BULK_DELETE_CONFIRM_DELAY_SECONDS above, for the bulk
 * Revoke check-in/items/pass dialogs — was missing on all three (PO review). */
const BULK_REVOKE_CONFIRM_DELAY_SECONDS = 10;
/** Same "don't act on reflex" pause as the constants above, for the CardPickerDialog Apply
 * button (bulk change ticket type / change attendance status) — a misclick on a large batch
 * would otherwise overwrite everyone's ticket type or RSVP status in one shot with no
 * confirmation at all (code review on #569). */
const BULK_CARD_PICKER_CONFIRM_DELAY_SECONDS = 10;

function mergeAttendeeRow(prev: AttendeeRowDto, updated: AttendeeDetailDto): AttendeeRowDto {
  return {
    ...prev,
    status: updated.status,
    updated_at: updated.updated_at,
    check_in_status: updated.check_in_status,
    admitted_at: updated.admitted_at,
  };
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

/** Header "Send tickets" button label — busy state wins, then the responsive short label
 * (Sonar S3358: was a nested ternary). */
function sendTicketsButtonLabel(sendBusy: boolean, isDesktop: boolean): string {
  if (sendBusy) return "Sending…";
  return isDesktop ? "Send tickets" : "Send";
}

/** Standard "N queued / M failed / K skipped" toast for a bulk-send queue result — shared by
 * the header "Send tickets" dialog and the bulk-bar's send-to-selection action. */
function notifyBulkSendResult(
  result: { queued: number; skipped: number; failed: number },
  addToast: (message: string, variant?: ToastVariant) => void,
) {
  const { queued, skipped, failed } = result;

  if (failed === 0 && queued === 0) {
    const message = skipped > 0 ? `No tickets were queued (${skipped} skipped).` : "No tickets to send.";
    addToast(message, "info");
    return;
  }

  if (failed === 0) {
    const skippedNote = skipped > 0 ? ` (${skipped} skipped)` : "";
    addToast(`Sending tickets to ${queued} ${pluralize(queued, "attendee")}${skippedNote}.`, "success");
    return;
  }

  if (queued === 0) {
    const skippedNote = skipped > 0 ? ` (${skipped} skipped)` : "";
    addToast(
      `Bulk send failed: ${failed} ${pluralize(failed, "ticket")} could not be sent${skippedNote}.`,
      "error",
    );
    return;
  }

  const skippedNote = skipped > 0 ? `; ${skipped} skipped` : "";
  addToast(`Sent ${queued} ${pluralize(queued, "ticket")}; ${failed} failed${skippedNote}.`, "warning");
}

/** Standard "N checked in (M already admitted)" toast for a bulk manual check-in result —
 * shared shape with notifyBulkSendResult above. */
function notifyBulkCheckInResult(
  result: { checkedIn: number; alreadyCheckedIn: number; revoked: number; invalid: number; errored: number },
  addToast: (message: string, variant?: ToastVariant) => void,
) {
  const { checkedIn, alreadyCheckedIn, revoked, invalid, errored } = result;
  const notes: string[] = [];
  if (alreadyCheckedIn > 0) notes.push(`${alreadyCheckedIn} already admitted`);
  if (revoked > 0) notes.push(`${revoked} pass revoked`);
  if (invalid > 0) notes.push(`${invalid} not found`);
  if (errored > 0) notes.push(`${errored} failed unexpectedly`);
  const noteSuffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";

  if (checkedIn > 0) {
    addToast(`${checkedIn} ${pluralize(checkedIn, "attendee")} checked in${noteSuffix}.`, errored > 0 ? "warning" : "success");
    return;
  }

  if (alreadyCheckedIn > 0) {
    addToast("All selected attendees were already checked in.", "info");
    return;
  }

  addToast(`No attendees checked in${noteSuffix}.`, "error");
}

/** Standard "N check-ins revoked (M weren't checked in)" toast for a bulk revoke-check-in
 * result — shared shape with notifyBulkCheckInResult above. */
function notifyBulkRevokeCheckInResult(
  result: { revoked: number; notAdmitted: number; blocked: number; errored: number },
  addToast: (message: string, variant?: ToastVariant) => void,
) {
  const { revoked, notAdmitted, blocked, errored } = result;
  const notes: string[] = [];
  if (notAdmitted > 0) notes.push(`${notAdmitted} weren't checked in`);
  if (blocked > 0) notes.push(`${blocked} pass no longer active`);
  if (errored > 0) notes.push(`${errored} failed unexpectedly`);
  const noteSuffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";

  if (revoked > 0) {
    addToast(
      `${revoked} ${pluralize(revoked, "check-in")} revoked${noteSuffix}.`,
      errored > 0 ? "warning" : "success",
    );
    return;
  }

  // Only the clean "nobody had anything to revoke" case gets its own reassuring copy - a mix
  // with blocked/errored falls through to the generic message below, whose noteSuffix already
  // spells out every reason (code review: this branch used to fire on notAdmitted alone, so a
  // blocked-pass attendee - who WAS checked in - got misreported as "nobody was checked in").
  if (notAdmitted > 0 && blocked === 0 && errored === 0) {
    addToast("None of the selected attendees were checked in.", "info");
    return;
  }

  addToast(`No check-ins revoked${noteSuffix}.`, "error");
}

/** Standard "N items revoked" / "nothing to revoke" toast for a bulk revoke-items result —
 * extracted (not inlined in the handler) to keep handleBulkRevokeItemsSelected's own cognitive
 * complexity within Sonar's threshold, same reasoning as notifyBulkRevokePassResult above. */
function notifyBulkRevokeItemsResult(
  revokedCount: number,
  addToast: (message: string, variant?: ToastVariant) => void,
) {
  if (revokedCount > 0) {
    addToast(`${revokedCount} item${revokedCount === 1 ? "" : "s"} revoked.`, "success");
  } else {
    addToast("No issued items to revoke for the selected attendees.", "info");
  }
}

/** Standard "N passes revoked (M already revoked or cancelled)" toast for a bulk revoke-pass
 * result — shared shape with notifyBulkRevokeCheckInResult above (extracted, not inlined in the
 * handler, to keep handleBulkRevokePassSelected's own cognitive complexity within Sonar's
 * threshold). */
function notifyBulkRevokePassResult(
  result: { revoked: number; skipped: number; errored: number },
  addToast: (message: string, variant?: ToastVariant) => void,
) {
  const { revoked, skipped, errored } = result;
  const notes: string[] = [];
  if (skipped > 0) notes.push(`${skipped} already revoked or cancelled`);
  if (errored > 0) notes.push(`${errored} failed unexpectedly`);
  const noteSuffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";

  if (revoked > 0) {
    // Not pluralize() - "pass" needs "passes", not the naive "passs" a bare +s would give.
    addToast(`${revoked} ${revoked === 1 ? "pass" : "passes"} revoked${noteSuffix}.`, errored > 0 ? "warning" : "success");
    return;
  }

  if (skipped > 0 && errored === 0) {
    addToast("All selected attendees were already revoked or cancelled.", "info");
    return;
  }

  addToast(`No passes revoked${noteSuffix}.`, "error");
}

/** Shared three-way "none found / already set / N changed" toast for a bulk field-assignment
 * result — change ticket type and change attendance status independently duplicated this exact
 * branching (bot review). `labels` lets each caller keep its own copy (e.g. quoted vs unquoted,
 * with or without a leading phrase like "attendance status") while sharing the decision logic.
 * `conflictCount` (rows a concurrent edit raced between the server's read and its per-row CAS
 * write, added alongside that fix) is surfaced as a trailing note rather than silently dropped —
 * it was passed through here unused until this pass, which also fixed the "none found" guard to
 * require conflictCount === 0 too: a fully-conflicted selection was genuinely found, just raced,
 * so it shouldn't read as "may have been removed". */
function notifyBulkAssignResult(
  result: { updatedCount: number; alreadySetCount: number; conflictCount: number },
  labels: { alreadyHave: string; setTo: string },
  addToast: (message: string, variant?: ToastVariant) => void,
) {
  const { updatedCount, alreadySetCount, conflictCount = 0 } = result;
  const conflictNote = conflictCount > 0 ? ` (${conflictCount} skipped — changed by someone else just now)` : "";

  if (updatedCount === 0 && alreadySetCount === 0 && conflictCount === 0) {
    // None of the selected ids resolved to an attendee in this event — most likely they were
    // deleted by someone else between opening the picker and clicking Apply (code review: this
    // used to fall into the "already had it" branch below, which is wrong — nothing was found
    // at all, let alone already set to the type).
    addToast("None of the selected attendees could be found — they may have been removed.", "error");
    return;
  }

  if (updatedCount === 0 && alreadySetCount === 0) {
    addToast(`No attendees were updated${conflictNote}.`, "warning");
    return;
  }

  if (updatedCount === 0) {
    addToast(`All selected attendees already have ${labels.alreadyHave}${conflictNote}.`, "info");
    return;
  }

  const alreadyNote = alreadySetCount > 0 ? ` (${alreadySetCount} already had it)` : "";
  addToast(
    `${updatedCount} attendee${updatedCount === 1 ? "" : "s"} set to ${labels.setTo}${alreadyNote}${conflictNote}`,
    "success",
  );
}

/** The error-surfacing half of {@link RunBulkActionParams} — split out so
 * {@link reportBulkActionError} can take just these, independent of the action's result type T. */
interface BulkActionErrorReporters {
  reportApiError: (status: number) => void;
  /** Inline dialog error setter. Omit for an action with no confirm dialog (Send tickets, Check
   * in) — those toast the error instead, matching AGENTS.md's toast-vs-inline convention. */
  setError?: (message: string | null) => void;
  addToast: (message: string, variant?: ToastVariant) => void;
  /** Passed to operatorApiErrorMessage() as the fallback for a recognized ApiError with no safe
   * user-facing detail. Ignored when mapErrorMessage is provided. */
  apiErrorFallback: string;
  /** Message shown for a thrown non-ApiError value (network failure, unexpected exception) —
   * deliberately a different string than apiErrorFallback in every caller below; that split
   * already existed per-handler before this helper, not something introduced here. */
  genericFallback: string;
  /** Overrides the default operatorApiErrorMessage(err, apiErrorFallback) computation for a
   * recognized ApiError — e.g. Change ticket type's unknown_ticket_type code needs its own copy. */
  mapErrorMessage?: (err: ApiError) => string;
}

interface RunBulkActionParams<T> extends BulkActionErrorReporters {
  eventId: string | undefined;
  /** Detects the operator navigating to a different event's Attendees list before the request
   * resolves — every bulk action below skips its success/error side effects once this fires,
   * matching the guard handleBulkDeleteSelected established first (CodeRabbit review). */
  eventIdRef: RefObject<string | undefined>;
  selectedCount: number;
  setBusy: (busy: boolean) => void;
  action: (eventId: string) => Promise<T>;
  onSuccess: (result: T) => void;
}

/** Resolves and surfaces a bulk action's caught error — the 401 redirect, the
 * mapErrorMessage/operatorApiErrorMessage selection, and the setError-vs-addToast branching.
 * Extracted out of runBulkAction to keep its own cognitive complexity under SonarCloud's
 * threshold (bot review). */
function reportBulkActionError(err: unknown, reporters: BulkActionErrorReporters): void {
  const { reportApiError, setError, addToast, apiErrorFallback, genericFallback, mapErrorMessage } = reporters;
  if (!(err instanceof ApiError)) {
    if (setError) setError(genericFallback);
    else addToast(genericFallback, "error");
    return;
  }
  reportApiError(err.status);
  if (err.status === 401) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?next=${next}`);
    return;
  }
  const message = mapErrorMessage ? mapErrorMessage(err) : operatorApiErrorMessage(err, apiErrorFallback);
  if (setError) setError(message);
  else addToast(message, "error");
}

/** Shared skeleton for the Attendees list's bulk actions (send tickets/check in/revoke check-in/
 * change ticket type/delete/revoke items/revoke pass) — SonarCloud flagged the duplication
 * between the first two of these when check-in bulk actions shipped; this extends the same
 * dedup to the rest (PO request). Bulk export deliberately stays its own function — its
 * AbortController-based cancel-in-flight lifecycle doesn't share this shape, and forcing it in
 * would need its own special-cased branch rather than reusing this one cleanly. */
async function runBulkAction<T>({
  eventId,
  eventIdRef,
  selectedCount,
  setBusy,
  action,
  onSuccess,
  ...errorReporters
}: RunBulkActionParams<T>): Promise<void> {
  if (!eventId || selectedCount === 0) return;
  const initiatingEventId = eventId;
  const isStillOnEvent = () => eventIdRef.current === initiatingEventId;
  setBusy(true);
  errorReporters.setError?.(null);
  try {
    const result = await action(initiatingEventId);
    if (!isStillOnEvent()) return;
    onSuccess(result);
  } catch (err) {
    // Busy cleanup below is unconditional regardless of isStillOnEvent() — it's this
    // component's own busy-flag state, not tied to which event initiated the request, and stays
    // stuck true forever otherwise once the operator has navigated away (CodeRabbit review).
    if (isStillOnEvent()) reportBulkActionError(err, errorReporters);
  } finally {
    setBusy(false);
  }
}

interface SendTicketsDialogProps {
  open: boolean;
  busy: boolean;
  target: "unsent" | "all";
  error: string | null;
  onTargetChange: (t: "unsent" | "all") => void;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirm bulk ticket email send with undelivered vs all attendees target. */
function SendTicketsDialog({
  open,
  busy,
  target,
  error,
  onTargetChange,
  onConfirm,
  onClose,
}: Readonly<SendTicketsDialogProps>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, open, onClose);

  if (!open) return null;

  return (
    <div className="add-attendee-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="add-attendee-modal__backdrop" role="presentation" onClick={onClose} />
      <div className="add-attendee-modal__panel" ref={panelRef}>
        <h2 className="add-attendee-modal__title" id={titleId}>
          Send tickets
        </h2>
        {error && (
          <p className="add-attendee-modal__error" role="alert">
            {error}
          </p>
        )}
        <p className="mail-field-hint">Choose who should receive a ticket email in this batch.</p>
        <div className="mail-field-row">
          <label className="send-tickets-radio">
            <input
              type="radio"
              name="send-target"
              value="unsent"
              checked={target === "unsent"}
              disabled={busy}
              onChange={() => onTargetChange("unsent")}
            />
            <span>
              <strong>Undelivered only</strong>
              <span className="mail-field-hint">
                Skip attendees who already have a ticket email accepted, sent, delivered, or queued.
              </span>
            </span>
          </label>
          <label className="send-tickets-radio">
            <input
              type="radio"
              name="send-target"
              value="all"
              checked={target === "all"}
              disabled={busy}
              onChange={() => onTargetChange("all")}
            />
            <span>
              <strong>All attendees</strong>
              <span className="mail-field-hint">
                Resend to everyone, including those who already received a ticket.
              </span>
            </span>
          </label>
        </div>
        <div className="add-attendee-modal__actions">
          <Button type="button" variant="primary" disabled={busy} onClick={onConfirm}>
            {busy ? "Sending…" : "Send tickets"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Derived from RSVP_LABELS' own keys (a Record<RsvpStatus, string>) instead of a hand-typed
 * literal, so a future change to the RsvpStatus union can't silently drift out of sync here -
 * RSVP_LABELS itself fails to compile until every union member is accounted for. */
const RSVP_STATUS_OPTIONS = Object.keys(RSVP_LABELS) as RsvpStatus[];

interface CardPickerDialogProps<T> {
  open: boolean;
  busy: boolean;
  selectedCount: number;
  title: string;
  /** Used in the "Set the {fieldLabel} for N selected attendees." hint line. */
  fieldLabel: string;
  error: string | null;
  options: T[];
  getKey: (option: T) => string;
  getAriaLabel: (option: T) => string;
  renderBadge: (option: T) => ReactNode;
  value: string;
  onValueChange: (key: string) => void;
  radioGroupName: string;
  /** Apply also stays disabled with no value picked — only relevant for a dynamic, possibly-
   * empty catalog (ticket types); a fixed enum (RSVP status) always has one. */
  requireValue?: boolean;
  /** Same "don't act on reflex" pause as ConfirmDialog's own confirmDelaySeconds (identical
   * armed/countdown-bar mechanics, ported here since this dialog shape predates it) — ties the
   * Apply button, not picking a card, to the cooldown, matching every other bulk action in this
   * file (code review on #569). */
  confirmDelaySeconds?: number;
  onConfirm: () => void;
  onClose: () => void;
}

/** Pick one card from a badge-styled list for every selected attendee (real radios underneath
 * for keyboard/AT semantics) — shared by bulk Change ticket type (#521) and Change attendance
 * status, which independently duplicated this exact dialog (bot review). Errors render inline —
 * the dialog has focus, so a toast behind it would go unseen (AGENTS.md toast-vs-inline table). */
function CardPickerDialog<T>({
  open,
  busy,
  selectedCount,
  title,
  fieldLabel,
  error,
  options,
  getKey,
  getAriaLabel,
  renderBadge,
  value,
  onValueChange,
  radioGroupName,
  requireValue,
  confirmDelaySeconds,
  onConfirm,
  onClose,
}: Readonly<CardPickerDialogProps<T>>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(confirmDelaySeconds === undefined);
  useModalFocusTrap(panelRef, open, onClose);

  // Layout effect, not a plain effect — matches ConfirmDialog's own reasoning: the dialog stays
  // mounted while closed, so `armed` could still read true from the previous open, and resetting
  // before paint means a reopen never shows an enabled Apply button for a frame.
  useLayoutEffect(() => {
    if (!open || confirmDelaySeconds === undefined) return;
    setArmed(false);
    const timer = window.setTimeout(() => setArmed(true), confirmDelaySeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [open, confirmDelaySeconds]);

  if (!open) return null;

  return (
    <div className="add-attendee-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="add-attendee-modal__backdrop" role="presentation" onClick={onClose} />
      <div className="add-attendee-modal__panel" ref={panelRef}>
        <h2 className="add-attendee-modal__title" id={titleId}>
          {title}
        </h2>
        {error && (
          <p className="add-attendee-modal__error" role="alert">
            {error}
          </p>
        )}
        <p className="mail-field-hint">
          Set the {fieldLabel} for {selectedCount} selected attendee{selectedCount === 1 ? "" : "s"}.
        </p>
        <div className="change-type-options">
          {options.map((option) => {
            const key = getKey(option);
            return (
              <label
                key={key}
                className={`change-type-option${value === key ? " change-type-option--selected" : ""}`}
              >
                {/* Real radio for keyboard/AT semantics — visually the card is the control. */}
                <input
                  type="radio"
                  name={radioGroupName}
                  className="sr-only"
                  value={key}
                  checked={value === key}
                  disabled={busy}
                  onChange={() => onValueChange(key)}
                  aria-label={getAriaLabel(option)}
                />
                {renderBadge(option)}
                {value === key && (
                  <i className="ti ti-check change-type-option__check" aria-hidden="true" />
                )}
              </label>
            );
          })}
        </div>
        <div className="change-type-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <span className="confirm-dialog__confirm-wrap">
            <Tooltip
              content={
                !armed && confirmDelaySeconds !== undefined
                  ? `Please wait ${confirmDelaySeconds}s before confirming`
                  : undefined
              }
            >
              <Button
                type="button"
                variant="primary"
                disabled={busy || !armed || (requireValue ? !value : false)}
                onClick={onConfirm}
              >
                {busy ? "Applying…" : "Apply"}
              </Button>
            </Tooltip>
            {!armed && confirmDelaySeconds !== undefined && (
              <span className="confirm-dialog__arm-track" aria-hidden="true">
                <span
                  className="confirm-dialog__arm-bar"
                  style={{ animationDuration: `${confirmDelaySeconds}s` }}
                />
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

type ExportFormat = "xlsx" | "csv" | "pdf";

interface ExportMenuProps {
  exportingFormat: ExportFormat | null;
  onExport: (format: ExportFormat) => void;
}

const EXPORT_FORMATS: { key: ExportFormat; label: string; icon: string; hint: string }[] = [
  { key: "xlsx", label: "XLSX", icon: "table", hint: "Excel workbook" },
  { key: "csv", label: "CSV", icon: "file-text", hint: "Plain text file" },
  { key: "pdf", label: "PDF", icon: "file-type-pdf", hint: "Ready to print" },
];

/** Single "Export" entry point — opens a small menu for XLSX/CSV/PDF, replacing three separate buttons. */
function ExportMenu({ exportingFormat, onExport }: Readonly<ExportMenuProps>) {
  const { open, setOpen, close, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();

  return (
    <div className="attendees-export-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        icon={<i className="ti ti-download" aria-hidden="true" />}
        hasMenu
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={exportingFormat !== null}
        onClick={() => setOpen((o) => !o)}
      >
        {exportingFormat ? `Exporting ${exportingFormat.toUpperCase()}…` : "Export"}
      </Button>
      {open && (
        <div className="attendees-export-menu__panel" role="menu" ref={panelRef}>
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format.key}
              type="button"
              role="menuitem"
              className="attendees-export-menu__item"
              onClick={() => {
                close();
                onExport(format.key);
              }}
            >
              <span className="attendees-export-menu__item-icon">
                <i className={`ti ti-${format.icon}`} aria-hidden="true" />
              </span>
              <span className="attendees-export-menu__item-text">
                <strong>{format.label}</strong>
                <span>{format.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface LoadListErrorContext {
  setItems: (items: AttendeeRowDto[]) => void;
  setTotal: (total: number) => void;
  setLoadError: (message: string | null) => void;
  reportApiError: (status: number) => void;
}

/** The catch-block error handling for loadList's fetch — split out to keep that function's
 * cognitive complexity under SonarCloud's threshold (bot review), matching the same extraction
 * pattern as reportBulkActionError/runBulkAction above. */
function reportLoadListError(err: unknown, ctx: LoadListErrorContext): void {
  if (err instanceof DOMException && err.name === "AbortError") return;
  const { setItems, setTotal, setLoadError, reportApiError } = ctx;
  setItems([]);
  setTotal(0);
  if (!(err instanceof ApiError)) {
    setLoadError("Failed to load attendees.");
    return;
  }
  reportApiError(err.status);
  if (err.status === 401) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?next=${next}`);
    return;
  }
  setLoadError(err.status === 403 ? "You do not have access to this event." : "Failed to load attendees.");
}

interface PassStatusErrorContext {
  reportApiError: (status: number) => void;
  addToast: (message: string, variant?: ToastVariant) => void;
  revokeOpen: boolean;
  setRevokeOpen: (open: boolean) => void;
  setRevokeTarget: (target: AttendeeRowDto | null) => void;
  setRevokeError: (message: string | null) => void;
  setReloadToken: (updater: (n: number) => number) => void;
}

/** The 409-conflict half of {@link reportPassStatusChangeError} — split out further so neither
 * function's own cognitive complexity creeps back over the threshold. */
function reportPassStatusConflict(err: ApiError, ctx: PassStatusErrorContext): void {
  const { addToast, revokeOpen, setRevokeOpen, setRevokeTarget, setRevokeError, setReloadToken } = ctx;
  if (err.code === "event_full") {
    addToast("Event is at capacity — pass cannot be restored.", "error");
    return;
  }
  if (err.code === "stale_write") {
    addToast("Someone else updated this attendee — reloading list", "warning");
    setRevokeOpen(false);
    setRevokeTarget(null);
    setRevokeError(null);
    setReloadToken((n) => n + 1);
    return;
  }
  if (revokeOpen) {
    setRevokeError("Could not update pass status.");
  } else {
    addToast("Could not update pass status.", "error");
  }
}

/** The catch-block error handling for handlePassStatusChange — split out to keep that function's
 * cognitive complexity under SonarCloud's threshold (bot review), matching the same extraction
 * pattern as reportBulkActionError/runBulkAction above. */
function reportPassStatusChangeError(err: unknown, ctx: PassStatusErrorContext): void {
  const { revokeOpen, setRevokeError, addToast, reportApiError } = ctx;
  if (err instanceof ApiError) {
    reportApiError(err.status);
    if (err.status === 401) {
      const next = encodeURIComponent(window.location.pathname);
      window.location.assign(`/login?next=${next}`);
      return;
    }
    if (err.status === 409) {
      reportPassStatusConflict(err, ctx);
      return;
    }
  }
  if (revokeOpen) {
    setRevokeError(operatorApiErrorMessage(err, "Could not update pass status."));
  } else {
    addToast(operatorApiErrorMessage(err, "Could not update pass status."), "error");
  }
}

export function AttendeesPage() {
  const { eventId } = useParams();
  const { event } = useOutletContext<{ event: EventDto }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { reportApiError } = useConnectionState();
  const isDesktop = useIsDesktop();
  const listAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const bulkExportAbortRef = useRef<AbortController | null>(null);
  /** Guards handleBulkDeleteSelected against completing after the operator has navigated to a
   * different event's Attendees list while the request was still in flight (CodeRabbit review). */
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;

  const [items, setItems] = useState<AttendeeRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "admitted" | "not_admitted">("all");
  const [rsvpStatusFilter, setRsvpStatusFilter] = useState<"" | RsvpStatus>("");
  const [mailStatusFilter, setMailStatusFilter] = useState<"" | AttendeeMailStatusFilter>("");
  const [ticketTypeFilter, setTicketTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState<AttendeeSortBy>("name");
  const [sortDir, setSortDir] = useState<AttendeeSortDir>("asc");
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);
  const [ticketTypesError, setTicketTypesError] = useState<string | null>(null);
  const [ticketTypesRetryToken, setTicketTypesRetryToken] = useState(0);
  // Only the count is ever used (gates the bulk "Revoke items" action) — no need to hold onto
  // the full item catalog here, unlike ticketTypes above (whose labels/colors ARE rendered).
  const [eventItemCount, setEventItemCount] = useState(0);
  const [eventItemsError, setEventItemsError] = useState<string | null>(null);
  const [eventItemsRetryToken, setEventItemsRetryToken] = useState(0);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [loading, setLoading] = useState(true);
  // True once the very first fetch (success or failure) has settled - distinguishes the
  // real first-load skeleton from a later filter/search landing on zero matches, which
  // should dim in place like any other refetch instead of flashing the skeleton again.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sendTicketsOpen, setSendTicketsOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<"unsent" | "all">("unsent");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [bulkSendBusy, setBulkSendBusy] = useState(false);
  const [bulkSendConfirmOpen, setBulkSendConfirmOpen] = useState(false);
  const [bulkCheckInBusy, setBulkCheckInBusy] = useState(false);
  const [bulkRevokeCheckInBusy, setBulkRevokeCheckInBusy] = useState(false);
  const [bulkRevokeCheckInConfirmOpen, setBulkRevokeCheckInConfirmOpen] = useState(false);
  const [bulkRevokeCheckInError, setBulkRevokeCheckInError] = useState<string | null>(null);
  const [bulkExportBusy, setBulkExportBusy] = useState(false);
  const [changeTypeOpen, setChangeTypeOpen] = useState(false);
  const [changeTypeBusy, setChangeTypeBusy] = useState(false);
  const [changeTypeError, setChangeTypeError] = useState<string | null>(null);
  const [changeTypeValue, setChangeTypeValue] = useState("");
  const [changeRsvpOpen, setChangeRsvpOpen] = useState(false);
  const [changeRsvpBusy, setChangeRsvpBusy] = useState(false);
  const [changeRsvpError, setChangeRsvpError] = useState<string | null>(null);
  const [changeRsvpValue, setChangeRsvpValue] = useState<RsvpStatus>("confirmed");
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkRevokeItemsBusy, setBulkRevokeItemsBusy] = useState(false);
  const [bulkRevokeItemsConfirmOpen, setBulkRevokeItemsConfirmOpen] = useState(false);
  const [bulkRevokeItemsError, setBulkRevokeItemsError] = useState<string | null>(null);
  const [bulkRevokePassBusy, setBulkRevokePassBusy] = useState(false);
  const [bulkRevokePassConfirmOpen, setBulkRevokePassConfirmOpen] = useState(false);
  const [bulkRevokePassError, setBulkRevokePassError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AttendeeRowDto | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const passActionBusyRef = useRef(new Set<string>());
  const [passActionBusyVersion, setPassActionBusyVersion] = useState(0);
  const passActionBusyIds = useMemo(
    () => new Set(passActionBusyRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passActionBusyVersion is a version counter; the ref holds the data, the state is the invalidation signal
    [passActionBusyVersion],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!eventId) return;
    setTicketTypeFilter("");
    setTicketTypes([]);
    setTicketTypesError(null);
    const ac = new AbortController();
    fetchTicketTypes(eventId, ac.signal)
      .then((types) => {
        if (ac.signal.aborted) return;
        setTicketTypes(types);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setTicketTypes([]);
        setTicketTypesError(operatorApiErrorMessage(err, "Couldn't load types."));
      });
    return () => ac.abort();
  }, [eventId, ticketTypesRetryToken]);

  useEffect(() => {
    if (!eventId) return;
    setEventItemCount(0);
    setEventItemsError(null);
    const ac = new AbortController();
    fetchEventItems(eventId, ac.signal)
      .then((fetchedItems) => {
        if (ac.signal.aborted) return;
        setEventItemCount(fetchedItems.length);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setEventItemCount(0);
        setEventItemsError(operatorApiErrorMessage(err, "Couldn't load items."));
      });
    return () => ac.abort();
  }, [eventId, eventItemsRetryToken]);

  // Whether the header "Send tickets" button should work at all — shared with the Attendee
  // Detail page's "Resend ticket" gate via useMailConfigured.
  const mailConfigured = useMailConfigured(eventId);

  const loadList = useCallback(async () => {
    if (!eventId) return;

    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;

    setLoading(true);
    setSelectedIds(new Set());
    try {
      const data = await fetchEventAttendees(
        eventId,
        {
          page,
          pageSize,
          q: searchQuery || undefined,
          status: statusFilter,
          ticket_type: ticketTypeFilter || undefined,
          rsvp_status: rsvpStatusFilter || undefined,
          mail_status: mailStatusFilter || undefined,
          sortBy,
          sortDir,
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      setItems(data.items);
      setTotal(data.total);
      setLoadError(null);
    } catch (err) {
      reportLoadListError(err, { setItems, setTotal, setLoadError, reportApiError });
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
        setHasLoadedOnce(true);
      }
    }
  }, [
    eventId,
    page,
    pageSize,
    searchQuery,
    statusFilter,
    ticketTypeFilter,
    rsvpStatusFilter,
    mailStatusFilter,
    sortBy,
    sortDir,
    reportApiError,
  ]);

  useEffect(() => {
    void loadList();
    return () => listAbortRef.current?.abort();
  }, [loadList, reloadToken]);

  useEffect(() => {
    return () => {
      exportAbortRef.current?.abort();
      bulkExportAbortRef.current?.abort();
    };
  }, []);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!eventId) return;

      exportAbortRef.current?.abort();
      const ac = new AbortController();
      exportAbortRef.current = ac;

      setExportingFormat(format);
      try {
        await exportAttendees(
          eventId,
          {
            q: searchQuery || undefined,
            status: statusFilter,
            ticket_type: ticketTypeFilter || undefined,
            rsvp_status: rsvpStatusFilter || undefined,
            mail_status: mailStatusFilter || undefined,
          },
          format,
          ac.signal,
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof ApiError) {
          reportApiError(err.status);
          if (err.status === 401) {
            const next = encodeURIComponent(window.location.pathname);
            window.location.assign(`/login?next=${next}`);
            return;
          }
          addToast(operatorApiErrorMessage(err, "Request failed."), "error");
        } else {
          addToast("Export failed.", "error");
        }
      } finally {
        if (!ac.signal.aborted) setExportingFormat(null);
      }
    },
    [eventId, searchQuery, statusFilter, ticketTypeFilter, rsvpStatusFilter, mailStatusFilter, reportApiError, addToast],
  );

  const handleCreated = (attendee: AttendeeDetailDto) => {
    addToast(`${attendee.name} added`, "success");
    setPage(1);
    setReloadToken((n) => n + 1);
  };

  const handlePassStatusChange = useCallback(
    async (row: AttendeeRowDto, nextStatus: "registered" | "revoked") => {
      if (!eventId) return;
      if (passActionBusyRef.current.has(row.id)) return;
      passActionBusyRef.current.add(row.id);
      setPassActionBusyVersion((version) => version + 1);
      setRevokeError(null);
      try {
        const updated = await updateAttendee(eventId, row.id, {
          status: nextStatus,
          expected_updated_at: row.updated_at,
        });
        setItems((prev) => prev.map((item) => (item.id === row.id ? mergeAttendeeRow(item, updated) : item)));
        setRevokeOpen(false);
        setRevokeTarget(null);
        addToast(nextStatus === "revoked" ? "Pass revoked" : "Pass restored", "success");
      } catch (err) {
        reportPassStatusChangeError(err, {
          reportApiError,
          addToast,
          revokeOpen,
          setRevokeOpen,
          setRevokeTarget,
          setRevokeError,
          setReloadToken,
        });
      } finally {
        if (passActionBusyRef.current.delete(row.id)) {
          setPassActionBusyVersion((version) => version + 1);
        }
      }
    },
    [addToast, eventId, reportApiError, revokeOpen],
  );

  const handleSendTicketsConfirm = async () => {
    if (!eventId) return;
    setSendBusy(true);
    setSendError(null);
    try {
      const result = await bulkResendTickets(eventId, sendTarget);
      setSendTicketsOpen(false);
      notifyBulkSendResult(result, addToast);
      setReloadToken((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
        setSendError(operatorApiErrorMessage(err, "Send failed."));
      } else {
        setSendError("Failed to queue tickets.");
      }
    } finally {
      setSendBusy(false);
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** Selects/deselects every currently-loaded row — scoped to this page only, never across pages. */
  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const allSelected = items.length > 0 && items.every((item) => prev.has(item.id));
      return allSelected ? new Set() : new Set(items.map((item) => item.id));
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  /** Separate, additive bulk-send path for an explicit subset of selected attendees — the
   * existing header "Send tickets" dialog (all / undelivered-only) is untouched. No
   * templateId here on purpose: the server falls back to the built-in default ("ticket")
   * template when it's omitted, the same as the plain bulk-resend endpoint already does -
   * so this works even for an event with no persisted ticket template row. */
  const handleBulkSendSelected = () =>
    runBulkAction({
      eventId,
      eventIdRef,
      selectedCount: selectedIds.size,
      reportApiError,
      setBusy: setBulkSendBusy,
      addToast,
      apiErrorFallback: "Send failed.",
      genericFallback: "Failed to queue tickets.",
      action: (id) =>
        sendEventBulk(id, { filter: { type: "attendee_ids", ids: [...selectedIds] } }),
      onSuccess: (result) => {
        notifyBulkSendResult(result, addToast);
        setReloadToken((n) => n + 1);
      },
    });

  /** Manual bulk check-in for an explicit subset of selected attendees — no confirmation dialog
   * (matches the design mockup and ADR-0010's "manual check-in is first-class, must be fast";
   * it's a reversible internal state change, not an email send). Guards the completion effect
   * against the operator navigating to a different event's Attendees list before the request
   * resolves, same pattern as handleBulkDeleteSelected below. */
  const handleBulkCheckInSelected = () =>
    runBulkAction({
      eventId,
      eventIdRef,
      selectedCount: selectedIds.size,
      reportApiError,
      setBusy: setBulkCheckInBusy,
      addToast,
      apiErrorFallback: "Check-in failed.",
      genericFallback: "Failed to check in attendees.",
      action: (id) => bulkCheckInAttendees(id, [...selectedIds]),
      onSuccess: (result) => {
        notifyBulkCheckInResult(result, addToast);
        clearSelection();
        setReloadToken((n) => n + 1);
      },
    });

  /** Bulk "Revoke check-in" for an explicit subset of selected attendees — behind a confirm
   * dialog with the same dialog-stays-open-with-inline-error convention and confirm-delay
   * cooldown as handleBulkRevokeItemsSelected/handleBulkRevokePassSelected below (PO review:
   * this used to fire immediately from the menu with no confirmation at all). */
  const handleBulkRevokeCheckInSelected = () =>
    runBulkAction({
      eventId,
      eventIdRef,
      selectedCount: selectedIds.size,
      reportApiError,
      setBusy: setBulkRevokeCheckInBusy,
      setError: setBulkRevokeCheckInError,
      addToast,
      apiErrorFallback: "Revoke check-in failed.",
      genericFallback: "Failed to revoke check-in.",
      action: (id) => bulkRevokeCheckIn(id, [...selectedIds]),
      onSuccess: (result) => {
        notifyBulkRevokeCheckInResult(result, addToast);
        setBulkRevokeCheckInConfirmOpen(false);
        clearSelection();
        setReloadToken((n) => n + 1);
      },
    });

  /** CSV export of an explicit subset of selected attendees — separate from the header
   * "Export" dropdown (which exports the whole filtered view): the server bypasses list
   * filters when attendee_ids is present. CSV only, per the design mockup. No success toast
   * and selection stays put, matching the header export's behavior (the download starting is
   * the feedback). */
  const handleBulkExportSelected = async () => {
    if (!eventId || selectedIds.size === 0) return;
    const initiatingEventId = eventId;
    const isStillOnEvent = () => eventIdRef.current === initiatingEventId;
    bulkExportAbortRef.current?.abort();
    const ac = new AbortController();
    bulkExportAbortRef.current = ac;
    setBulkExportBusy(true);
    try {
      await exportSelectedAttendees(initiatingEventId, [...selectedIds], "csv", ac.signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!isStillOnEvent()) return;
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
        addToast(operatorApiErrorMessage(err, "Export failed."), "error");
      } else {
        addToast("Export failed.", "error");
      }
    } finally {
      if (!ac.signal.aborted) setBulkExportBusy(false);
    }
  };

  /** Bulk ticket-type assignment for an explicit subset of selected attendees (#521). Success
   * toasts with an updated/already-had-it breakdown, clears the selection, and reloads the
   * list; failure renders inline in the dialog (which stays open), matching the project's
   * dialog convention. The unknown_ticket_type branch covers the type being deleted between
   * the picker opening and submit — the server re-validates under the catalog lock. */
  const handleBulkChangeTicketTypeConfirm = () => {
    if (!changeTypeValue) return;
    const typeLabel =
      ticketTypes.find((t) => t.key === changeTypeValue)?.label ?? changeTypeValue;
    return runBulkAction({
      eventId,
      eventIdRef,
      selectedCount: selectedIds.size,
      reportApiError,
      setBusy: setChangeTypeBusy,
      setError: setChangeTypeError,
      addToast,
      apiErrorFallback: "Change failed.",
      genericFallback: "Failed to change ticket type.",
      mapErrorMessage: (err) =>
        hasApiErrorCode(err, "unknown_ticket_type")
          ? "That ticket type no longer exists — it may have just been deleted. Close and try again."
          : operatorApiErrorMessage(err, "Change failed."),
      action: (id) => bulkChangeTicketType(id, [...selectedIds], changeTypeValue),
      onSuccess: (result) => {
        notifyBulkAssignResult(result, { alreadyHave: typeLabel, setTo: typeLabel }, addToast);
        setChangeTypeOpen(false);
        clearSelection();
        setReloadToken((n) => n + 1);
      },
    });
  };

  /** Bulk attendance (RSVP) status change for an explicit subset of selected attendees — same
   * shape (and same three-way success split, same code-review reasoning) as
   * handleBulkChangeTicketTypeConfirm above: updatedCount and alreadySetCount both zero means
   * none of the selected ids resolved to an attendee in this event anymore (removed by someone
   * else between opening the picker and clicking Apply), distinct from "found but already set". */
  const handleBulkChangeRsvpConfirm = () =>
    runBulkAction({
      eventId,
      eventIdRef,
      selectedCount: selectedIds.size,
      reportApiError,
      setBusy: setChangeRsvpBusy,
      setError: setChangeRsvpError,
      addToast,
      apiErrorFallback: "Change failed.",
      genericFallback: "Failed to change attendance status.",
      action: (id) => bulkChangeRsvpStatus(id, [...selectedIds], changeRsvpValue),
      onSuccess: (result) => {
        const label = RSVP_LABELS[changeRsvpValue];
        notifyBulkAssignResult(
          result,
          { alreadyHave: `attendance status "${label}"`, setTo: `"${label}"` },
          addToast,
        );
        setChangeRsvpOpen(false);
        clearSelection();
        setReloadToken((n) => n + 1);
      },
    });

  /** Bulk GDPR erasure for an explicit subset of selected attendees — same effect as running
   * the attendee detail page's "Delete attendee" once per selected row. Guards every
   * completion effect against the operator navigating to a different event's Attendees list
   * before the request resolves (CodeRabbit review); the dialog stays open on failure with an
   * inline error, matching the project's own ConfirmDialog convention (destructive actions
   * don't also toast the same message) and the attendee detail page's single-delete flow. */
  const handleBulkDeleteSelected = () =>
    runBulkAction({
      eventId,
      eventIdRef,
      selectedCount: selectedIds.size,
      reportApiError,
      setBusy: setBulkDeleteBusy,
      setError: setBulkDeleteError,
      addToast,
      apiErrorFallback: "Delete failed.",
      genericFallback: "Failed to delete attendees.",
      action: (id) => bulkDeleteAttendees(id, [...selectedIds]),
      onSuccess: ({ deletedCount }) => {
        addToast(`${deletedCount} attendee${deletedCount === 1 ? "" : "s"} permanently deleted`, "success");
        setBulkDeleteConfirmOpen(false);
        clearSelection();
        setReloadToken((n) => n + 1);
      },
    });

  /** Bulk "Revoke items" for an explicit subset of selected attendees — resets every issued
   * item hand-out (badge, wristband, giftbag, …) back to pending for each selected attendee at
   * once, independent of check-in status. Same dialog-stays-open-with-inline-error-on-failure
   * convention as handleBulkDeleteSelected above; an attendee with a revoked/cancelled pass is
   * skipped server-side rather than treated as a failure, so a partial revokedCount below the
   * selection size is still a plain success toast, not an error. */
  const handleBulkRevokeItemsSelected = () =>
    runBulkAction({
      eventId,
      eventIdRef,
      selectedCount: selectedIds.size,
      reportApiError,
      setBusy: setBulkRevokeItemsBusy,
      setError: setBulkRevokeItemsError,
      addToast,
      apiErrorFallback: "Revoke items failed.",
      genericFallback: "Failed to revoke items.",
      action: (id) => bulkRevokeItems(id, [...selectedIds]),
      onSuccess: ({ revokedCount }) => {
        notifyBulkRevokeItemsResult(revokedCount, addToast);
        setBulkRevokeItemsConfirmOpen(false);
        clearSelection();
        setReloadToken((n) => n + 1);
      },
    });

  /** Bulk "Revoke pass" for an explicit subset of selected attendees — same effect as the
   * attendee detail page's single "Revoke pass" action, run once per selected attendee. Same
   * dialog-stays-open-with-inline-error-on-failure convention as handleBulkDeleteSelected above
   * (destructive-ish action, doesn't also toast the same message). An attendee already revoked
   * or cancelled is left untouched server-side and counted separately, not treated as a
   * failure - reported in the success toast rather than surfaced as an error. */
  const handleBulkRevokePassSelected = () =>
    runBulkAction({
      eventId,
      eventIdRef,
      selectedCount: selectedIds.size,
      reportApiError,
      setBusy: setBulkRevokePassBusy,
      setError: setBulkRevokePassError,
      addToast,
      apiErrorFallback: "Revoke pass failed.",
      genericFallback: "Failed to revoke pass.",
      action: (id) => bulkRevokePass(id, [...selectedIds]),
      onSuccess: (result) => {
        notifyBulkRevokePassResult(result, addToast);
        setBulkRevokePassConfirmOpen(false);
        clearSelection();
        setReloadToken((n) => n + 1);
      },
    });

  const isUnfilteredEmpty =
    total === 0 &&
    !searchQuery &&
    statusFilter === "all" &&
    !ticketTypeFilter &&
    !rsvpStatusFilter &&
    !mailStatusFilter;

  // How many of the selection the bulk "Revoke check-in" confirm dialog would actually affect,
  // not the raw selection size — matches the bulk bar's own menu-item hint (PO review).
  const revokableCheckInCount = items.filter(
    (row) => selectedIds.has(row.id) && row.check_in_status === "admitted",
  ).length;

  // How many of the selection the bulk "Revoke items" confirm dialog would actually affect, not
  // the raw selection size (PO review) — matches the bulk bar's own menu-item hint. A
  // blocked-pass attendee is excluded even if has_issued_items is true: the server's own
  // isAdmittable guard refuses to reset their items, so counting them here would overstate the
  // impact and could report a real revoke as "no issued items to revoke" (CodeRabbit review).
  const revokableItemsCount = items.filter(
    (row) =>
      selectedIds.has(row.id) &&
      row.has_issued_items &&
      row.status !== "cancelled" &&
      row.status !== "revoked",
  ).length;

  // How many of the selection actually have an active pass to revoke - shown in the confirm
  // dialog's title instead of the raw selection size, so a mixed selection doesn't overstate
  // the impact (PO review follow-up, #549).
  const revokablePassCount = items.filter(
    (row) => selectedIds.has(row.id) && row.status !== "cancelled" && row.status !== "revoked",
  ).length;

  if (!eventId) return <p>Missing event.</p>;

  return (
    <>
      <PageHeader
        title="Attendees"
        subtitle="Manage attendee records and resend tickets."
        className="attendees-pageheader"
        actions={
          <>
            {isEventArchived(event) ? (
              <ArchivedGuard event={event} reasonId="import-attendees-reason">
                {(guard) => (
                  <Button variant="secondary" {...guard}>
                    Import
                  </Button>
                )}
              </ArchivedGuard>
            ) : (
              <Link to={`/admin/events/${eventId}/attendees/import`}>
                <Button variant="secondary">Import</Button>
              </Link>
            )}
            <ArchivedGuard event={event} reasonId="add-attendee-reason">
              {(guard) => (
                <Button variant="primary" {...guard} onClick={() => setAddOpen(true)}>
                  {/* Shortened below 768px (attendees.css compacts these 4 buttons to fit one
                   * line, matching the bulk bar's own "never changes height" fix) — "+ Add
                   * attendee" is the one label still too long to fit even fully compacted. */}
                  {isDesktop ? "+ Add attendee" : "+ Add"}
                </Button>
              )}
            </ArchivedGuard>
            <ArchivedGuard
              event={event}
              reasonId="send-tickets-reason"
              disabled={sendBusy || mailConfigured === false}
              tooltip={
                mailConfigured === false
                  ? "No mail transport configured for this event. Set one up in Event Settings → Mailing."
                  : undefined
              }
            >
              {(guard) => (
                <Button
                  variant="secondary"
                  {...guard}
                  onClick={() => {
                    setSendTarget("unsent");
                    setSendError(null);
                    setSendTicketsOpen(true);
                  }}
                >
                  {sendTicketsButtonLabel(sendBusy, isDesktop)}
                </Button>
              )}
            </ArchivedGuard>
            <ExportMenu exportingFormat={exportingFormat} onExport={handleExport} />
          </>
        }
      />

      {loadError && !loading ? (
        <EmptyState
          title="Could not load attendees"
          description={loadError}
          action={
            <Button type="button" variant="secondary" onClick={() => void loadList()}>
              Retry
            </Button>
          }
        />
      ) : (
        <AttendeesTable
        items={items}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={loading}
        hasLoadedOnce={hasLoadedOnce}
        isUnfilteredEmpty={isUnfilteredEmpty}
        searchInput={searchInput}
        statusFilter={statusFilter}
        ticketTypeFilter={ticketTypeFilter}
        rsvpStatusFilter={rsvpStatusFilter}
        mailStatusFilter={mailStatusFilter}
        ticketTypes={ticketTypes}
        ticketTypesError={ticketTypesError}
        onRetryTicketTypes={() => setTicketTypesRetryToken((n) => n + 1)}
        onSearchChange={setSearchInput}
        onStatusFilterChange={(v) => {
          setStatusFilter(v);
          setPage(1);
        }}
        onTicketTypeFilterChange={(v) => {
          setTicketTypeFilter(v);
          setPage(1);
        }}
        onRsvpStatusFilterChange={(v) => {
          setRsvpStatusFilter(v);
          setPage(1);
        }}
        onMailStatusFilterChange={(v) => {
          setMailStatusFilter(v);
          setPage(1);
        }}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(column) => {
          if (column === sortBy) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
          } else {
            setSortBy(column);
            setSortDir("asc");
          }
          setPage(1);
        }}
        onViewAttendee={(id) => navigate(`/admin/events/${eventId}/attendees/${id}`)}
        onRevokePass={(row) => {
          setRevokeTarget(row);
          setRevokeError(null);
          setRevokeOpen(true);
        }}
        onRestorePass={(row) => void handlePassStatusChange(row, "registered")}
        passActionBusyIds={passActionBusyIds}
        onPageChange={setPage}
        onPageSizeChange={(v) => {
          setPageSize(v);
          setPage(1);
        }}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleSelectAll={toggleSelectAllOnPage}
        onClearSelection={clearSelection}
        onBulkSendTickets={() => setBulkSendConfirmOpen(true)}
        bulkSendBusy={bulkSendBusy}
        canBulkSend={mailConfigured !== false}
        onBulkCheckIn={() => void handleBulkCheckInSelected()}
        bulkCheckInBusy={bulkCheckInBusy}
        onBulkRevokeCheckIn={() => {
          setBulkRevokeCheckInError(null);
          setBulkRevokeCheckInConfirmOpen(true);
        }}
        bulkRevokeCheckInBusy={bulkRevokeCheckInBusy}
        onBulkExportSelected={() => void handleBulkExportSelected()}
        bulkExportBusy={bulkExportBusy}
        onBulkChangeTicketType={() => {
          setChangeTypeError(null);
          setChangeTypeValue(ticketTypes[0]?.key ?? "");
          setChangeTypeOpen(true);
        }}
        onBulkChangeRsvpStatus={() => {
          setChangeRsvpError(null);
          setChangeRsvpValue("confirmed");
          setChangeRsvpOpen(true);
        }}
        itemCount={eventItemCount}
        itemsError={eventItemsError}
        onRetryItems={() => setEventItemsRetryToken((n) => n + 1)}
        onBulkRevokeItems={() => {
          setBulkRevokeItemsError(null);
          setBulkRevokeItemsConfirmOpen(true);
        }}
        bulkRevokeItemsBusy={bulkRevokeItemsBusy}
        onBulkRevokePass={() => {
          setBulkRevokePassError(null);
          setBulkRevokePassConfirmOpen(true);
        }}
        bulkRevokePassBusy={bulkRevokePassBusy}
        onBulkDelete={() => {
          setBulkDeleteError(null);
          setBulkDeleteConfirmOpen(true);
        }}
        eventTimezone={event.timezone}
        event={event}
      />
      )}

      <AddAttendeeModal
        eventId={eventId}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={handleCreated}
      />

      <CardPickerDialog
        open={changeTypeOpen}
        busy={changeTypeBusy}
        selectedCount={selectedIds.size}
        title="Change ticket type"
        fieldLabel="ticket type"
        error={changeTypeError}
        options={ticketTypes}
        getKey={(t) => t.key}
        getAriaLabel={(t) => t.label}
        renderBadge={(t) => <TicketTypeBadge ticketType={t.key} catalog={ticketTypes} />}
        value={changeTypeValue}
        onValueChange={setChangeTypeValue}
        radioGroupName="bulk-ticket-type"
        requireValue
        confirmDelaySeconds={BULK_CARD_PICKER_CONFIRM_DELAY_SECONDS}
        onConfirm={() => void handleBulkChangeTicketTypeConfirm()}
        onClose={() => {
          if (!changeTypeBusy) setChangeTypeOpen(false);
        }}
      />

      <CardPickerDialog
        open={changeRsvpOpen}
        busy={changeRsvpBusy}
        selectedCount={selectedIds.size}
        title="Change attendance status"
        fieldLabel="attendance status"
        error={changeRsvpError}
        options={RSVP_STATUS_OPTIONS}
        getKey={(s) => s}
        getAriaLabel={(s) => RSVP_LABELS[s]}
        renderBadge={(s) => <RsvpStatusBadge status={s} />}
        value={changeRsvpValue}
        onValueChange={(key) => setChangeRsvpValue(key as RsvpStatus)}
        radioGroupName="bulk-rsvp-status"
        confirmDelaySeconds={BULK_CARD_PICKER_CONFIRM_DELAY_SECONDS}
        onConfirm={() => void handleBulkChangeRsvpConfirm()}
        onClose={() => {
          if (!changeRsvpBusy) setChangeRsvpOpen(false);
        }}
      />

      <SendTicketsDialog
        open={sendTicketsOpen}
        busy={sendBusy}
        target={sendTarget}
        error={sendError}
        onTargetChange={setSendTarget}
        onConfirm={() => void handleSendTicketsConfirm()}
        onClose={() => {
          if (!sendBusy) setSendTicketsOpen(false);
        }}
      />

      <ConfirmDialog
        open={revokeOpen}
        title="Revoke pass?"
        message={
          revokeTarget
            ? `Revoke the pass for ${revokeTarget.name}? They will no longer be able to check in until the pass is restored.`
            : ""
        }
        confirmLabel="Revoke pass"
        confirmVariant="danger"
        loading={revokeTarget ? passActionBusyIds.has(revokeTarget.id) : false}
        errorMessage={revokeError ?? undefined}
        onConfirm={() => {
          if (revokeTarget) void handlePassStatusChange(revokeTarget, "revoked");
        }}
        onCancel={() => {
          if (!revokeTarget || !passActionBusyIds.has(revokeTarget.id)) {
            setRevokeOpen(false);
            setRevokeTarget(null);
            setRevokeError(null);
          }
        }}
      />

      <ConfirmDialog
        open={bulkSendConfirmOpen}
        title="Send tickets?"
        message={`Send tickets to ${selectedIds.size} selected attendee${selectedIds.size === 1 ? "" : "s"}?`}
        confirmLabel="Send tickets"
        loading={bulkSendBusy}
        onConfirm={() => {
          setBulkSendConfirmOpen(false);
          void handleBulkSendSelected();
        }}
        onCancel={() => {
          if (!bulkSendBusy) setBulkSendConfirmOpen(false);
        }}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        title={`Permanently delete ${selectedIds.size} attendee${selectedIds.size === 1 ? "" : "s"}?`}
        message="This cannot be undone. For each selected attendee, this permanently removes:"
        errorMessage={bulkDeleteError}
        confirmLabel="Delete attendees"
        confirmVariant="danger"
        loading={bulkDeleteBusy}
        confirmDelaySeconds={BULK_DELETE_CONFIRM_DELAY_SECONDS}
        onConfirm={() => void handleBulkDeleteSelected()}
        onCancel={() => {
          if (!bulkDeleteBusy) {
            setBulkDeleteConfirmOpen(false);
            setBulkDeleteError(null);
          }
        }}
      >
        <ul className="confirm-dialog__list">
          <li>Profile and contact details</li>
          <li>Ticket deliveries</li>
          <li>Wallet pass</li>
          <li>Check-in history</li>
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={bulkRevokeCheckInConfirmOpen}
        title={`Revoke check-in for ${revokableCheckInCount} attendee${revokableCheckInCount === 1 ? "" : "s"}?`}
        message="They will be marked as not checked in. They can check in again at any time."
        errorMessage={bulkRevokeCheckInError}
        confirmLabel="Revoke check-in"
        confirmVariant="warning"
        confirmDelaySeconds={BULK_REVOKE_CONFIRM_DELAY_SECONDS}
        loading={bulkRevokeCheckInBusy}
        onConfirm={() => void handleBulkRevokeCheckInSelected()}
        onCancel={() => {
          if (!bulkRevokeCheckInBusy) {
            setBulkRevokeCheckInConfirmOpen(false);
            setBulkRevokeCheckInError(null);
          }
        }}
      />

      <ConfirmDialog
        open={bulkRevokeItemsConfirmOpen}
        title={`Revoke items for ${revokableItemsCount} attendee${revokableItemsCount === 1 ? "" : "s"}?`}
        message="Every issued item (badge, wristband, giftbag, …) for the selected attendees is reset to pending. Items can be re-issued from the check-in screen at any time."
        errorMessage={bulkRevokeItemsError}
        confirmLabel="Revoke items"
        confirmVariant="warning"
        confirmDelaySeconds={BULK_REVOKE_CONFIRM_DELAY_SECONDS}
        loading={bulkRevokeItemsBusy}
        onConfirm={() => void handleBulkRevokeItemsSelected()}
        onCancel={() => {
          if (!bulkRevokeItemsBusy) {
            setBulkRevokeItemsConfirmOpen(false);
            setBulkRevokeItemsError(null);
          }
        }}
      />

      <ConfirmDialog
        open={bulkRevokePassConfirmOpen}
        title={`Revoke the pass for ${revokablePassCount} attendee${revokablePassCount === 1 ? "" : "s"}?`}
        message="They will no longer be able to check in until the pass is restored. Already revoked or cancelled attendees are left untouched."
        errorMessage={bulkRevokePassError}
        confirmLabel="Revoke pass"
        confirmVariant="danger"
        confirmDelaySeconds={BULK_REVOKE_CONFIRM_DELAY_SECONDS}
        loading={bulkRevokePassBusy}
        onConfirm={() => void handleBulkRevokePassSelected()}
        onCancel={() => {
          if (!bulkRevokePassBusy) {
            setBulkRevokePassConfirmOpen(false);
            setBulkRevokePassError(null);
          }
        }}
      />
    </>
  );
}
