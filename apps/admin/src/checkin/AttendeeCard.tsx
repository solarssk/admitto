import { useState } from "react";
import { Badge, Button, Card } from "@admitto/ui";
import type { BadgeVariant } from "@admitto/ui";
import type { AttendeeCardDto, CheckInStatus, TicketTypeDto } from "../api/types.js";
import { formatEventTime, getBrowserTimeZone } from "../utils/event-dates.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useInFlightIds } from "../hooks/useInFlightIds.js";
import { canRevokeCheckIn } from "./revokeEligibility.js";
import { NoteModal } from "./NoteModal.js";
import { TicketTypeBadge } from "../attendees/ticketTypeBadge.js";

type Props = {
  card: AttendeeCardDto;
  ticketTypes?: TicketTypeDto[];
  scanStatus?: CheckInStatus;
  confirmed?: boolean;
  pending?: boolean;
  canAct: boolean;
  onCheckIn?: () => void;
  onItemAction?: (itemKey: string, targetState: string) => Promise<boolean> | void;
  onAddNote?: (body: string) => Promise<void>;
  onUndo?: () => Promise<unknown> | void;
  showUndo?: boolean;
  onCancel?: () => void;
  /** Admin/superadmin only — reverses this attendee's current admission regardless of who checked them in or when. Rejects on failure so this component can show the error inline. */
  onRevokeCheckIn?: () => Promise<void>;
  /** Admin/superadmin only — resets an already-handed-out item back to "pending" so it can be issued again. Its presence alone gates the Revoke button's visibility (a UX nicety only; the server enforces the same admin/superadmin check independently), matching how onRevokeCheckIn's presence gates the check-in Revoke button. Resolves false on failure. */
  onRevokeItem?: (itemKey: string) => Promise<boolean> | void;
};

function statusForCard(
  scanStatus: CheckInStatus | undefined,
  checkInStatus: AttendeeCardDto["check_in_status"],
): CheckInStatus {
  if (scanStatus) return scanStatus;
  return checkInStatus === "admitted" ? "ALREADY_CHECKED_IN" : "INVALID";
}

function statusTitle(status: CheckInStatus): string {
  switch (status) {
    case "VALID":
      return "Valid";
    case "ALREADY_CHECKED_IN":
      return "Already checked in";
    case "INVALID":
      return "Invalid ticket";
    case "REVOKED":
      return "Revoked";
    case "PREVIEW":
      return "Ready to check in";
    default:
      return status;
  }
}

function statusIcon(status: CheckInStatus): string {
  switch (status) {
    case "VALID":
    case "PREVIEW":
      return "ti-circle-check";
    case "ALREADY_CHECKED_IN":
      return "ti-clock-exclamation";
    case "REVOKED":
      return "ti-ban";
    case "INVALID":
    default:
      return "ti-circle-x";
  }
}

// "Mark issued/returned", not "Issue X" — the operator is confirming a
// physical hand-over that already happened, not instructing the system to
// perform one; the button reads as an attestation (Jadzia review). The item's
// own name isn't repeated — it's already the row label next to this button
// (desktop) or the heading above it (mobile), and including it made the button
// too wide (PO review, round 3). Every item uses the same verb regardless of
// key. A gift bag used to read "given" here, but that was a display-only
// synonym for the same "issued" state everywhere else (badge, DB, API), and
// having two words for one action was confusing (round-2 review).
export function itemActionLabel(key: string, action: string): string {
  return `Mark ${action}`;
}

// Full accessible name for the same button — a screen reader navigating by a
// flat list of buttons won't see the visual proximity to the item's own label,
// so its aria-label needs the item name the short visible text above drops.
export function itemActionAriaLabel(key: string, action: string): string {
  return `Mark ${key.replaceAll("_", " ")} ${action}`;
}

export function itemBadgeVariant(state: string): BadgeVariant {
  const normalized = state.toLowerCase();
  if (normalized === "issued") return "ok";
  if (normalized === "returned") return "neutral";
  return "warn";
}

function statusBadgeVariant(status: CheckInStatus): BadgeVariant {
  switch (status) {
    case "VALID":
    case "PREVIEW":
      return "ok";
    case "ALREADY_CHECKED_IN":
      return "warn";
    case "REVOKED":
    case "INVALID":
    default:
      return "error";
  }
}

// A status blocks item actions and admin-revoke exactly when it's an error
// status (REVOKED/INVALID today). Derived from statusBadgeVariant rather than
// re-listing those values so it stays in sync with the badge and, unlike the
// old allowlist, fails CLOSED for any unrecognized status — matching the
// fail-closed `default` case every sibling status function here already has.
function isBlockedStatus(status: CheckInStatus): boolean {
  return statusBadgeVariant(status) === "error";
}

export function AttendeeCard({
  card,
  ticketTypes = [],
  scanStatus,
  confirmed,
  pending,
  canAct,
  onCheckIn,
  onItemAction,
  onAddNote,
  onUndo,
  showUndo,
  onCancel,
  onRevokeCheckIn,
  onRevokeItem,
}: Readonly<Props>) {
  const resolvedStatus = statusForCard(scanStatus, card.check_in_status);
  const cardClass = `checkin-card checkin-card--${resolvedStatus.toLowerCase()}`;
  const isPreview = resolvedStatus === "PREVIEW";
  const [noteOpen, setNoteOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  // `pending` reflects the slow-scan/confirm indicator (delayed on purpose,
  // see PENDING_MS in CheckInPage) — it never flips for item-action or undo
  // requests, so it gives these buttons no real double-submit protection
  // (review finding). The shared hook owns both halves of the guard: a
  // synchronous ref that blocks a same-tick double-click plus the state Set
  // that drives `disabled` once React commits. One instance keys per-item
  // actions (mark issued/returned and the admin Revoke, mutually exclusive per
  // item so their ids can't collide); the other guards the single Undo button.
  const itemGuard = useInFlightIds();
  const undoGuard = useInFlightIds();

  // Extracted out of the item row's onClick (Sonar S2004: >4 levels of
  // nested functions once this lived inline inside items.map > actions.map
  // > onClick > .finally).
  function handleItemAction(itemKey: string, action: string) {
    if (!itemGuard.start(itemKey)) return;
    Promise.resolve(onItemAction?.(itemKey, action)).finally(() => itemGuard.finish(itemKey));
  }

  function handleRevokeItem(itemKey: string) {
    if (!itemGuard.start(itemKey)) return;
    Promise.resolve(onRevokeItem?.(itemKey)).finally(() => itemGuard.finish(itemKey));
  }

  async function handleRevokeConfirm() {
    if (!onRevokeCheckIn) return;
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      await onRevokeCheckIn();
      setRevokeOpen(false);
    } catch (err) {
      setRevokeError(operatorApiErrorMessage(err, "Failed to revoke check-in. Try again."));
    } finally {
      setRevokeBusy(false);
    }
  }

  const showPrimaryActions = isPreview && onCheckIn && card.check_in_status === "not_admitted";
  const statusVariant = statusBadgeVariant(resolvedStatus);
  const isBlocked = isBlockedStatus(resolvedStatus);
  const showRevokeCheckIn =
    !!onRevokeCheckIn && canRevokeCheckIn({ checkInStatus: card.check_in_status, blocked: isBlocked });

  return (
    <>
      <Card className={cardClass} padded={false} aria-live="polite">
        {/* 1. Head (mockup ci-result__head): round tinted status icon +
            identity block (name over meta) + status badge. The badge used
            to be dotted and inline for positive statuses only, with a
            separate full-width colored bar duplicating it for
            already-checked-in/revoked/invalid — one badge, right-aligned
            and centered against the name+meta pair, now covers every
            status the same way; the bar is gone (PO review, round 4). The
            server's warning text ("Ticket is not admittable...") is no
            longer shown at all here — the badge already says "Revoked" /
            "Invalid ticket", so the reason line only repeated it (PO
            review, round 5). */}
        <div className="checkin-card__head">
          <div className={`checkin-card__status-icon checkin-card__status-icon--${statusVariant}`}>
            <i className={`ti ${statusIcon(resolvedStatus)}`} aria-hidden="true" />
          </div>
          <div className="checkin-card__identity">
            <h2 className="checkin-card__name">{card.name}</h2>
            <div className="checkin-card__meta">
              {card.ticket_type && (
                <TicketTypeBadge ticketType={card.ticket_type} catalog={ticketTypes} />
              )}
              {(card.company || card.department) && (
                <span>{[card.company, card.department].filter(Boolean).join(" · ")}</span>
              )}
              {pending && <span className="checkin-card__status-note">Pending, not confirmed</span>}
              {confirmed === false && !pending && !isPreview && resolvedStatus !== "INVALID" && resolvedStatus !== "REVOKED" && (
                <span className="checkin-card__status-note">Awaiting server confirmation</span>
              )}
            </div>
          </div>
          <Badge variant={statusVariant} className="checkin-card__status-badge">
            {statusTitle(resolvedStatus)}
          </Badge>
        </div>

        {/* 2. Primary decision — stays above the requirements list. */}
        {showPrimaryActions && (
          <div className="checkin-card__primary-actions">
            <Button
              type="button"
              variant="primary"
              size="lg"
              block
              disabled={!canAct || pending}
              onClick={onCheckIn}
            >
              Confirm check-in
            </Button>
          </div>
        )}

        {/* 3. Requirements (mockup ci-result__items): compact rows — icon,
            label (flex), then state chip or inline action at the right edge.
            The section heading and each item's admin-configured description
            (Requirements page) were missing here — without them this list
            read as inert status text rather than "hand these out" (PO/Jadzia
            review). */}
        {card.items.length > 0 && (
          <div className="checkin-card__items">
            <h3 className="checkin-card__items-title">Items to hand out</h3>
            {card.items.map((item) => (
              <div key={item.key} className="checkin-card__item">
                {/* Icon and the action button/badge both sit outside the
                    label/description column, as its siblings, so both
                    center against the pair of lines as a unit instead of
                    just the label row (PO/Jadzia review, round 3). */}
                <i
                  className={`ti ti-${item.icon ?? "package"} checkin-card__item-icon`}
                  aria-hidden="true"
                />
                <div className="checkin-card__item-content">
                  <div className="checkin-card__item-row">
                    <span className="checkin-card__item-label">
                      {item.label}
                      {item.detail && <span className="checkin-card__item-detail">{item.detail}</span>}
                    </span>
                  </div>
                  {item.description && (
                    <p className="checkin-card__item-description">{item.description}</p>
                  )}
                </div>
                {item.actions.length > 0
                  ? item.actions.map((action) => (
                      <Button
                        key={`${item.key}-${action}`}
                        type="button"
                        variant="success"
                        size="sm"
                        disabled={!canAct || pending || isBlocked || itemGuard.ids.has(item.key)}
                        aria-label={itemActionAriaLabel(item.key, action)}
                        onClick={() => handleItemAction(item.key, action)}
                      >
                        {itemActionLabel(item.key, action)}
                      </Button>
                    ))
                  : (
                      <Badge variant={itemBadgeVariant(item.state)} className="checkin-card__item-badge">
                        {item.state}
                      </Badge>
                    )}
                {/* Admin/superadmin-only corrective action: reset an item
                    that's been handed out ("issued"/"returned") back to
                    pending so it can be issued again. Independent of the
                    action buttons above — an issued item with
                    `requires_return: true` still has a "Mark returned"
                    action, but the server's revoke path resets issued OR
                    returned straight to pending, so Revoke must be offered
                    alongside it too (bot review, #457). Kept out of the
                    operator's forward-only flow — hidden for operators and
                    for a blocked (revoked/invalid) pass. Server enforces the
                    same check regardless of this visibility. */}
                {onRevokeItem && !isBlocked && item.state !== "pending" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="checkin-card__item-revoke checkin-card__aux-btn--danger"
                    disabled={!canAct || pending || itemGuard.ids.has(item.key)}
                    aria-label={`Revoke ${item.label}`}
                    onClick={() => handleRevokeItem(item.key)}
                    icon={<i className="ti ti-arrow-back-up" aria-hidden="true" />}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {card.notes.length > 0 && (
          <div className="checkin-card__notes">
            <h3 className="checkin-card__notes-title">Notes</h3>
            <ul>
              {card.notes.map((n, i) => (
                <li key={`${n.created_at}-${i}`}>
                  {/* Viewer's own browser timezone, not the event's — matches Attendee Detail's
                   * Notes tab and fixes a note timestamp reading as wrong for anyone outside the
                   * event's own timezone (PO report). */}
                  <span className="checkin-card__note-meta">
                    {n.author_display} · {formatEventTime(n.created_at, getBrowserTimeZone())}
                  </span>
                  <p>{n.body}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 4. Secondary actions footer (mockup ci-result__actions). Close
            lives only here now, as a small ghost button next to Add note.
            PREVIEW previously had its own second, block-width Close button
            directly under Confirm check-in, which read as an oversized,
            visually-competing pair (PO review, round 3). */}
        {(showUndo || onAddNote || onCancel || showRevokeCheckIn) && (
          <div className="checkin-card__footer">
            {showUndo && onUndo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="checkin-card__aux-btn"
                disabled={!canAct || pending || undoGuard.ids.has("undo")}
                onClick={() => {
                  if (!undoGuard.start("undo")) return;
                  Promise.resolve(onUndo()).finally(() => undoGuard.finish("undo"));
                }}
                icon={<i className="ti ti-arrow-back-up" aria-hidden="true" />}
              >
                Undo check-in
              </Button>
            )}
            {showRevokeCheckIn && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="checkin-card__aux-btn checkin-card__aux-btn--danger"
                disabled={!canAct || pending}
                onClick={() => setRevokeOpen(true)}
                icon={<i className="ti ti-ban" aria-hidden="true" />}
              >
                Revoke check-in
              </Button>
            )}
            {onAddNote && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="checkin-card__aux-btn"
                disabled={!canAct || pending}
                onClick={() => setNoteOpen(true)}
                icon={<i className="ti ti-pencil" aria-hidden="true" />}
              >
                Add note
              </Button>
            )}
            {onCancel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="checkin-card__aux-btn"
                disabled={pending}
                onClick={() => onCancel()}
                icon={<i className="ti ti-x" aria-hidden="true" />}
              >
                Close
              </Button>
            )}
          </div>
        )}
      </Card>

      {onAddNote && (
        <NoteModal open={noteOpen} onClose={() => setNoteOpen(false)} onSubmit={onAddNote} />
      )}
      {onRevokeCheckIn && (
        <ConfirmDialog
          open={revokeOpen}
          title="Revoke check-in?"
          message={`This un-admits ${card.name}. They'll show as not checked in and will need to be scanned or admitted again to re-enter. This works regardless of when or how they were originally checked in.`}
          confirmLabel={revokeBusy ? "Revoking…" : "Revoke"}
          confirmVariant="danger"
          loading={revokeBusy}
          errorMessage={revokeError}
          onConfirm={() => void handleRevokeConfirm()}
          onCancel={() => {
            if (!revokeBusy) {
              setRevokeOpen(false);
              setRevokeError(null);
            }
          }}
        />
      )}
    </>
  );
}
