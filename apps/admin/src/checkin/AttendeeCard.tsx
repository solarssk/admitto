import { useState } from "react";
import { Badge, Button, Card } from "@admitto/ui";
import type { BadgeVariant } from "@admitto/ui";
import type { AttendeeCardDto, CheckInStatus } from "../api/types.js";
import { formatEventTime } from "../utils/event-dates.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { NoteModal } from "./NoteModal.js";
import { TicketTypeBadge } from "../attendees/ticketTypeBadge.js";

type Props = {
  card: AttendeeCardDto;
  eventTimezone: string;
  scanStatus?: CheckInStatus;
  confirmed?: boolean;
  pending?: boolean;
  canAct: boolean;
  onCheckIn?: () => void;
  onItemAction?: (itemKey: string, targetState: string) => void;
  onAddNote?: (body: string) => Promise<void>;
  onUndo?: () => void;
  showUndo?: boolean;
  onCancel?: () => void;
  /** Admin/superadmin only — reverses this attendee's current admission regardless of who checked them in or when. Rejects on failure so this component can show the error inline. */
  onRevokeCheckIn?: () => Promise<void>;
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

function itemActionLabel(key: string, action: string): string {
  if (action === "issued") {
    if (key === "headset") return "Issue headset";
    if (key === "giftbag") return "Give gift bag";
    if (key === "badge") return "Issue badge";
    return `Mark ${key} issued`;
  }
  if (action === "returned" && key === "headset") return "Return headset";
  return `${action} ${key}`;
}

function itemBadgeVariant(state: string): BadgeVariant {
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

function statusDisplayMode(status: CheckInStatus): "inline" | "strip" | "alert" {
  switch (status) {
    case "VALID":
    case "PREVIEW":
      return "inline";
    case "ALREADY_CHECKED_IN":
      return "strip";
    case "REVOKED":
    case "INVALID":
    default:
      return "alert";
  }
}

export function AttendeeCard({
  card,
  eventTimezone,
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
}: Props) {
  const resolvedStatus = statusForCard(scanStatus, card.check_in_status);
  const cardClass = `checkin-card checkin-card--${resolvedStatus.toLowerCase()}`;
  const isPreview = resolvedStatus === "PREVIEW";
  const [noteOpen, setNoteOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  async function handleRevokeConfirm() {
    if (!onRevokeCheckIn) return;
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      await onRevokeCheckIn();
      setRevokeOpen(false);
    } catch {
      setRevokeError("Failed to revoke check-in. Try again.");
    } finally {
      setRevokeBusy(false);
    }
  }

  const showPrimaryActions = isPreview && onCheckIn && card.check_in_status === "not_admitted";
  const statusVariant = statusBadgeVariant(resolvedStatus);
  const displayMode = statusDisplayMode(resolvedStatus);
  const remainingWarnings = displayMode === "alert" ? card.warnings.slice(1) : card.warnings;
  const hasTransientNote =
    pending ||
    (confirmed === false &&
      !isPreview &&
      resolvedStatus !== "INVALID" &&
      resolvedStatus !== "REVOKED");

  return (
    <>
      <Card className={cardClass} padded={false} aria-live="polite">
        {/* 1. Head (mockup ci-result__head): round tinted status icon +
            identity block — name first, ticket/company meta beneath it. */}
        <div className="checkin-card__head">
          <div className={`checkin-card__status-icon checkin-card__status-icon--${statusVariant}`}>
            <i className={`ti ${statusIcon(resolvedStatus)}`} aria-hidden="true" />
          </div>
          <div className="checkin-card__identity">
            <h2 className="checkin-card__name">{card.name}</h2>
            <div className="checkin-card__meta">
              {card.ticket_type && <TicketTypeBadge ticketType={card.ticket_type} />}
              {displayMode === "inline" && (
                <Badge variant={statusVariant} dot>
                  {statusTitle(resolvedStatus)}
                </Badge>
              )}
              {(card.company || card.department) && (
                <span>{[card.company, card.department].filter(Boolean).join(" · ")}</span>
              )}
            </div>
          </div>
        </div>

        {/* Status strip: skipped for positive states unless there's a transient note.
            Warning states get a subtle hairline strip; error states get a tinted alert row
            that also absorbs the warnings list so badge + reason stay in one block. */}
        {(displayMode !== "inline" || hasTransientNote) && (
          <div className={`checkin-card__status checkin-card__status--${displayMode}`}>
            {displayMode === "alert" ? (
              <p className="checkin-card__alert-message">
                {statusTitle(resolvedStatus)}
                {card.warnings[0] && (
                  <span className="checkin-card__alert-reason"> — {card.warnings[0]}</span>
                )}
              </p>
            ) : displayMode !== "inline" ? (
              <Badge variant={statusVariant} dot>
                {statusTitle(resolvedStatus)}
              </Badge>
            ) : null}
            {pending && <span className="checkin-card__status-note">Pending — not confirmed</span>}
            {confirmed === false && !pending && !isPreview && resolvedStatus !== "INVALID" && resolvedStatus !== "REVOKED" && (
              <span className="checkin-card__status-note">Awaiting server confirmation</span>
            )}
          </div>
        )}

        {remainingWarnings.length > 0 && (
          <div className="checkin-card__warnings">
            {remainingWarnings.map((w, i) => (
              <p key={`warning-${i}`} className="checkin-card__warning" role="alert">
                {w}
              </p>
            ))}
          </div>
        )}

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
            <Button
              type="button"
              variant="secondary"
              block
              className="checkin-card__aux-btn"
              disabled={pending}
              onClick={() => onCancel?.()}
            >
              Clear
            </Button>
          </div>
        )}

        {/* 3. Requirements (mockup ci-result__items): compact rows — icon,
            label (flex), then state chip or inline action at the right edge. */}
        {card.items.length > 0 && (
          <div className="checkin-card__items">
            {card.items.map((item) => (
              <div key={item.key} className="checkin-card__item-row">
                <i
                  className={`ti ti-${item.icon ?? "package"} checkin-card__item-icon`}
                  aria-hidden="true"
                />
                <span className="checkin-card__item-label">
                  {item.label}
                  {item.detail && <span className="checkin-card__item-detail">{item.detail}</span>}
                </span>
                {item.actions.length > 0 ? (
                  item.actions.map((action) => (
                    <button
                      key={`${item.key}-${action}`}
                      type="button"
                      className="checkin-card__item-action"
                      disabled={!canAct || pending || displayMode === "alert"}
                      onClick={() => onItemAction?.(item.key, action)}
                    >
                      {itemActionLabel(item.key, action)}
                    </button>
                  ))
                ) : (
                  <Badge variant={itemBadgeVariant(item.state)} className="checkin-card__item-badge">
                    {item.state}
                  </Badge>
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
                  <span className="checkin-card__note-meta">
                    {n.author_display} · {formatEventTime(n.created_at, eventTimezone)}
                  </span>
                  <p>{n.body}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 4. Secondary actions footer (mockup ci-result__actions). Clear is
            omitted when showPrimaryActions is true — PREVIEW already has its
            own block-width Cancel button, so this only appears for states
            (VALID / ALREADY_CHECKED_IN / REVOKED) that otherwise have no way
            to dismiss the card short of Escape or scanning someone else. */}
        {(showUndo ||
          onAddNote ||
          (onCancel && !showPrimaryActions) ||
          (onRevokeCheckIn && card.check_in_status === "admitted")) && (
          <div className="checkin-card__footer">
            {showUndo && onUndo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="checkin-card__aux-btn"
                disabled={!canAct || pending}
                onClick={onUndo}
                icon={<i className="ti ti-arrow-back-up" aria-hidden="true" />}
              >
                Undo check-in
              </Button>
            )}
            {onRevokeCheckIn && card.check_in_status === "admitted" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="checkin-card__aux-btn checkin-card__aux-btn--danger"
                disabled={pending}
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
            {onCancel && !showPrimaryActions && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="checkin-card__aux-btn"
                disabled={pending}
                onClick={() => onCancel()}
                icon={<i className="ti ti-x" aria-hidden="true" />}
              >
                Clear
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
          message={`This un-admits ${card.name} — they'll show as not checked in and will need to be scanned or admitted again to re-enter. This works regardless of when or how they were originally checked in.`}
          confirmLabel={revokeBusy ? "Revoking…" : "Revoke check-in"}
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
