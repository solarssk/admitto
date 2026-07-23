import { useEffect, useId, useRef, useState } from "react";
import { Button, Select } from "@admitto/ui";
import { fetchBulkSendStatus, fetchTicketTypes, sendEventBulk } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { BulkSendFilter, RsvpStatus, TicketTypeDto } from "../api/types.js";
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
}: Readonly<CommunicationSendDialogProps>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  const runIdRef = useRef(0);
  openRef.current = open;

  const [filterType, setFilterType] = useState<BulkSendFilter["type"]>("all");
  const [ticketType, setTicketType] = useState("");
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);
  const [ticketTypesError, setTicketTypesError] = useState<string | null>(null);
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

  const closeIfAllowed = () => {
    if (busy) return;
    onClose();
  };

  useModalFocusTrap(panelRef, open, closeIfAllowed);

  useEffect(() => {
    if (open) return;
    runIdRef.current += 1;
    setFilterType("all");
    setTicketType("");
    setTicketTypes([]);
    setTicketTypesError(null);
    setRsvpStatus("confirmed");
    setRecipientCount(null);
    setPhase("form");
    setBusy(false);
    setError(null);
    setResultMessage(null);
    setBatchId(null);
    setBatchStatus(null);
  }, [open]);

  const [ticketTypesRetryToken, setTicketTypesRetryToken] = useState(0);
  useEffect(() => {
    if (!open) return;
    // Clears the selected value along with the stale options list below - not just cosmetic:
    // leaving a previous event's ticket_type key selected would keep filterReady true (it only
    // checks the string is non-empty) and could send/count against a key that means nothing, or
    // something different, on the new event (review). Only the value resets, not filterType -
    // silently reverting the admin's chosen filter *strategy* back to "all recipients" would be
    // a bigger, more surprising behavior change than asking them to re-pick a value.
    setTicketType("");
    setTicketTypes([]);
    let cancelled = false;
    setTicketTypesError(null);
    fetchTicketTypes(eventId)
      .then((types) => {
        if (!cancelled) setTicketTypes(types);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTicketTypes([]);
        setTicketTypesError(operatorApiErrorMessage(err, "Failed to load ticket types."));
      });
    return () => {
      cancelled = true;
    };
  }, [open, eventId, ticketTypesRetryToken]);

  useEffect(() => {
    if (!open || phase !== "polling" || !batchId) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    const ac = new AbortController();

    const poll = async () => {
      if (cancelled) return;
      try {
        const status = await fetchBulkSendStatus(eventId, batchId, ac.signal);
        if (cancelled || !openRef.current) return;
        setBatchStatus({ queued: status.queued, sent: status.sent, failed: status.failed });
        if (status.queued === 0) {
          setPhase("done");
          setResultMessage(`Send complete — ${status.sent} sent, ${status.failed} failed.`);
          return;
        }
        timeoutId = window.setTimeout(() => {
          void poll();
        }, 2000);
      } catch (err) {
        if (cancelled || ac.signal.aborted || !openRef.current) return;
        setError(operatorApiErrorMessage(err, "Failed to load send status."));
        setPhase("done");
      }
    };

    void poll();
    return () => {
      cancelled = true;
      ac.abort();
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [batchId, eventId, open, phase]);

  if (!open) return null;

  const buildFilter = (): BulkSendFilter => {
    if (filterType === "ticket_type") return { type: "ticket_type", value: ticketType.trim() };
    if (filterType === "rsvp_status") return { type: "rsvp_status", value: rsvpStatus };
    if (filterType === "no_delivery") return { type: "no_delivery" };
    return { type: "all" };
  };

  const filterReady = filterType !== "ticket_type" || ticketType.trim().length > 0;

  const runDryRun = async () => {
    if (!filterReady) {
      setError("Choose a ticket type.");
      return;
    }
    const runId = runIdRef.current;
    setBusy(true);
    setError(null);
    setRecipientCount(null);
    try {
      const body = await sendEventBulk(eventId, {
        templateId,
        filter: buildFilter(),
        dryRun: true,
      });
      if (runId !== runIdRef.current || !openRef.current) return;
      if ("recipientCount" in body) {
        setRecipientCount(body.recipientCount);
      }
    } catch (err) {
      if (runId !== runIdRef.current || !openRef.current) return;
      setError(operatorApiErrorMessage(err, "Dry run failed."));
    } finally {
      if (runId === runIdRef.current && openRef.current) {
        setBusy(false);
      }
    }
  };

  const runSend = async () => {
    if (!filterReady) {
      setError("Choose a ticket type.");
      return;
    }
    const runId = runIdRef.current;
    setBusy(true);
    setError(null);
    setResultMessage(null);
    try {
      const body = await sendEventBulk(eventId, {
        templateId,
        filter: buildFilter(),
      });

      if (runId !== runIdRef.current || !openRef.current) return;

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
          detail.length > 0 ? `No emails queued (${detail.join(", ")}).` : "No emails queued.",
        );
        return;
      }

      setBatchId(body.batchId);
      setBatchStatus({ queued: body.queued, sent: 0, failed: body.failed });
      setPhase("polling");
      setResultMessage(`Queued ${body.queued} — sending in progress…`);
    } catch (err) {
      if (runId !== runIdRef.current || !openRef.current) return;
      setError(operatorApiErrorMessage(err, "Send failed."));
    } finally {
      if (runId === runIdRef.current && openRef.current) {
        setBusy(false);
      }
    }
  };

  return (
    <dialog open className="add-attendee-modal" aria-modal="true" aria-labelledby={titleId}>
      <div
        className="add-attendee-modal__backdrop"
        role="presentation"
        onClick={closeIfAllowed}
      />
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
                setError(null);
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
              <Select
                label="Ticket type"
                value={ticketType}
                onChange={(e) => {
                  setTicketType(e.target.value);
                  setRecipientCount(null);
                  setError(null);
                }}
              >
                <option value="">Choose…</option>
                {ticketTypes.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </Select>
            )}
            {filterType === "ticket_type" && ticketTypesError && (
              <p className="mail-field-hint" role="alert">
                {ticketTypesError}{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setTicketTypesRetryToken((n) => n + 1)}
                >
                  Retry
                </button>
              </p>
            )}
            {filterType === "ticket_type" && !filterReady && (
              <p className="mail-field-hint">Choose a ticket type to count or send.</p>
            )}
            {recipientCount != null && (
              <output className="mail-field-hint">
                <strong>{recipientCount}</strong> recipient{recipientCount === 1 ? "" : "s"} matched
              </output>
            )}
            <div className="add-attendee-modal__actions">
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !filterReady}
                onClick={() => void runDryRun()}
              >
                {busy ? "Checking…" : "Count recipients"}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={busy || !filterReady}
                onClick={() => void runSend()}
              >
                {busy ? "Sending…" : "Send"}
              </Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={closeIfAllowed}>
                Cancel
              </Button>
            </div>
          </>
        )}
        {(phase === "polling" || phase === "done") && (
          <>
            {resultMessage && (
              <output className="mail-field-hint">
                {resultMessage}
              </output>
            )}
            {batchStatus && phase === "polling" && (
              <p className="mail-field-hint">
                Queued: {batchStatus.queued} · Sent: {batchStatus.sent} · Failed:{" "}
                {batchStatus.failed}
              </p>
            )}
            <div className="add-attendee-modal__actions">
              <Button type="button" variant="primary" disabled={busy} onClick={closeIfAllowed}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
