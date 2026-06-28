import { useState } from "react";
import { Button, Card } from "@admitto/ui";
import type { AttendeeCardDto, CheckInStatus } from "../api/types.js";
import { formatEventTime } from "../utils/event-dates.js";
import { NoteModal } from "./NoteModal.js";

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

function itemStripClass(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized === "issued") return "ck-item-strip--issued";
  if (normalized === "returned") return "ck-item-strip--returned";
  return "ck-item-strip--pending";
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
}: Props) {
  const resolvedStatus = statusForCard(scanStatus, card.check_in_status);
  const cardClass = `checkin-card checkin-card--${resolvedStatus.toLowerCase()}`;
  const isPreview = resolvedStatus === "PREVIEW";
  const [noteOpen, setNoteOpen] = useState(false);

  return (
    <>
      <Card className={cardClass} aria-live="polite">
        <div className="checkin-card__header">
          <i className={`ti ${statusIcon(resolvedStatus)} checkin-card__status-icon`} aria-hidden="true" />
          <span className="checkin-card__status-title">{statusTitle(resolvedStatus)}</span>
          {pending && <span className="checkin-card__pending">Pending — not confirmed</span>}
          {card.ticket_type && <span className="checkin-card__ticket">{card.ticket_type}</span>}
        </div>

        {(card.company || card.department) && (
          <p className="checkin-card__meta">
            {[card.company, card.department].filter(Boolean).join(" · ")}
          </p>
        )}

        <h2 className="checkin-card__name">{card.name}</h2>

        {card.warnings.map((w, i) => (
          <p key={`warning-${i}`} className="checkin-card__warning" role="alert">
            {w}
          </p>
        ))}

        <div className="checkin-card__items">
          {card.items.map((item) => (
            <div key={item.key} className="checkin-card__item-row">
              <span className="checkin-card__item-label">{item.label}</span>
              {item.actions.length > 0 ? (
                <div className="checkin-card__item-actions">
                  {item.actions.map((action) => (
                    <button
                      key={`${item.key}-${action}`}
                      type="button"
                      className="checkin-action-btn checkin-action-btn--sm"
                      disabled={!canAct || pending}
                      onClick={() => onItemAction?.(item.key, action)}
                    >
                      {itemActionLabel(item.key, action)}
                    </button>
                  ))}
                </div>
              ) : (
                <div className={`ck-item-strip ${itemStripClass(item.state)}`}>
                  <span>{item.state}</span>
                  {item.detail && <span className="checkin-card__item-detail"> ({item.detail})</span>}
                </div>
              )}
            </div>
          ))}
        </div>

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

        {isPreview && onCheckIn && card.check_in_status === "not_admitted" && (
          <div className="checkin-card__preview-actions">
            <Button
              type="button"
              variant="primary"
              size="lg"
              disabled={!canAct || pending}
              onClick={onCheckIn}
              className="checkin-action-btn--block"
            >
              Confirm check-in
            </Button>
            <button
              type="button"
              className="link-btn"
              disabled={pending}
              onClick={() => onCancel?.()}
            >
              Cancel
            </button>
          </div>
        )}

        {confirmed === false &&
          !isPreview &&
          resolvedStatus !== "INVALID" &&
          resolvedStatus !== "REVOKED" && (
            <span className="checkin-card__meta">Awaiting server confirmation</span>
          )}
      </Card>

      {(showUndo || onAddNote) && (
        <div className="ck-result-actions">
          {showUndo && onUndo && (
            <button
              type="button"
              className="link-btn"
              disabled={!canAct || pending}
              onClick={onUndo}
            >
              ↩ Undo last check-in
            </button>
          )}
          {onAddNote && (
            <button
              type="button"
              className="link-btn"
              disabled={!canAct || pending}
              onClick={() => setNoteOpen(true)}
            >
              ✏ Add note
            </button>
          )}
        </div>
      )}

      {onAddNote && (
        <NoteModal open={noteOpen} onClose={() => setNoteOpen(false)} onSubmit={onAddNote} />
      )}
    </>
  );
}
