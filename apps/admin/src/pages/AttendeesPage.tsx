import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, PageHeader } from "@admitto/ui";
import { ApiError, exportAttendees, fetchEventAttendees, fetchTicketTypes } from "../api/client.js";
import type { AttendeeRowDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { AttendeeDetailDrawer } from "../attendees/AttendeeDetailDrawer.js";
import { AttendeesTable } from "../attendees/AttendeesTable.js";
import "../attendees/attendees.css";

const DEBOUNCE_MS = 300;

export function AttendeesPage() {
  const { eventId } = useParams();
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
  const [ticketTypeFilter, setTicketTypeFilter] = useState("");
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [exportingFormat, setExportingFormat] = useState<"xlsx" | "csv" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setAvailableTypes([]);
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
      setSelectedId(null);
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
  }, [eventId, page, pageSize, searchQuery, statusFilter, ticketTypeFilter, reportApiError]);

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
    [eventId, searchQuery, statusFilter, ticketTypeFilter, reportApiError],
  );

  const emptyMessage =
    total === 0 && !searchQuery && statusFilter === "all" && !ticketTypeFilter
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
              {exportingFormat === "csv" ? "Exporting…" : "CSV"}
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
              <Button variant="primary">Import attendees</Button>
            </Link>
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
        onRowClick={setSelectedId}
        onPageChange={setPage}
      />

      {selectedId && (
        <AttendeeDetailDrawer
          eventId={eventId}
          attendeeId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => setReloadToken((n) => n + 1)}
        />
      )}
    </>
  );
}
