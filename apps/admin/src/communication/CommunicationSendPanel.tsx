import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Notice } from "@admitto/ui";
import { fetchBulkSendStatus, fetchTicketTypes, sendEventBulk } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { BulkSendFilter, RsvpStatus, TicketTypeDto } from "../api/types.js";
import type { ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { SearchableSelect } from "../components/SearchableSelect.js";

const RSVP_STATUS_OPTIONS: ReadonlyArray<{ id: RsvpStatus; label: string }> = [
  { id: "none", label: "Registered" },
  { id: "confirmed", label: "Confirmed" },
  { id: "declined", label: "Declined" },
  { id: "tentative", label: "Tentative" },
  { id: "cancelled", label: "Cancelled" },
];

interface CommunicationSendPanelProps {
  event: ArchivedGuardEvent;
  eventId: string;
  /** The template to send. Undefined means "use the built-in default ticket template" (the
   * backend's `sendEventBulk` already falls back to it when `templateId` is omitted) - that's
   * the normal case for an event that never saved an explicit override. Only `snapshotMissing`
   * below means sending is actually unavailable. */
  templateId?: string;
  /** True only when the editor's template snapshot failed to load - the one case where there is
   * truly nothing to send, as opposed to "no explicit override" (which still sends the default). */
  snapshotMissing: boolean;
}

type SendPhase = "form" | "polling" | "done";

const RECIPIENT_OPTIONS: ReadonlyArray<{
  value: BulkSendFilter["type"];
  label: string;
  icon: string;
}> = [
  { value: "all", label: "All attendees", icon: "ti-users" },
  { value: "rsvp_status", label: "By RSVP status", icon: "ti-calendar-event" },
  { value: "ticket_type", label: "By ticket type", icon: "ti-ticket" },
  { value: "no_delivery", label: "No delivery for this template", icon: "ti-mail-off" },
];

/** Recipients filter, dry-run count, and batch send/status for the currently selected template.
 * Inline panel for the Send tab - carries the same form/count/send/poll logic that used to live
 * in a modal (CommunicationSendDialog), reset whenever the selected template changes instead of
 * on modal open/close. */
export function CommunicationSendPanel({
  event,
  eventId,
  templateId,
  snapshotMissing,
}: Readonly<CommunicationSendPanelProps>) {
  const runIdRef = useRef(0);

  const [filterType, setFilterType] = useState<BulkSendFilter["type"]>("all");
  const [ticketType, setTicketType] = useState("");
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);
  const [ticketTypesError, setTicketTypesError] = useState<string | null>(null);
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus>("confirmed");
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [phase, setPhase] = useState<SendPhase>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<{ queued: number; sent: number; failed: number } | null>(
    null,
  );
  const [ticketTypesRetryToken, setTicketTypesRetryToken] = useState(0);

  const resetForm = useCallback(() => {
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
  }, []);

  // Switching the selected template is the tab equivalent of the old dialog's reopen - stale
  // filter/count/result state from a previous template must not carry over.
  useEffect(() => {
    resetForm();
  }, [templateId, resetForm]);

  useEffect(() => {
    if (snapshotMissing) return;
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
  }, [eventId, templateId, snapshotMissing, ticketTypesRetryToken]);

  useEffect(() => {
    if (phase !== "polling" || !batchId) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    const ac = new AbortController();

    const poll = async () => {
      if (cancelled) return;
      try {
        const status = await fetchBulkSendStatus(eventId, batchId, ac.signal);
        if (cancelled) return;
        setBatchStatus({ queued: status.queued, sent: status.sent, failed: status.failed });
        if (status.queued === 0) {
          setPhase("done");
          setResultMessage(`Send complete: ${status.sent} sent, ${status.failed} failed.`);
          return;
        }
        timeoutId = window.setTimeout(() => {
          void poll();
        }, 2000);
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
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
  }, [batchId, eventId, phase]);

  if (snapshotMissing) {
    return (
      <Card title="Send">
        <p className="muted">Could not load the ticket template. Reload the page.</p>
      </Card>
    );
  }

  const buildFilter = (): BulkSendFilter => {
    if (filterType === "ticket_type") return { type: "ticket_type", value: ticketType.trim() };
    if (filterType === "rsvp_status") return { type: "rsvp_status", value: rsvpStatus };
    if (filterType === "no_delivery") return { type: "no_delivery" };
    return { type: "all" };
  };

  const filterReady = filterType !== "ticket_type" || ticketType.trim().length > 0;
  const pickerLocked = busy || phase !== "form";

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
      if (runId !== runIdRef.current) return;
      if ("recipientCount" in body) {
        setRecipientCount(body.recipientCount);
      }
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setError(operatorApiErrorMessage(err, "Dry run failed."));
    } finally {
      if (runId === runIdRef.current) setBusy(false);
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

      if (runId !== runIdRef.current) return;

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
      setResultMessage(`Queued ${body.queued}, sending in progress…`);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setError(operatorApiErrorMessage(err, "Send failed."));
    } finally {
      if (runId === runIdRef.current) setBusy(false);
    }
  };

  return (
    <>
      <Card title="Recipients">
        <p className="mail-field-hint">Choose who should get this email.</p>
        <div className="communication-recipient-cards" role="radiogroup" aria-label="Recipients">
          {RECIPIENT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={filterType === opt.value}
              disabled={pickerLocked}
              className={[
                "communication-recipient-card",
                filterType === opt.value && "communication-recipient-card--active",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => {
                setFilterType(opt.value);
                setRecipientCount(null);
                setError(null);
              }}
            >
              <i className={`ti ${opt.icon}`} aria-hidden="true" />
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
        {filterType === "rsvp_status" && (
          <SearchableSelect
            id="communication-send-rsvp-status"
            label="Attendance status"
            placeholder="Select status…"
            searchPlaceholder="Search statuses…"
            emptyLabel="No statuses found"
            value={rsvpStatus}
            disabled={pickerLocked}
            options={RSVP_STATUS_OPTIONS}
            onChange={(id) => {
              setRsvpStatus(id as RsvpStatus);
              setRecipientCount(null);
            }}
          />
        )}
        {filterType === "ticket_type" && (
          <SearchableSelect
            id="communication-send-ticket-type"
            label="Ticket type"
            placeholder="Choose…"
            searchPlaceholder="Search ticket types…"
            emptyLabel="No ticket types found"
            value={ticketType}
            disabled={pickerLocked}
            options={ticketTypes.map((type) => ({ id: type.key, label: type.label }))}
            onChange={(id) => {
              setTicketType(id);
              setRecipientCount(null);
              setError(null);
            }}
          />
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
      </Card>

      <Card title="Review & send">
        {error && (
          <Notice variant="error" role="alert">
            {error}
          </Notice>
        )}
        {phase === "form" && (
          <>
            {recipientCount != null && (
              <output className="mail-field-hint communication-send-panel__recipient-count">
                <strong>{recipientCount}</strong> recipient{recipientCount === 1 ? "" : "s"} matched
              </output>
            )}
            <div className="communication-send-panel__actions">
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !filterReady}
                onClick={() => void runDryRun()}
              >
                {busy ? "Checking…" : "Count recipients"}
              </Button>
              <ArchivedGuard event={event} reasonId="send-email-reason" disabled={busy || !filterReady}>
                {(guard) => (
                  <Button type="button" variant="primary" onClick={() => void runSend()} {...guard}>
                    {busy ? "Sending…" : "Send"}
                  </Button>
                )}
              </ArchivedGuard>
            </div>
          </>
        )}
        {(phase === "polling" || phase === "done") && (
          <>
            {resultMessage && <output className="mail-field-hint">{resultMessage}</output>}
            {batchStatus && phase === "polling" && (
              <p className="mail-field-hint">
                Queued: {batchStatus.queued} · Sent: {batchStatus.sent} · Failed:{" "}
                {batchStatus.failed}
              </p>
            )}
            <div className="communication-send-panel__actions">
              <Button type="button" variant="secondary" disabled={busy} onClick={resetForm}>
                Send another
              </Button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
