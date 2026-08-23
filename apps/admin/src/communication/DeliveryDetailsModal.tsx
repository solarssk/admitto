import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button, HintLabel, IconButton, ModalBackdrop, Notice, Skeleton, StatusBadge } from "@admitto/ui";
import { fetchEventDelivery } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { DeliveryDetailDto, DeliveryDto } from "../api/types.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { describeSmtpBounceCode } from "../utils/smtpBounceCodes.js";
import { formatDeliveryHistoryTime, purposeLabel, rowTimestamp, templateLabel } from "./delivery-format.js";
import "./delivery-modals.css";

const SENT_AT_HINT =
  "Confirmed only when the receiving mail server reports final delivery. Most providers (including SMTP and Microsoft Graph) only confirm that they accepted the message for delivery, so this is usually blank; Accepted at is the reliable timestamp.";
const BATCH_ID_HINT =
  "Groups every recipient of the same send/resend action together. Blank for actions that only ever affect one recipient, like this one.";
const SESSION_ID_HINT = "The admin's login session at the moment this was sent, for support lookups.";
const CLIENT_TIMEZONE_HINT =
  "The sending admin's browser timezone at the moment this was sent, used to show times below in the right zone.";

export interface DeliveryDetailsModalProps {
  eventId: string;
  /** Event IANA zone - fallback when a delivery row has no client_timezone. */
  eventTimezone: string;
  row: DeliveryDto;
  onClose: () => void;
  onViewSentMessage: (row: DeliveryDto) => void;
  /** Hide when the modal is already opened from that attendee's page (default true). */
  showOpenAttendee?: boolean;
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
 * that as purpose "resend" (see toDeliveryDto.ts), so the oldest row isn't reliably "initial".
 * Used only by the .txt export; the modal itself no longer shows a timeline (Delivery history
 * on the attendee page already lists every attempt). */
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

/**
 * Operator-facing failure summary for the Overview notice.
 * Bounce NDRs often store a long, unreadable dump (HTML entities, confidentiality
 * disclaimers) in `error` - never put that in the UI. Prefer the SMTP code + plain-English
 * glossary; fall back to a short transport error only when it is not a Bounce dump.
 */
function deliveryErrorNoticeContent(detail: DeliveryDetailDto): ReactNode | null {
  const meaning = describeSmtpBounceCode(detail.error_code);
  if (detail.error_code && meaning) {
    return (
      <>
        <span className="mono">{detail.error_code}</span>
        {`. ${meaning}`}
      </>
    );
  }
  const shortError =
    detail.error && !detail.error.startsWith("Bounce ") ? detail.error : null;
  if (detail.error_code && shortError) {
    return (
      <>
        <span className="mono">{detail.error_code}</span>
        {`. ${shortError}`}
      </>
    );
  }
  if (detail.error_code) {
    return <span className="mono">{detail.error_code}</span>;
  }
  if (shortError) return shortError;
  return null;
}

/** Green Overview notice for a successful handoff (accepted / sent / delivered). Mirrors the
 * red failure notice so the modal always has a clear outcome line under the Overview grid. */
function deliverySuccessNoticeContent(detail: DeliveryDetailDto): string | null {
  if (detail.status === "accepted" || detail.status === "sent" || detail.status === "delivered") {
    return "The mail provider accepted this message for delivery.";
  }
  return null;
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

/** Full delivery diagnostics: recipient/template/provider/attempts and the row's raw fields.
 * Sibling resends stay on Delivery history (attendee page / Communication log), not here -
 * listing every attempt in this modal made the popup grow without bound. */
export function DeliveryDetailsModal({
  eventId,
  eventTimezone,
  row,
  onClose,
  onViewSentMessage,
  showOpenAttendee = true,
}: Readonly<DeliveryDetailsModalProps>) {
  const [detail, setDetail] = useState<DeliveryDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The overview/raw-fields sections don't exist in the DOM until the fetch resolves - retry
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

  const errorNotice = detail ? deliveryErrorNoticeContent(detail) : null;
  const successNotice =
    detail && !errorNotice ? deliverySuccessNoticeContent(detail) : null;

  return (
    <dialog open className="delivery-modal" aria-modal="true" aria-labelledby="delivery-details-modal-title">
      <ModalBackdrop onClose={onClose} />
      <div ref={panelRef} className="delivery-modal__panel delivery-modal__panel--wide">
        <div className="delivery-modal__scroll">
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
              // Roughly mirrors the loaded Overview/Raw fields sections below, so the
              // swap from loading to loaded doesn't visibly jump in height.
              <div className="delivery-modal-skeleton-group" aria-live="polite" aria-busy="true">
                <span className="sr-only">Loading delivery details…</span>
                <div className="delivery-modal-skeleton-section">
                  <Skeleton variant="text" width="30%" />
                  <Skeleton variant="rect" height={220} />
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
                      <dt>
                        <HintLabel hint={SENT_AT_HINT}>Sent at</HintLabel>
                      </dt>
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
                  {errorNotice && (
                    <Notice variant="error" role="alert" className="delivery-modal-status-notice">
                      {errorNotice}
                    </Notice>
                  )}
                  {successNotice && (
                    <Notice variant="success" role="status" className="delivery-modal-status-notice">
                      {successNotice}
                    </Notice>
                  )}
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
                      <dt>
                        <HintLabel hint={BATCH_ID_HINT}>Batch ID</HintLabel>
                      </dt>
                      <dd className="mono">{detail.batch_id ?? "-"}</dd>
                    </div>
                    <div>
                      <dt>
                        <HintLabel hint={SESSION_ID_HINT}>Session ID</HintLabel>
                      </dt>
                      <dd className="mono">{detail.session_id ?? "-"}</dd>
                    </div>
                    <div>
                      <dt>
                        <HintLabel hint={CLIENT_TIMEZONE_HINT}>Client timezone</HintLabel>
                      </dt>
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
                icon={<i className="ti ti-download" aria-hidden="true" />}
                onClick={() =>
                  downloadTextFile(`delivery-${detail.id}.txt`, buildExportText(detail, eventTimezone))
                }
              >
                Export as .txt
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              icon={<i className="ti ti-mail" aria-hidden="true" />}
              onClick={() => onViewSentMessage(row)}
            >
              View sent message
            </Button>
            {showOpenAttendee && (
              <Link
                className="at-btn at-btn--secondary"
                to={`/admin/events/${eventId}/attendees/${row.attendee_id}`}
                onClick={onClose}
              >
                <span className="at-btn__icon" aria-hidden="true">
                  <i className="ti ti-user" aria-hidden="true" />
                </span>
                <span>Open attendee</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
