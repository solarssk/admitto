import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button, IconButton, ModalBackdrop, Notice, Skeleton, StatusBadge } from "@admitto/ui";
import { fetchEventDelivery } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { DeliveryDetailDto, DeliveryDto } from "../api/types.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { formatDeliveryHistoryTime, purposeLabel, rowTimestamp, templateLabel } from "./delivery-format.js";
import "./delivery-modals.css";

export interface DeliveryDetailsModalProps {
  eventId: string;
  /** Event IANA zone - fallback when a delivery row has no client_timezone. */
  eventTimezone: string;
  row: DeliveryDto;
  onClose: () => void;
  onViewSentMessage: (row: DeliveryDto) => void;
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Label a timeline step from its own recorded purpose (not its position) - a named custom
 * template can still be the attendee's first send, and resolveNoDeliveryScopeAndPurpose records
 * that as purpose "resend" (see toDeliveryDto.ts), so the oldest row isn't reliably "initial". */
function timelineStepLabel(timeline: DeliveryDto[], index: number): string {
  if (timeline[index]?.purpose !== "resend") return "Initial send";
  const resendNumber = timeline.slice(0, index + 1).filter((d) => d.purpose === "resend").length;
  return `Resend ${resendNumber}`;
}

function deliveryDetailTime(
  iso: string | null,
  clientTimezone: string | null | undefined,
  eventTimezone: string,
): string {
  return formatDeliveryHistoryTime(iso, clientTimezone, eventTimezone);
}

function timelineItemTime(item: DeliveryDto, eventTimezone: string): string {
  return deliveryDetailTime(rowTimestamp(item), item.client_timezone, eventTimezone);
}

/** "-" when unknown (not yet failed, or a status this app never retries), else Yes/No. */
function retryableLabel(retryable: boolean | null): string {
  if (retryable == null) return "-";
  return retryable ? "Yes" : "No";
}

/** Plain-text dump for the "Export as .txt" footer action - real captured fields only, no
 * fabricated provider transcript (plan.md's load-bearing constraint: no Postmark integration
 * exists, so nothing like a fake SMTP transcript is invented here). */
function buildExportText(detail: DeliveryDetailDto, eventTimezone: string): string {
  const lines = [
    "Admitto delivery details",
    "========================",
    `Delivery ID: ${detail.id}`,
    `Recipient: ${detail.attendee_name} <${detail.recipient_email ?? "no email on file"}>`,
    `Attendee ID: ${detail.attendee_id}`,
    `Template: ${templateLabel(detail)}`,
    `Purpose: ${purposeLabel(detail.purpose)}`,
    `Status: ${detail.status}`,
    `Provider: ${detail.provider}`,
    `Provider message ID: ${detail.provider_message_id ?? "-"}`,
    `Attempts: ${detail.attempts}`,
    `Retryable: ${retryableLabel(detail.retryable)}`,
    `Queued at: ${deliveryDetailTime(detail.queued_at, detail.client_timezone, eventTimezone)}`,
    `Accepted at: ${deliveryDetailTime(detail.accepted_at, detail.client_timezone, eventTimezone)}`,
    `Sent at: ${deliveryDetailTime(detail.sent_at, detail.client_timezone, eventTimezone)}`,
    `Failed at: ${deliveryDetailTime(detail.failed_at, detail.client_timezone, eventTimezone)}`,
    `Error code: ${detail.error_code ?? "-"}`,
    `Error: ${detail.error ?? "-"}`,
    `Sent by: ${detail.actor_display ?? "System"}`,
    `Batch ID: ${detail.batch_id ?? "-"}`,
    `Session ID: ${detail.session_id ?? "-"}`,
    `Client timezone: ${detail.client_timezone ?? "-"}`,
    "",
    "Delivery timeline",
    "------------------",
    ...detail.timeline.map((item, index) => {
      const errorSuffix = item.error ? ` - ${item.error}` : "";
      return `${timelineStepLabel(detail.timeline, index)}: ${item.status} (${timelineItemTime(item, eventTimezone)})${errorSuffix}`;
    }),
  ];
  return lines.join("\n");
}

/** Full delivery diagnostics: recipient/template/provider/attempts, an honest timeline built
 * from sibling deliveries for the same attendee (no per-attempt event table exists - every
 * resend is instead its own separate row, see plan.md), and the row's raw fields. */
export function DeliveryDetailsModal({
  eventId,
  eventTimezone,
  row,
  onClose,
  onViewSentMessage,
}: Readonly<DeliveryDetailsModalProps>) {
  const [detail, setDetail] = useState<DeliveryDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The overview/timeline sections don't exist in the DOM until the fetch resolves - retry
  // initial focus once `loading` flips to false.
  useModalFocusTrap(panelRef, true, onClose, loading);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchEventDelivery(eventId, row.id, controller.signal)
      .then((data) => setDetail(data))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(operatorApiErrorMessage(err, "Failed to load delivery details."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [eventId, row.id]);

  return (
    <dialog open className="delivery-modal" aria-modal="true" aria-labelledby="delivery-details-modal-title">
      <ModalBackdrop onClose={onClose} />
      <div ref={panelRef} className="delivery-modal__panel delivery-modal__panel--wide">
        <div className="delivery-modal__header">
          <div>
            <h2 id="delivery-details-modal-title" className="delivery-modal__title">
              Delivery details
            </h2>
            <p className="delivery-modal__subtitle">
              {row.attendee_name} · {row.recipient_email ?? "no email on file"}
            </p>
          </div>
          <IconButton label="Close" onClick={onClose} icon={<i className="ti ti-x" aria-hidden="true" />} />
        </div>
        <div className="delivery-modal__body">
          {loading && (
            // Roughly mirrors the loaded Overview/Timeline/Raw fields sections below, so the
            // swap from loading to loaded doesn't visibly jump in height.
            <div className="delivery-modal-skeleton-group" aria-live="polite" aria-busy="true">
              <span className="sr-only">Loading delivery details…</span>
              <div className="delivery-modal-skeleton-section">
                <Skeleton variant="text" width="30%" />
                <Skeleton variant="rect" height={220} />
              </div>
              <div className="delivery-modal-skeleton-section">
                <Skeleton variant="text" width="30%" />
                <Skeleton variant="rect" height={120} />
              </div>
              <div className="delivery-modal-skeleton-section">
                <Skeleton variant="text" width="30%" />
                <Skeleton variant="rect" height={140} />
              </div>
            </div>
          )}
          {!loading && error && <div className="delivery-modal__error">{error}</div>}
          {!loading && !error && detail && (
            <>
              <div>
                <h3 className="delivery-modal__section-title">Overview</h3>
                <dl className="delivery-modal-kv">
                  <div>
                    <dt>Template</dt>
                    <dd>{templateLabel(detail)}</dd>
                  </div>
                  <div>
                    <dt>Purpose</dt>
                    <dd>{purposeLabel(detail.purpose)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <StatusBadge status={detail.status} />
                    </dd>
                  </div>
                  <div>
                    <dt>Attempts</dt>
                    <dd>{detail.attempts}</dd>
                  </div>
                  <div>
                    <dt>Provider</dt>
                    <dd>{detail.provider}</dd>
                  </div>
                  <div>
                    <dt>Provider message ID</dt>
                    <dd className="mono">{detail.provider_message_id ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Queued at</dt>
                    <dd>{deliveryDetailTime(detail.queued_at, detail.client_timezone, eventTimezone)}</dd>
                  </div>
                  <div>
                    <dt>Accepted at</dt>
                    <dd>{deliveryDetailTime(detail.accepted_at, detail.client_timezone, eventTimezone)}</dd>
                  </div>
                  <div>
                    <dt>Sent at</dt>
                    <dd>{deliveryDetailTime(detail.sent_at, detail.client_timezone, eventTimezone)}</dd>
                  </div>
                  <div>
                    <dt>Failed at</dt>
                    <dd>{deliveryDetailTime(detail.failed_at, detail.client_timezone, eventTimezone)}</dd>
                  </div>
                  <div>
                    <dt>Sent by</dt>
                    <dd>{detail.actor_display ?? "System"}</dd>
                  </div>
                  <div>
                    <dt>Retryable</dt>
                    <dd>{retryableLabel(detail.retryable)}</dd>
                  </div>
                </dl>
                {detail.error && (
                  <Notice variant="error" role="alert">
                    {detail.error}
                  </Notice>
                )}
              </div>

              <div>
                <h3 className="delivery-modal__section-title">Delivery timeline</h3>
                <ol className="delivery-modal-timeline">
                  {detail.timeline.map((item, index) => (
                    <li
                      key={item.id}
                      className={
                        item.id === detail.id
                          ? "delivery-modal-timeline__item delivery-modal-timeline__item--current"
                          : "delivery-modal-timeline__item"
                      }
                    >
                      <div className="delivery-modal-timeline__meta">
                        <strong>{timelineStepLabel(detail.timeline, index)}</strong>
                        <StatusBadge status={item.status} />
                      </div>
                      <span className="delivery-modal-timeline__time">
                        {timelineItemTime(item, eventTimezone)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <h3 className="delivery-modal__section-title">Raw fields</h3>
                <dl className="delivery-modal-kv">
                  <div>
                    <dt>Delivery ID</dt>
                    <dd className="mono">{detail.id}</dd>
                  </div>
                  <div>
                    <dt>Attendee ID</dt>
                    <dd className="mono">{detail.attendee_id}</dd>
                  </div>
                  <div>
                    <dt>Error code</dt>
                    <dd className="mono">{detail.error_code ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Batch ID</dt>
                    <dd className="mono">{detail.batch_id ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Session ID</dt>
                    <dd className="mono">{detail.session_id ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Client timezone</dt>
                    <dd>{detail.client_timezone ?? "-"}</dd>
                  </div>
                </dl>
              </div>
            </>
          )}
        </div>
        <div className="delivery-modal__footer">
          {detail && (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                downloadTextFile(`delivery-${detail.id}.txt`, buildExportText(detail, eventTimezone))
              }
            >
              Export as .txt
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => onViewSentMessage(row)}>
            View sent message
          </Button>
          <Link
            className="at-btn at-btn--secondary"
            to={`/admin/events/${eventId}/attendees/${row.attendee_id}`}
            onClick={onClose}
          >
            Open attendee
          </Link>
        </div>
      </div>
    </dialog>
  );
}
