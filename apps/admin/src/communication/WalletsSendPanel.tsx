import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Notice } from "@admitto/ui";
import { fetchWalletMessageAttendees, fetchWalletMessageJob, fetchTicketTypes, sendWalletMessage } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { TicketTypeDto, WalletMessageAttendeeDto, WalletMessageFilter } from "../api/types.js";
import type { ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { AttendeePicker } from "./AttendeePicker.js";
import { RecipientCountNotice, RecipientOptionCards } from "./RecipientOptionCards.js";
import "./communication.css";

interface WalletsSendPanelProps {
  event: ArchivedGuardEvent;
  eventId: string;
  /** Composed message text from the editor above this panel - Send is disabled while empty. */
  text: string;
}

type SendPhase = "form" | "polling" | "done";

const RECIPIENT_OPTIONS: ReadonlyArray<{
  value: WalletMessageFilter["type"];
  label: string;
  description: string;
  icon: string;
}> = [
  {
    value: "all",
    label: "All attendees with a wallet",
    description: "Every attendee on this event who currently has an active Apple/Google Wallet pass.",
    icon: "ti-users",
  },
  {
    value: "ticket_type",
    label: "By ticket type",
    description: "Only attendees holding the ticket type you pick below, among wallet holders.",
    icon: "ti-ticket",
  },
  {
    value: "attendee_ids",
    label: "Specific attendees",
    description: "Pick individual attendees by name or email - only wallet holders are suggested.",
    icon: "ti-user-search",
  },
];

/** Notice tone for the send/poll result: "info" while still in flight, "warning" when nothing
 * useful happened or some messages failed, "success" otherwise. */
function resultVariant(
  phase: SendPhase,
  jobStatus: { sent: number; skipped: number; errored: number } | null,
): "info" | "success" | "warning" {
  if (phase === "polling") return "info";
  if (!jobStatus) return "warning";
  return jobStatus.errored > 0 ? "warning" : "success";
}

/** Recipients filter, dry-run count, and job send/poll for the Wallets tab - mirrors
 * CommunicationSendPanel's structure (mail's own Send tab), trimmed to the 3 recipient filters
 * that apply to wallet holders and polling a wallet_message AdminJob instead of a mail batch. */
export function WalletsSendPanel({ event, eventId, text }: Readonly<WalletsSendPanelProps>) {
  const runIdRef = useRef(0);

  const [filterType, setFilterType] = useState<WalletMessageFilter["type"]>("all");
  const [ticketType, setTicketType] = useState("");
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);
  const [ticketTypesError, setTicketTypesError] = useState<string | null>(null);
  const [selectedAttendees, setSelectedAttendees] = useState<WalletMessageAttendeeDto[]>([]);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [phase, setPhase] = useState<SendPhase>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<{ sent: number; skipped: number; errored: number } | null>(null);
  const [ticketTypesRetryToken, setTicketTypesRetryToken] = useState(0);

  const resetOutcome = useCallback(() => {
    runIdRef.current += 1;
    setRecipientCount(null);
    setPhase("form");
    setBusy(false);
    setError(null);
    setResultMessage(null);
    setJobId(null);
    setJobStatus(null);
  }, []);

  // Event switch: stale filter value/options and any prior event's outcome must not carry over.
  useEffect(() => {
    runIdRef.current += 1;
    setFilterType("all");
    setTicketType("");
    setTicketTypes([]);
    setTicketTypesError(null);
    setSelectedAttendees([]);
    resetOutcome();
  }, [eventId, resetOutcome]);

  useEffect(() => {
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
  }, [eventId, ticketTypesRetryToken]);

  useEffect(() => {
    if (phase !== "polling" || !jobId) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    const ac = new AbortController();

    const poll = async () => {
      try {
        const status = await fetchWalletMessageJob(eventId, jobId, ac.signal);
        if (cancelled) return;
        if (status.status === "succeeded" || status.status === "failed") {
          const counts = { sent: status.sent ?? 0, skipped: status.skipped ?? 0, errored: status.errored ?? 0 };
          setJobStatus(counts);
          setPhase("done");
          if (status.status === "failed") {
            setResultMessage(null);
            setError(status.error ?? "Send failed.");
          } else {
            const failedPart = counts.errored > 0 ? `, ${counts.errored} failed` : "";
            const skippedPart = counts.skipped > 0 ? `, ${counts.skipped} skipped` : "";
            setResultMessage(`Sent to ${counts.sent}${failedPart}${skippedPart}.`);
          }
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
  }, [jobId, eventId, phase]);

  const buildFilter = (): WalletMessageFilter => {
    if (filterType === "ticket_type") return { type: "ticket_type", value: ticketType.trim() };
    if (filterType === "attendee_ids") {
      return { type: "attendee_ids", ids: selectedAttendees.map((a) => a.id) };
    }
    return { type: "all" };
  };

  const filterReady =
    (filterType !== "ticket_type" || ticketType.trim().length > 0) &&
    (filterType !== "attendee_ids" || selectedAttendees.length > 0);
  const textReady = text.trim().length > 0;
  // Also locked while a count/send request is in flight (not just once one has resolved into
  // polling/done) - otherwise switching the filter mid-request lets the in-flight response land
  // against a filter the operator has already moved on from, and its count/result then gets
  // shown next to the new selection instead of the one it actually reflects.
  const pickerLocked = phase !== "form" || busy;

  const runDryRun = async () => {
    const runId = runIdRef.current;
    setBusy(true);
    setError(null);
    setRecipientCount(null);
    try {
      // Counting only resolves the filter, never touches text content - the server ignores this
      // field entirely for a dry run (see wallet-message-routes.ts), so it's fine to send
      // whatever's currently typed, even empty.
      const body = await sendWalletMessage(eventId, {
        filter: buildFilter(),
        text: text.trim(),
        dryRun: true,
      });
      if (runId !== runIdRef.current) return;
      setRecipientCount(body.recipientCount);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setError(operatorApiErrorMessage(err, "Count failed."));
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
      const body = await sendWalletMessage(eventId, {
        filter: buildFilter(),
        text: text.trim(),
      });

      if (runId !== runIdRef.current) return;

      if (body.jobId == null) {
        setPhase("done");
        setResultMessage("No recipients matched.");
        return;
      }

      setJobId(body.jobId);
      setPhase("polling");
      setResultMessage(`Sending to ${body.recipientCount}…`);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setError(operatorApiErrorMessage(err, "Send failed."));
    } finally {
      if (runId === runIdRef.current) setBusy(false);
    }
  };

  return (
    <Card title="Send to">
      <div className="settings-card-stack">
        <p className="settings-card-intro">
          Choose which attendees get this message, check how many that is, then send.
        </p>
        <RecipientOptionCards
          options={RECIPIENT_OPTIONS}
          value={filterType}
          idPrefix="wallets-recipient"
          disabled={pickerLocked}
          onChange={(value) => {
            setFilterType(value);
            setRecipientCount(null);
            setError(null);
          }}
        />
        {filterType === "ticket_type" && (
          <>
            <div className="communication-half-field">
              <SearchableSelect
                id="wallets-send-ticket-type"
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
              Attendees holding this ticket type, and who have an active wallet pass, will receive the message.
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
          <AttendeePicker<WalletMessageAttendeeDto>
            eventId={eventId}
            selected={selectedAttendees}
            disabled={pickerLocked}
            searchFn={fetchWalletMessageAttendees}
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
            {!textReady && (
              <Notice variant="warning">Write a message above before sending.</Notice>
            )}
            <RecipientCountNotice count={recipientCount} />
            <div className="communication-send-panel__actions">
              {/* A dry run still goes through the same archived-event route guard as a real
                  send (apps/web/src/app.ts wraps wallet-message/send unconditionally), so this
                  needs the same guard as Send below, not just the busy/filterReady checks. */}
              <ArchivedGuard
                event={event}
                reasonId="count-wallet-message-reason"
                disabled={busy || !filterReady}
              >
                {(guard) => (
                  <Button
                    type="button"
                    variant="secondary"
                    icon={<i className="ti ti-calculator" aria-hidden="true" />}
                    onClick={() => void runDryRun()}
                    {...guard}
                  >
                    {busy ? "Checking…" : "Count recipients"}
                  </Button>
                )}
              </ArchivedGuard>
              <ArchivedGuard
                event={event}
                reasonId="send-wallet-message-reason"
                disabled={busy || !filterReady || !textReady}
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
            {resultMessage && (
              <Notice variant={resultVariant(phase, jobStatus)} as="output">
                {resultMessage}
              </Notice>
            )}
            {phase === "polling" && (
              <p className="mail-field-hint">Sending in progress…</p>
            )}
            {/* Only once the job has actually reached a terminal state - resetOutcome only
                clears local UI state, it does not cancel the still-running server-side job, so
                offering this mid-poll would let an operator queue a second send while the first
                is still in flight and lose track of its own completion report. */}
            {phase === "done" && (
              <div className="communication-send-panel__actions">
                <Button
                  type="button"
                  variant="secondary"
                  icon={<i className="ti ti-arrow-back-up" aria-hidden="true" />}
                  disabled={busy}
                  onClick={resetOutcome}
                >
                  Send another
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
