import { useEffect, useId, useRef, useState } from "react";
import { Button, Select } from "@admitto/ui";
import { ApiError, fetchBulkSendStatus, sendEventBulk } from "../api/client.js";
import type { BulkSendFilter, BulkSendQueuedResponse, RsvpStatus } from "../api/types.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";

interface CommunicationSendDialogProps {
  open: boolean;
  eventId: string;
  templateId: string;
  onClose: () => void;
}

type DialogPhase = "form" | "polling" | "done";

/** Bulk send dialog with dry-run recipient count and batch status polling. */
export function CommunicationSendDialog({
  open,
  eventId,
  templateId,
  onClose,
}: CommunicationSendDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, open, onClose);

  const [filterType, setFilterType] = useState<BulkSendFilter["type"]>("all");
  const [ticketType, setTicketType] = useState("");
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus>("confirmed");
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [phase, setPhase] = useState<DialogPhase>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<{ queued: number; sent: number; failed: number } | null>(
    null,
  );

  useEffect(() => {
    if (!open) {
      setFilterType("all");
      setTicketType("");
      setRsvpStatus("confirmed");
      setRecipientCount(null);
      setPhase("form");
      setBusy(false);
      setError(null);
      setResultMessage(null);
      setBatchId(null);
      setBatchStatus(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || phase !== "polling" || !batchId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const status = await fetchBulkSendStatus(eventId, batchId);
        if (cancelled) return;
        setBatchStatus({ queued: status.queued, sent: status.sent, failed: status.failed });
        if (status.queued === 0) {
          setPhase("done");
          setResultMessage(
            `Send complete — ${status.sent} sent, ${status.failed} failed.`,
          );
          return;
        }
        window.setTimeout(poll, 2000);
      } catch {
        if (!cancelled) {
          setError("Failed to load send status.");
          setPhase("done");
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [batchId, eventId, open, phase]);

  if (!open) return null;

  const buildFilter = (): BulkSendFilter => {
    if (filterType === "ticket_type") return { type: "ticket_type", value: ticketType.trim() };
    if (filterType === "rsvp_status") return { type: "rsvp_status", value: rsvpStatus };
    if (filterType === "no_delivery") return { type: "no_delivery" };
    return { type: "all" };
  };

  const runDryRun = async () => {
    setBusy(true);
    setError(null);
    setRecipientCount(null);
    try {
      const body = await sendEventBulk(eventId, {
        templateId,
        filter: buildFilter(),
        dryRun: true,
      });
      if ("recipientCount" in body) {
        setRecipientCount(body.recipientCount);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Dry run failed.");
    } finally {
      setBusy(false);
    }
  };

  const runSend = async () => {
    setBusy(true);
    setError(null);
    setResultMessage(null);
    try {
      const body = (await sendEventBulk(eventId, {
        templateId,
        filter: buildFilter(),
      })) as BulkSendQueuedResponse;

      if (body.batchId == null) {
        setPhase("done");
        setResultMessage("No recipients matched.");
        return;
      }

      if (body.queued === 0) {
        setPhase("done");
        const detail: string[] = [];
        if (body.skipped > 0) detail.push(`${body.skipped} skipped`);
        if (body.failed > 0) detail.push(`${body.failed} failed`);
        setResultMessage(
          detail.length > 0
            ? `No emails queued (${detail.join(", ")}).`
            : "No emails queued.",
        );
        return;
      }

      setBatchId(body.batchId);
      setBatchStatus({ queued: body.queued, sent: 0, failed: body.failed });
      setPhase("polling");
      setResultMessage(`Queued ${body.queued} — sending in progress…`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="add-attendee-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="add-attendee-modal__backdrop" role="presentation" onClick={onClose} />
      <div className="add-attendee-modal__panel" ref={panelRef}>
        <h2 className="add-attendee-modal__title" id={titleId}>
          Send email
        </h2>
        {error && (
          <p className="add-attendee-modal__error" role="alert">
            {error}
          </p>
        )}
        {phase === "form" && (
          <>
            <p className="mail-field-hint">Choose recipients for this template.</p>
            <Select
              label="Recipients"
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value as BulkSendFilter["type"]);
                setRecipientCount(null);
              }}
            >
              <option value="all">All attendees</option>
              <option value="no_delivery">No delivery for this template</option>
              <option value="rsvp_status">By RSVP status</option>
              <option value="ticket_type">By ticket type</option>
            </Select>
            {filterType === "rsvp_status" && (
              <Select
                label="RSVP status"
                value={rsvpStatus}
                onChange={(e) => {
                  setRsvpStatus(e.target.value as RsvpStatus);
                  setRecipientCount(null);
                }}
              >
                <option value="none">None</option>
                <option value="confirmed">Confirmed</option>
                <option value="declined">Declined</option>
                <option value="tentative">Tentative</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            )}
            {filterType === "ticket_type" && (
              <label className="mail-field-row">
                <span className="mail-field-label">Ticket type</span>
                <input
                  className="mail-field-input"
                  value={ticketType}
                  onChange={(e) => {
                    setTicketType(e.target.value);
                    setRecipientCount(null);
                  }}
                  placeholder="e.g. VIP"
                />
              </label>
            )}
            {recipientCount != null && (
              <p className="mail-field-hint" role="status">
                <strong>{recipientCount}</strong> recipient{recipientCount === 1 ? "" : "s"} matched
              </p>
            )}
            <div className="add-attendee-modal__actions">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void runDryRun()}>
                {busy ? "Checking…" : "Count recipients"}
              </Button>
              <Button type="button" variant="primary" disabled={busy} onClick={() => void runSend()}>
                {busy ? "Sending…" : "Send"}
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
        {(phase === "polling" || phase === "done") && (
          <>
            {resultMessage && (
              <p className="mail-field-hint" role="status">
                {resultMessage}
              </p>
            )}
            {batchStatus && phase === "polling" && (
              <p className="mail-field-hint">
                Queued: {batchStatus.queued} · Sent: {batchStatus.sent} · Failed: {batchStatus.failed}
              </p>
            )}
            <div className="add-attendee-modal__actions">
              <Button type="button" variant="primary" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
