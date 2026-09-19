import { useId, useRef } from "react";
import { Button, ModalBackdrop } from "@admitto/ui";
import type { NotificationDto } from "../api/types.js";
import { formatUtcPrimaryTime } from "../utils/event-dates.js";
import { ActorOrViewerLocalTimeLine } from "./ActorOrViewerLocalTimeLine.js";
import { NOTIFICATION_SEVERITY_ICON } from "./notificationSeverity.js";
import { useModalFocusTrap } from "./useModalFocusTrap.js";
import "./confirm-dialog.css";

/**
 * The full text of one notification, opened by clicking its row in the topbar bell. The dropdown
 * row clamps the body to two lines so the list stays scannable, which cut off the part that
 * matters most (e.g. "If this wasn't you, secure your account immediately") - the whole message
 * lives here instead of being squeezed into the narrow panel.
 *
 * Reuses ConfirmDialog's overlay classes rather than the standard add-attendee-modal shell: that
 * one sits at z-index 300, below the bell's own dropdown panel (--z-dropdown: 1000) this is
 * always opened from, so it would render hidden behind it. The time renders the same way as
 * everywhere else in the staff UI (UTC on top, the viewer's local time beneath).
 */
export function NotificationDetailDialog({
  notification,
  onClose,
}: Readonly<{
  notification: NotificationDto | null;
  onClose: () => void;
}>) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, notification !== null, onClose);

  if (!notification) return null;

  return (
    <dialog open className="confirm-dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
      <ModalBackdrop onClose={onClose} />
      <div ref={panelRef} className="confirm-dialog__panel notif-detail__panel">
        <h3 id={titleId} className="confirm-dialog__title notif-detail__title">
          <span
            className={`status-circle status-circle--sm status-circle--${notification.severity}`}
            aria-hidden="true"
          >
            <i
              className={`ti ${NOTIFICATION_SEVERITY_ICON[notification.severity] ?? "ti-info-circle"}`}
              aria-hidden="true"
            />
          </span>
          {notification.title}
        </h3>
        <p id={bodyId} className="notif-detail__body">
          {notification.body}
        </p>
        <div>
          {formatUtcPrimaryTime(notification.created_at)}
          <ActorOrViewerLocalTimeLine iso={notification.created_at} actorTimezone={null} />
          {notification.organization_name && (
            <div className="sessions-subdued">Organisation: {notification.organization_name}</div>
          )}
        </div>
        <div className="confirm-dialog__actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
