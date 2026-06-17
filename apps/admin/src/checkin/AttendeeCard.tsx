import { Button, Card, StatusBadge } from "@admitto/ui";
import type { AttendeeCardDto, CheckInStatus } from "../api/types.js";

type Props = {
  card: AttendeeCardDto;
  scanStatus?: CheckInStatus;
  confirmed?: boolean;
  pending?: boolean;
  canAct: boolean;
  onCheckIn?: () => void;
  onItemAction?: (itemKey: string, targetState: string) => void;
  onAddNote?: (body: string) => void;
  onUndo?: () => void;
  showUndo?: boolean;
};

function itemActionLabel(key: string, action: string): string {
  if (action === "issued") {
    if (key === "headset") return "Issue headset";
    if (key === "giftbag") return "Give gift bag";
    if (key === "badge") return "Issue badge";
    if (key === "tshirt") return "Give T-shirt";
    return `Mark ${key} issued`;
  }
  if (action === "returned" && key === "headset") return "Return headset";
  return `${action} ${key}`;
}

export function AttendeeCard({
  card,
  scanStatus,
  confirmed,
  pending,
  canAct,
  onCheckIn,
  onItemAction,
  onAddNote,
  onUndo,
  showUndo,
}: Props) {
  const statusForBadge =
    scanStatus ??
    (card.check_in_status === "admitted" ? "ALREADY_CHECKED_IN" : "INVALID");

  return (
    <Card className={`checkin-card checkin-card--${statusForBadge.toLowerCase()}`} aria-live="polite">
      <div className="checkin-card__header">
        <StatusBadge status={pending ? "INVALID" : statusForBadge} />
        {pending && <span className="checkin-card__pending">Pending — not confirmed</span>}
        {scanStatus === "PREVIEW" && !pending && (
          <span className="checkin-card__pending">Confirm check-in required</span>
        )}
        {card.ticket_type && <span className="checkin-card__ticket">{card.ticket_type}</span>}
      </div>

      <h2 className="checkin-card__name">{card.name}</h2>

      {(card.company || card.department) && (
        <p className="checkin-card__meta">
          {[card.company, card.department].filter(Boolean).join(" · ")}
        </p>
      )}

      {card.shirt_size && <p className="checkin-card__meta">Shirt: {card.shirt_size}</p>}

      {card.warnings.map((w) => (
        <p key={w} className="checkin-card__warning" role="alert">
          {w}
        </p>
      ))}

      <div className="checkin-card__items">
        {card.items.map((item) => (
          <div key={item.key} className="checkin-card__item-row">
            <span className="checkin-card__item-label">
              {item.label}: <strong>{item.state}</strong>
            </span>
            <div className="checkin-card__item-actions">
              {item.actions.map((action) => (
                <button
                  key={`${item.key}-${action}`}
                  type="button"
                  className="checkin-action-btn"
                  disabled={!canAct || pending}
                  onClick={() => onItemAction?.(item.key, action)}
                >
                  {itemActionLabel(item.key, action)}
                </button>
              ))}
            </div>
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
                  {n.author_display} · {new Date(n.created_at).toLocaleTimeString()}
                </span>
                <p>{n.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="checkin-card__footer">
        {onCheckIn && card.check_in_status === "not_admitted" && (
          <Button
            type="button"
            disabled={!canAct || pending}
            onClick={onCheckIn}
            className="checkin-action-btn checkin-action-btn--primary"
          >
            Check in
          </Button>
        )}
        {showUndo && onUndo && (
          <button type="button" className="checkin-action-btn" disabled={!canAct || pending} onClick={onUndo}>
            Undo last check-in
          </button>
        )}
        {onAddNote && (
          <button
            type="button"
            className="checkin-action-btn"
            disabled={!canAct || pending}
            onClick={() => {
              const body = window.prompt("Add note (max 2000 chars):");
              if (body?.trim()) onAddNote(body.trim());
            }}
          >
            Add note
          </button>
        )}
        {confirmed === false &&
          scanStatus !== "PREVIEW" &&
          scanStatus !== "INVALID" &&
          scanStatus !== "REVOKED" && (
          <span className="checkin-card__meta">Awaiting server confirmation</span>
        )}
      </div>
    </Card>
  );
}
