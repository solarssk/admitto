import { useEffect, useRef, useState } from "react";
import { IconButton, ModalBackdrop, Skeleton } from "@admitto/ui";
import { fetchRenderedDelivery } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { DeliveryDto, RenderedDeliveryDto } from "../api/types.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { makeEmailPreviewInert } from "./inertEmailPreview.js";
import "./delivery-modals.css";

export interface SentMessagePreviewModalProps {
  eventId: string;
  row: DeliveryDto;
  onClose: () => void;
}

/** Read-only preview of a sent message's rendered content, fetched fresh from the `/rendered`
 * endpoint (see communication-api-routes.ts handleGetRenderedEventDelivery), with the
 * recipient's real ticket link and QR code materialized in - same admin/superadmin access as
 * "Copy ticket link", which already exposes the same ticket_url. */
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
        <div className="delivery-modal__scroll">
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
            {loading && (
              <div className="delivery-modal-skeleton-group" aria-live="polite" aria-busy="true">
                <span className="sr-only">Loading message…</span>
                <Skeleton variant="text" lines={2} width="50%" />
                <Skeleton variant="rect" height={320} className="delivery-modal-skeleton-frame" />
              </div>
            )}
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
                  srcDoc={makeEmailPreviewInert(rendered.html)}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
