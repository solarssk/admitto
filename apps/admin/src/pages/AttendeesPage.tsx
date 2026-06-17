import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { PageHeader } from "@admitto/ui";
import { ApiError, fetchEventAttendees } from "../api/client.js";
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

  const [items, setItems] = useState<AttendeeRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "admitted" | "not_admitted">("all");
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
  }, [eventId, page, pageSize, searchQuery, statusFilter, reportApiError]);

  useEffect(() => {
    void loadList();
    return () => listAbortRef.current?.abort();
  }, [loadList, reloadToken]);

  const emptyMessage =
    total === 0 && !searchQuery && statusFilter === "all"
      ? "No attendees yet. Import will be available in a future release."
      : "No matches";

  if (!eventId) return <p>Missing event.</p>;

  return (
    <>
      <PageHeader title="Attendees" subtitle="Manage attendee records and resend tickets." />
      {error && <p className="text-error">{error}</p>}

      <AttendeesTable
        items={items}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={loading}
        emptyMessage={emptyMessage}
        searchInput={searchInput}
        statusFilter={statusFilter}
        onSearchChange={setSearchInput}
        onStatusFilterChange={(v) => {
          setStatusFilter(v);
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
