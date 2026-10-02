import { useRef, useState } from "react";
import { Button, IconButton, ModalBackdrop, Notice } from "@admitto/ui";
import { fetchRenderedDelivery } from "../api/client.js";
import type { DeliveryDto, RenderedDeliveryDto } from "../api/types.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
import { panelView, usePanelLoad } from "../hooks/usePanelLoad.js";
import { SentMessageSkeleton } from "./DeliveryModalSkeleton.js";
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
 * "Copy ticket link", which already exposes the same ticket_url.
 *
 * It reads the message it was opened for once: another delivery is a fresh modal (`key`), so its load never has to
 * follow a changing prop. */
export function SentMessagePreviewModal(props: Readonly<SentMessagePreviewModalProps>) {
  return <SentMessagePreviewModalBody key={`${props.eventId}/${props.row.id}`} {...props} />;
}

function SentMessagePreviewModalBody({ eventId, row, onClose }: Readonly<SentMessagePreviewModalProps>) {
  const [rendered, setRendered] = useState<RenderedDeliveryDto | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The first load: nothing is drawn for 200ms, then the shape of the message, an error with a busy Retry after a
  // failure (or 30 seconds without an answer).
  const panel = usePanelLoad({
    fetch: (signal) => fetchRenderedDelivery(eventId, row.id, signal),
    apply: setRendered,
    fallback: "Could not load the sent message.",
  });
  const view = panelView(panel);
  useModalFocusTrap(panelRef, true, onClose);
  useOverscrollBounceGuard(scrollRef);

  return (
    <dialog open className="delivery-modal" aria-modal="true" aria-labelledby="sent-message-modal-title">
      <ModalBackdrop onClose={onClose} />
      <div ref={panelRef} className="delivery-modal__panel delivery-modal__panel--wide">
        <div ref={scrollRef} className="delivery-modal__scroll">
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
            {view === "loading" && <SentMessageSkeleton held={!panel.gate.showIndicator} slow={panel.slow} />}
            {view === "error" && (
              <Notice
                variant="error"
                role="alert"
                actionBusy={panel.retrying}
                action={
                  <Button type="button" variant="secondary" size="sm" loading={panel.retrying} onClick={() => void panel.retry()}>
                    Retry
                  </Button>
                }
              >
                {panel.error}
              </Notice>
            )}
            {view === "ready" && !rendered?.html && (
              <Notice variant="info">This message&apos;s stored content is no longer available.</Notice>
            )}
            {view === "ready" && rendered?.html && (
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
