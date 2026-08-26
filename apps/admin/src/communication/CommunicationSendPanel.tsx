import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Notice } from "@admitto/ui";
import { cancelBulkSend, fetchBulkSendStatus, fetchTicketTypes, sendEventBulk } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AttendeeRowDto, BulkSendFilter, RsvpStatus, TicketTypeDto } from "../api/types.js";
import { RSVP_STATUS_OPTIONS } from "../attendees/rsvpStatusBadge.js";
import type { ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { AttendeePicker } from "./AttendeePicker.js";
import { RecipientCountNotice, RecipientOptionCards } from "./RecipientOptionCards.js";
import "./send-progress.css";

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
  /** True when the Templates tab editor has unsaved changes. A bulk send always renders the
   * saved template server-side (only `templateId` is posted, never the live draft), so sending
   * while dirty would silently deliver the previous saved content to every recipient instead of
   * what's on screen - blocked here rather than letting that happen. */
  isDirty: boolean;
}

type SendPhase = "form" | "polling" | "done";

type BatchStatus = { queued: number; sent: number; failed: number; cancelled: number };

const RECIPIENT_OPTIONS: ReadonlyArray<{
  value: BulkSendFilter["type"];
  label: string;
  description: string;
  icon: string;
}> = [
  {
    value: "all",
    label: "All attendees",
    description: "Every attendee on this event, regardless of status.",
    icon: "ti-users",
  },
  {
    value: "rsvp_status",
    label: "By attendance status",
    description: "Only attendees with the attendance status you pick below.",
    icon: "ti-calendar-event",
  },
  {
    value: "ticket_type",
    label: "By ticket type",
    description: "Only attendees holding the ticket type you pick below.",
    icon: "ti-ticket",
  },
  {
    value: "no_delivery",
    label: "Not yet emailed",
    description: "Only attendees who've never received this template - catch up latecomers without re-emailing everyone.",
    icon: "ti-mail-off",
  },
  {
    value: "attendee_ids",
    label: "Specific attendees",
    description: "Pick individual attendees by name or email.",
    icon: "ti-user-search",
  },
];

/** Notice tone for the two remaining plain-text result cases (SendCompleteSummary owns its own
 * tone for the batch-finished case, so this only ever renders while still polling, or done with
 * no batch to summarize - "no recipients matched", "no emails queued", or a failed status check,
 * none of which have a success reading). */
function resultVariant(phase: SendPhase): "info" | "warning" {
  return phase === "polling" ? "info" : "warning";
}

/** Bar out of `queued + sent + failed + cancelled`: green for sent, red for failed, muted gray
 * for cancelled (stopped by an operator, not a delivery error - kept visually distinct from
 * failed), the rest left as the track's own neutral background (queued). At done, queued is 0
 * so the bar reads as fully sent/failed/cancelled with no neutral remainder. */
function SendProgressBar({ batchStatus }: Readonly<{ batchStatus: BatchStatus }>) {
  const total = batchStatus.queued + batchStatus.sent + batchStatus.failed + batchStatus.cancelled;
  const sentPct = total > 0 ? (batchStatus.sent / total) * 100 : 0;
  const failedPct = total > 0 ? (batchStatus.failed / total) * 100 : 0;
  const cancelledPct = total > 0 ? (batchStatus.cancelled / total) * 100 : 0;
  return (
    <div className="send-progress__bar">
      <div
        className="send-progress__bar-segment send-progress__bar-segment--sent"
        style={{ width: `${sentPct}%` }}
      />
      <div
        className="send-progress__bar-segment send-progress__bar-segment--failed"
        style={{ width: `${failedPct}%` }}
      />
      <div
        className="send-progress__bar-segment send-progress__bar-segment--cancelled"
        style={{ width: `${cancelledPct}%` }}
      />
    </div>
  );
}

/** Sent / Failed / Remaining stat tiles shown while a batch is still draining. "Remaining" is
 * the operator-facing label for the internal `queued` field - clearer than exposing the queue
 * terminology in the UI. Unlike SendProgressBar (also used from the done-state summary, where a
 * malformed status response could in principle report nothing at all), this component only ever
 * renders while polling - and polling only continues while `queued` is still positive - so
 * `total` is always positive here too; no zero-guard needed on the percentage. */
function SendProgressStats({ batchStatus }: Readonly<{ batchStatus: BatchStatus }>) {
  const total = batchStatus.queued + batchStatus.sent + batchStatus.failed + batchStatus.cancelled;
  // Cancelled rows count as "processed" - they're no longer waiting on anything, same as a sent
  // or failed row. In practice this tile view rarely shows cancelled > 0 for long: stopping a
  // batch flips every still-queued row for it in one statement, so `queued` drops to 0 - and the
  // panel moves to the done summary card - on the very next poll tick.
  const processed = batchStatus.sent + batchStatus.failed + batchStatus.cancelled;
  const percent = Math.round((processed / total) * 100);
  return (
    <div className="send-progress">
      <div className="send-progress__stats">
        <div className="send-progress__stat send-progress__stat--sent">
          <span className="send-progress__stat-value">{batchStatus.sent}</span>
          <span className="send-progress__stat-label">Sent</span>
        </div>
        <div className="send-progress__stat send-progress__stat--failed">
          <span className="send-progress__stat-value">{batchStatus.failed}</span>
          <span className="send-progress__stat-label">Failed</span>
        </div>
        <div className="send-progress__stat send-progress__stat--remaining">
          <span className="send-progress__stat-value">{batchStatus.queued}</span>
          <span className="send-progress__stat-label">Remaining</span>
        </div>
      </div>
      <SendProgressBar batchStatus={batchStatus} />
      <p className="send-progress__caption">
        <span>
          {processed} / {total} processed
        </span>
        <span>{percent}%</span>
      </p>
    </div>
  );
}

/** Done-state summary card, replacing the plain result Notice once a batch has actually
 * finished draining (batchStatus present) - computes its own success/warning tone rather than
 * reusing resultVariant() (that one always reads "warning" once polling ends, since none of its
 * own no-batch cases - no match, nothing queued, a failed status check - have a success reading;
 * only this card's own batchStatus tells whether the completed send was actually clean). Tone/
 * heading also account for an operator-initiated stop, not just failures - a stopped batch is
 * neither a clean success nor a delivery failure, but it's not the unqualified "Send complete" a
 * fully-drained batch gets either. */
function SendCompleteSummary({ batchStatus }: Readonly<{ batchStatus: BatchStatus }>) {
  const total = batchStatus.queued + batchStatus.sent + batchStatus.failed + batchStatus.cancelled;
  const hasCancellations = batchStatus.cancelled > 0;
  const hasFailures = batchStatus.failed > 0;
  const isWarning = hasFailures || hasCancellations;
  return (
    <output className="send-progress">
      <div className="send-progress__summary">
        <span
          className={`status-circle ${isWarning ? "status-circle--warn" : "status-circle--ok"}`}
          aria-hidden="true"
        >
          <i className={`ti ${isWarning ? "ti-alert-triangle" : "ti-circle-check"}`} aria-hidden="true" />
        </span>
        <div className="send-progress__summary-text">
          <strong className="send-progress__summary-heading">
            {hasCancellations ? "Send stopped" : "Send complete"}
          </strong>
          <span className="send-progress__summary-detail">
            {batchStatus.sent} sent · {batchStatus.failed} failed
            {hasCancellations ? ` · ${batchStatus.cancelled} cancelled` : ""} out of {total} total
          </span>
        </div>
      </div>
      <SendProgressBar batchStatus={batchStatus} />
    </output>
  );
}

/** Recipients filter, dry-run count, and batch send/status for the currently selected template.
 * Inline panel for the Send tab - carries the same form/count/send/poll logic that used to live
 * in a modal (CommunicationSendDialog), reset whenever the selected template changes instead of
 * on modal open/close. */
export function CommunicationSendPanel({
  event,
  eventId,
  templateId,
  snapshotMissing,
  isDirty,
}: Readonly<CommunicationSendPanelProps>) {
  const runIdRef = useRef(0);

  const [filterType, setFilterType] = useState<BulkSendFilter["type"]>("all");
  const [ticketType, setTicketType] = useState("");
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);
  const [ticketTypesError, setTicketTypesError] = useState<string | null>(null);
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus>("confirmed");
  const [selectedAttendees, setSelectedAttendees] = useState<AttendeeRowDto[]>([]);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [phase, setPhase] = useState<SendPhase>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [ticketTypesRetryToken, setTicketTypesRetryToken] = useState(0);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    runIdRef.current += 1;
    setFilterType("all");
    setTicketType("");
    setTicketTypes([]);
    setTicketTypesError(null);
    setRsvpStatus("confirmed");
    setSelectedAttendees([]);
    setRecipientCount(null);
    setPhase("form");
    setBusy(false);
    setError(null);
    setResultMessage(null);
    setBatchId(null);
    setBatchStatus(null);
    setStopConfirmOpen(false);
    setStopBusy(false);
    setStopError(null);
  }, []);

  // Clears count/result/batch UI without touching the admin's chosen filter strategy (all /
  // ticket type / RSVP / specific attendees). Ticket type *value* and options are cleared by the
  // fetch effect below. Selected attendee chips *are* cleared on event switch - those IDs belong
  // to the previous event and must not be submitted against the new one.
  const resetSendOutcome = useCallback(() => {
    runIdRef.current += 1;
    setSelectedAttendees([]);
    setRecipientCount(null);
    setPhase("form");
    setBusy(false);
    setError(null);
    setResultMessage(null);
    setBatchId(null);
    setBatchStatus(null);
    setStopConfirmOpen(false);
    setStopBusy(false);
    setStopError(null);
  }, []);

  // Switching the selected template is the tab equivalent of the old dialog's reopen - stale
  // filter/count/result state from a previous template must not carry over.
  useEffect(() => {
    resetForm();
  }, [templateId, resetForm]);

  // Event switch often keeps the same templateId (or undefined for inherited ticket). Count,
  // dry-run, and batch polling from the previous event must not stay on screen.
  useEffect(() => {
    resetSendOutcome();
  }, [eventId, resetSendOutcome]);

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
      try {
        const status = await fetchBulkSendStatus(eventId, batchId, ac.signal);
        if (cancelled) return;
        setBatchStatus({
          queued: status.queued,
          sent: status.sent,
          failed: status.failed,
          cancelled: status.cancelled,
        });
        if (status.queued === 0) {
          setPhase("done");
          setResultMessage(
            status.cancelled > 0
              ? `Send stopped: ${status.sent} sent, ${status.failed} failed, ${status.cancelled} cancelled.`
              : `Send complete: ${status.sent} sent, ${status.failed} failed.`,
          );
          return;
        }
        timeoutId = window.setTimeout(() => {
          void poll();
        }, 2000);
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        setError(operatorApiErrorMessage(err, "Failed to load send status."));
        setResultMessage(null);
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
    if (filterType === "attendee_ids") {
      return { type: "attendee_ids", ids: selectedAttendees.map((a) => a.id) };
    }
    return { type: "all" };
  };

  const filterReady =
    (filterType !== "ticket_type" || ticketType.trim().length > 0) &&
    (filterType !== "attendee_ids" || selectedAttendees.length > 0);
  // Only lock the picker once a real send is in flight/done - a quick dry-run count is
  // non-destructive and re-enabling the cards a beat later just for that read as flicker.
  const pickerLocked = phase !== "form";

  // Both runDryRun and runSend are only ever invoked from a button gated by
  // disabled={busy || !filterReady} below - filterReady is guaranteed true here.
  const runDryRun = async () => {
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
      setBatchStatus({ queued: body.queued, sent: 0, failed: body.failed, cancelled: 0 });
      setPhase("polling");
      setResultMessage(`Queued ${body.queued}, sending in progress…`);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setError(operatorApiErrorMessage(err, "Send failed."));
    } finally {
      if (runId === runIdRef.current) setBusy(false);
    }
  };

  // Only callable while phase === "polling" (the Stop button that triggers this is hidden
  // otherwise), so batchId is always set here - the check is defensive, not a real branch.
  const runStopSend = async () => {
    if (!batchId) return;
    setStopBusy(true);
    setStopError(null);
    try {
      await cancelBulkSend(eventId, batchId);
      setStopConfirmOpen(false);
      // No local batchStatus/phase update here - the still-running poll effect's next tick
      // (within 2s) picks up the drop in `queued` and the resulting "Send stopped" wording on
      // its own, the same single code path that already owns that transition.
    } catch (err) {
      setStopError(operatorApiErrorMessage(err, "Failed to stop the send."));
    } finally {
      setStopBusy(false);
    }
  };

  return (
    <Card title="Send to">
      <div className="settings-card-stack">
        <p className="settings-card-intro">
          Choose which attendees get this template, check how many that is, then send.
        </p>
        <RecipientOptionCards
          options={RECIPIENT_OPTIONS}
          value={filterType}
          idPrefix="communication-recipient"
          disabled={pickerLocked}
          onChange={(value) => {
            setFilterType(value);
            setRecipientCount(null);
            setError(null);
          }}
        />
        {filterType === "rsvp_status" && (
          <>
            <div className="communication-half-field">
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
            </div>
            <p className="mail-field-hint">
              Attendees currently marked with this status will receive the email.
            </p>
          </>
        )}
        {filterType === "ticket_type" && (
          <>
            <div className="communication-half-field">
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
            </div>
            <p className="mail-field-hint">
              Attendees holding this ticket type will receive the email.
            </p>
          </>
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
        {filterType === "attendee_ids" && (
          <AttendeePicker
            eventId={eventId}
            selected={selectedAttendees}
            disabled={pickerLocked}
            onChange={(attendees) => {
              setSelectedAttendees(attendees);
              setRecipientCount(null);
              setError(null);
            }}
          />
        )}
        {error && (
          <Notice variant="error" role="alert">
            {error}
          </Notice>
        )}
        {phase === "form" && (
          <>
            {isDirty && (
              <Notice variant="warning">
                You have unsaved template changes. Save them on the Templates tab first, otherwise
                sending delivers the last saved version, not what's on screen.
              </Notice>
            )}
            <RecipientCountNotice count={recipientCount} />
            <div className="communication-send-panel__actions">
              <Button
                type="button"
                variant="secondary"
                icon={<i className="ti ti-calculator" aria-hidden="true" />}
                disabled={busy || !filterReady}
                onClick={() => void runDryRun()}
              >
                {busy ? "Checking…" : "Count recipients"}
              </Button>
              <ArchivedGuard
                event={event}
                reasonId="send-email-reason"
                disabled={busy || !filterReady || isDirty}
              >
                {(guard) => (
                  <Button
                    type="button"
                    variant="primary"
                    icon={<i className="ti ti-send" aria-hidden="true" />}
                    onClick={() => void runSend()}
                    {...guard}
                  >
                    {busy ? "Sending…" : "Send"}
                  </Button>
                )}
              </ArchivedGuard>
            </div>
          </>
        )}
        {(phase === "polling" || phase === "done") && (
          <>
            {phase === "polling" && resultMessage && (
              <Notice variant={resultVariant(phase)} as="output">
                {resultMessage}
              </Notice>
            )}
            {phase === "polling" && batchStatus && <SendProgressStats batchStatus={batchStatus} />}
            {phase === "polling" && (
              <div className="communication-send-panel__actions">
                <Button
                  type="button"
                  variant="secondary"
                  icon={<i className="ti ti-player-stop" aria-hidden="true" />}
                  onClick={() => setStopConfirmOpen(true)}
                >
                  Stop
                </Button>
              </div>
            )}
            {phase === "done" && batchStatus && !error && <SendCompleteSummary batchStatus={batchStatus} />}
            {phase === "done" && (!batchStatus || error) && resultMessage && (
              <Notice variant={resultVariant(phase)} as="output">
                {resultMessage}
              </Notice>
            )}
            {/* Hidden while polling: resetForm only stops the client from watching this batch's
                status (it never cancels anything server-side) - showing it mid-drain would let
                an operator abandon the in-progress batch's visibility and fire a second,
                concurrent send with no indication the first one is still running. */}
            {phase === "done" && (
              <div className="communication-send-panel__actions">
                <Button
                  type="button"
                  variant="secondary"
                  icon={<i className="ti ti-arrow-back-up" aria-hidden="true" />}
                  disabled={busy}
                  onClick={resetForm}
                >
                  Send another
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {/* Gated on phase too, not just stopConfirmOpen: the background poll effect can flip the
          batch to "done" on its own (it finished draining naturally) while this dialog is open -
          without the phase check it would keep asking "Stop this send?" on top of the done-state
          summary card underneath, for a batch there's nothing left to stop. */}
      <ConfirmDialog
        open={stopConfirmOpen && phase === "polling"}
        icon={<i className="ti ti-player-stop" aria-hidden="true" />}
        title="Stop this send?"
        message="Attendees not yet emailed won't receive it. Anyone already sent the email keeps it - a message that's gone out can't be recalled."
        errorMessage={stopError}
        confirmLabel="Stop"
        confirmVariant="danger"
        loading={stopBusy}
        onConfirm={() => void runStopSend()}
        onCancel={() => {
          if (stopBusy) return;
          setStopConfirmOpen(false);
          setStopError(null);
        }}
      />
    </Card>
  );
}
