import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Button, PageHeader, useToast } from "@admitto/ui";
import { ApiError, bulkResendTickets, exportAttendees, fetchEventAttendees, fetchTicketTypes } from "../api/client.js";
import type { AttendeeDetailDto, AttendeeRowDto, EventDto, RsvpStatus } from "../api/types.js";
import { AddAttendeeModal } from "../attendees/AddAttendeeModal.js";
import { AttendeesTable } from "../attendees/AttendeesTable.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import "../attendees/add-attendee-modal.css";
import "../attendees/attendees.css";

const DEBOUNCE_MS = 300;

interface SendTicketsDialogProps {
  open: boolean;
  busy: boolean;
  target: "unsent" | "all";
  error: string | null;
  onTargetChange: (t: "unsent" | "all") => void;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirm bulk ticket email send with undelivered vs all attendees target. */
function SendTicketsDialog({
  open,
  busy,
  target,
  error,
  onTargetChange,
  onConfirm,
  onClose,
}: SendTicketsDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, open, onClose);

  if (!open) return null;

  return (
    <div className="add-attendee-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="add-attendee-modal__backdrop" role="presentation" onClick={onClose} />
      <div className="add-attendee-modal__panel" ref={panelRef}>
        <h2 className="add-attendee-modal__title" id={titleId}>
          Send tickets
        </h2>
        {error && (
          <p className="add-attendee-modal__error" role="alert">
            {error}
          </p>
        )}
        <p className="mail-field-hint">Choose who should receive a ticket email in this batch.</p>
        <div className="mail-field-row">
          <label className="send-tickets-radio">
            <input
              type="radio"
              name="send-target"
              value="unsent"
              checked={target === "unsent"}
              disabled={busy}
              onChange={() => onTargetChange("unsent")}
            />
            <span>
              <strong>Undelivered only</strong>
              <span className="mail-field-hint">
                Skip attendees who have already received a ticket (accepted, sent, or delivered).
              </span>
            </span>
          </label>
          <label className="send-tickets-radio">
            <input
              type="radio"
              name="send-target"
              value="all"
              checked={target === "all"}
              disabled={busy}
              onChange={() => onTargetChange("all")}
            />
            <span>
              <strong>All attendees</strong>
              <span className="mail-field-hint">
                Resend to everyone — including those who already received a ticket.
              </span>
            </span>
          </label>
        </div>
        <div className="add-attendee-modal__actions">
          <Button type="button" variant="primary" disabled={busy} onClick={onConfirm}>
            {busy ? "Sending…" : "Send tickets"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AttendeesPage() {
  const { eventId } = useParams();
  const { event } = useOutletContext<{ event: EventDto }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { reportApiError } = useConnectionState();
  const listAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const [items, setItems] = useState<AttendeeRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "admitted" | "not_admitted">("all");
  const [rsvpStatusFilter, setRsvpStatusFilter] = useState<"" | RsvpStatus>("");
  const [ticketTypeFilter, setTicketTypeFilter] = useState("");
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [exportingFormat, setExportingFormat] = useState<"xlsx" | "csv" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sendTicketsOpen, setSendTicketsOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<"unsent" | "all">("unsent");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!eventId) return;
    setTicketTypeFilter("");
    setAvailableTypes([]);
    const ac = new AbortController();
    fetchTicketTypes(eventId, ac.signal)
      .then((types) => {
        if (ac.signal.aborted) return;
        setAvailableTypes(types);
      })
      .catch(() => {
        if (!ac.signal.aborted) setAvailableTypes([]);
      });
    return () => ac.abort();
  }, [eventId]);

  const loadList = useCallback(async () => {
    if (!eventId) return;

    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const data = await fetchEventAttendees(
        eventId,
        {
          page,
          pageSize,
          q: searchQuery || undefined,
          status: statusFilter,
          ticket_type: ticketTypeFilter || undefined,
          rsvp_status: rsvpStatusFilter || undefined,
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setItems([]);
      setTotal(0);
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
        setError(err.status === 403 ? "You do not have access to this event." : "Failed to load attendees.");
      } else {
        setError("Failed to load attendees.");
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [
    eventId,
    page,
    pageSize,
    searchQuery,
    statusFilter,
    ticketTypeFilter,
    rsvpStatusFilter,
    reportApiError,
  ]);

  useEffect(() => {
    void loadList();
    return () => listAbortRef.current?.abort();
  }, [loadList, reloadToken]);

  useEffect(() => () => exportAbortRef.current?.abort(), []);

  const handleExport = useCallback(
    async (format: "xlsx" | "csv" | "pdf") => {
      if (!eventId) return;

      exportAbortRef.current?.abort();
      const ac = new AbortController();
      exportAbortRef.current = ac;

      setExportingFormat(format);
      setExportError(null);
      try {
        await exportAttendees(
          eventId,
          {
            q: searchQuery || undefined,
            status: statusFilter,
            ticket_type: ticketTypeFilter || undefined,
            rsvp_status: rsvpStatusFilter || undefined,
          },
          format,
          ac.signal,
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof ApiError) {
          reportApiError(err.status);
          if (err.status === 401) {
            const next = encodeURIComponent(window.location.pathname);
            window.location.assign(`/login?next=${next}`);
            return;
          }
          setExportError(err.message);
        } else {
          setExportError("Export failed.");
        }
      } finally {
        if (!ac.signal.aborted) setExportingFormat(null);
      }
    },
    [eventId, searchQuery, statusFilter, ticketTypeFilter, rsvpStatusFilter, reportApiError],
  );

  const handleCreated = (attendee: AttendeeDetailDto) => {
    addToast(`${attendee.name} added`, "success");
    setPage(1);
    setReloadToken((n) => n + 1);
  };

  const handleSendTicketsConfirm = async () => {
    if (!eventId) return;
    setSendBusy(true);
    setSendError(null);
    try {
      const result = await bulkResendTickets(eventId, sendTarget);
      setSendTicketsOpen(false);
      if (result.queued === 0) {
        addToast(
          "No tickets to send — all attendees already have a delivery queued or sent.",
          "info",
        );
      } else {
        addToast(
          `Sending tickets to ${result.queued} attendee${result.queued === 1 ? "" : "s"}${
            result.skipped > 0 ? ` (${result.skipped} skipped)` : ""
          }.`,
          "success",
        );
      }
      setReloadToken((n) => n + 1);
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Failed to queue tickets.");
    } finally {
      setSendBusy(false);
    }
  };

  const emptyMessage =
    total === 0 && !searchQuery && statusFilter === "all" && !ticketTypeFilter && !rsvpStatusFilter
      ? "No attendees yet. Import a CSV or XLSX file to get started."
      : "No matches";

  if (!eventId) return <p>Missing event.</p>;

  return (
    <>
      <PageHeader
        title="Attendees"
        subtitle="Manage attendee records and resend tickets."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<i className="ti ti-download" aria-hidden="true" />}
              disabled={exportingFormat !== null}
              onClick={() => void handleExport("xlsx")}
            >
              {exportingFormat === "xlsx" ? "Exporting…" : "Export XLSX"}
            </Button>
            <Button
              variant="secondary"
              icon={<i className="ti ti-file-text" aria-hidden="true" />}
              disabled={exportingFormat !== null}
              onClick={() => void handleExport("csv")}
            >
              {exportingFormat === "csv" ? "Exporting…" : "Export CSV"}
            </Button>
            <Button
              variant="secondary"
              icon={<i className="ti ti-file-type-pdf" aria-hidden="true" />}
              disabled={exportingFormat !== null}
              onClick={() => void handleExport("pdf")}
            >
              {exportingFormat === "pdf" ? "Exporting…" : "Export PDF"}
            </Button>
            <Link to={`/admin/events/${eventId}/attendees/import`}>
              <Button variant="secondary">Import</Button>
            </Link>
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              + Add attendee
            </Button>
            <Button
              variant="secondary"
              disabled={sendBusy}
              onClick={() => {
                setSendTarget("unsent");
                setSendError(null);
                setSendTicketsOpen(true);
              }}
            >
              {sendBusy ? "Sending…" : "Send tickets"}
            </Button>
          </>
        }
      />
      {error && <p className="text-error">{error}</p>}
      {exportError && <p className="text-error">{exportError}</p>}

      <AttendeesTable
        items={items}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={loading}
        emptyMessage={emptyMessage}
        searchInput={searchInput}
        statusFilter={statusFilter}
        ticketTypeFilter={ticketTypeFilter}
        rsvpStatusFilter={rsvpStatusFilter}
        availableTypes={availableTypes}
        onSearchChange={setSearchInput}
        onStatusFilterChange={(v) => {
          setStatusFilter(v);
          setPage(1);
        }}
        onTicketTypeFilterChange={(v) => {
          setTicketTypeFilter(v);
          setPage(1);
        }}
        onRsvpStatusFilterChange={(v) => {
          setRsvpStatusFilter(v);
          setPage(1);
        }}
        onViewAttendee={(id) => navigate(`/admin/events/${eventId}/attendees/${id}`)}
        onPageChange={setPage}
        eventTimezone={event.timezone}
      />

      <AddAttendeeModal
        eventId={eventId}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={handleCreated}
      />

      <SendTicketsDialog
        open={sendTicketsOpen}
        busy={sendBusy}
        target={sendTarget}
        error={sendError}
        onTargetChange={setSendTarget}
        onConfirm={() => void handleSendTicketsConfirm()}
        onClose={() => {
          if (!sendBusy) setSendTicketsOpen(false);
        }}
      />
    </>
  );
}
