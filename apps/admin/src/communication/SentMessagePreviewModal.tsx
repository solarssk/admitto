import { useEffect, useRef, useState } from "react";
import { Button, IconButton, ModalBackdrop } from "@admitto/ui";
import { fetchRenderedDelivery } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { DeliveryDto, RenderedDeliveryDto } from "../api/types.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import "./delivery-modals.css";

export interface SentMessagePreviewModalProps {
  eventId: string;
  row: DeliveryDto;
  onClose: () => void;
}

/** Read-only preview of a sent message's rendered content, fetched fresh from the redacted
 * `/rendered` endpoint (see communication-api-routes.ts handleGetRenderedEventDelivery), which
 * replaces `{{qr_image_url}}`/`{{ticket_url}}` tokens with a safe placeholder server-side - the
 * recipient's real QR code and working ticket link are never fetched or rendered here. */
export function SentMessagePreviewModal({ eventId, row, onClose }: Readonly<SentMessagePreviewModalProps>) {
  const [rendered, setRendered] = useState<RenderedDeliveryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Subject/iframe don't exist in the DOM until the fetch resolves - retry initial focus once
  // `loading` flips to false (IdentityProviderEditor's loadState convention).
  useModalFocusTrap(panelRef, true, onClose, loading);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchRenderedDelivery(eventId, row.id, controller.signal)
      .then((data) => setRendered(data))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(operatorApiErrorMessage(err, "Failed to load the sent message."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [eventId, row.id]);

  return (
    <dialog open className="delivery-modal" aria-modal="true" aria-labelledby="sent-message-modal-title">
      <ModalBackdrop onClose={onClose} />
      <div ref={panelRef} className="delivery-modal__panel delivery-modal__panel--wide">
        <div className="delivery-modal__header">
          <div>
            <h2 id="sent-message-modal-title" className="delivery-modal__title">
              Sent message preview
            </h2>
            <p className="delivery-modal__subtitle">
              {row.attendee_name} · {row.recipient_email ?? "no email on file"}
            </p>
          </div>
          <IconButton label="Close" onClick={onClose} icon={<i className="ti ti-x" aria-hidden="true" />} />
        </div>
        <div className="delivery-modal__body">
          <div className="delivery-modal-notice">
            <i className="ti ti-qrcode-off" aria-hidden="true" />
            <span>
              The QR code and ticket link are hidden here for privacy. The recipient&apos;s actual
              copy includes the real ones.
            </span>
          </div>
          {loading && <div className="delivery-modal__loading">Loading message…</div>}
          {!loading && error && <div className="delivery-modal__error">{error}</div>}
          {!loading && !error && !rendered?.html && (
            <div className="delivery-modal__loading">
              This message&apos;s stored content is no longer available.
            </div>
          )}
          {!loading && !error && rendered?.html && (
            <>
              <div className="delivery-modal-preview-subject">
                <strong>Subject</strong>
                <span>{rendered.subject}</span>
              </div>
              <iframe
                className="delivery-modal-preview-frame"
                title="Sent message preview"
                sandbox=""
                srcDoc={rendered.html}
              />
            </>
          )}
        </div>
        <div className="delivery-modal__footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
