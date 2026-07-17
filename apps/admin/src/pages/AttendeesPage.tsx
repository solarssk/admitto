import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Button, EmptyState, PageHeader, useToast, type ToastVariant } from "@admitto/ui";
import {
  ApiError,
  bulkDeleteAttendees,
  bulkResendTickets,
  exportAttendees,
  fetchEventAttendees,
  fetchTicketTypes,
  sendEventBulk,
  updateAttendee,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type {
  AttendeeDetailDto,
  AttendeeRowDto,
  AttendeeSortBy,
  AttendeeSortDir,
  EventDto,
  RsvpStatus,
  TicketTypeDto,
} from "../api/types.js";
import { AddAttendeeModal } from "../attendees/AddAttendeeModal.js";
import { AttendeesTable } from "../attendees/AttendeesTable.js";
import { useMailConfigured } from "../attendees/useMailConfigured.js";
import { ArchivedGuard, isEventArchived } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import "../attendees/add-attendee-modal.css";
import "../attendees/attendees.css";

const DEBOUNCE_MS = 300;
/** Matches EventSettingsPage's Danger Zone bulk actions — a brief "don't act on reflex" pause
 * before a bulk, irreversible action's confirm button becomes clickable. */
const BULK_DELETE_CONFIRM_DELAY_SECONDS = 10;

function mergeAttendeeRow(prev: AttendeeRowDto, updated: AttendeeDetailDto): AttendeeRowDto {
  return {
    ...prev,
    status: updated.status,
    updated_at: updated.updated_at,
    check_in_status: updated.check_in_status,
    admitted_at: updated.admitted_at,
  };
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

/** Standard "N queued / M failed / K skipped" toast for a bulk-send queue result — shared by
 * the header "Send tickets" dialog and the bulk-bar's send-to-selection action. */
function notifyBulkSendResult(
  result: { queued: number; skipped: number; failed: number },
  addToast: (message: string, variant?: ToastVariant) => void,
) {
  const { queued, skipped, failed } = result;

  if (failed === 0 && queued === 0) {
    const message = skipped > 0 ? `No tickets were queued (${skipped} skipped).` : "No tickets to send.";
    addToast(message, "info");
    return;
  }

  if (failed === 0) {
    const skippedNote = skipped > 0 ? ` (${skipped} skipped)` : "";
    addToast(`Sending tickets to ${queued} ${pluralize(queued, "attendee")}${skippedNote}.`, "success");
    return;
  }

  if (queued === 0) {
    const skippedNote = skipped > 0 ? ` (${skipped} skipped)` : "";
    addToast(
      `Bulk send failed: ${failed} ${pluralize(failed, "ticket")} could not be sent${skippedNote}.`,
      "error",
    );
    return;
  }

  const skippedNote = skipped > 0 ? `; ${skipped} skipped` : "";
  addToast(`Sent ${queued} ${pluralize(queued, "ticket")}; ${failed} failed${skippedNote}.`, "warning");
}

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
                Skip attendees who already have a ticket email accepted, sent, delivered, or queued.
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
                Resend to everyone, including those who already received a ticket.
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

type ExportFormat = "xlsx" | "csv" | "pdf";

interface ExportMenuProps {
  exportingFormat: ExportFormat | null;
  onExport: (format: ExportFormat) => void;
}

const EXPORT_FORMATS: { key: ExportFormat; label: string; icon: string; hint: string }[] = [
  { key: "xlsx", label: "XLSX", icon: "table", hint: "Excel workbook" },
  { key: "csv", label: "CSV", icon: "file-text", hint: "Plain text file" },
  { key: "pdf", label: "PDF", icon: "file-type-pdf", hint: "Ready to print" },
];

/** Single "Export" entry point — opens a small menu for XLSX/CSV/PDF, replacing three separate buttons. */
function ExportMenu({ exportingFormat, onExport }: Readonly<ExportMenuProps>) {
  const { open, setOpen, close, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();

  return (
    <div className="attendees-export-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        icon={<i className="ti ti-download" aria-hidden="true" />}
        hasMenu
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={exportingFormat !== null}
        onClick={() => setOpen((o) => !o)}
      >
        {exportingFormat ? `Exporting ${exportingFormat.toUpperCase()}…` : "Export"}
      </Button>
      {open && (
        <div className="attendees-export-menu__panel" role="menu" ref={panelRef}>
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format.key}
              type="button"
              role="menuitem"
              className="attendees-export-menu__item"
              onClick={() => {
                close();
                onExport(format.key);
              }}
            >
              <span className="attendees-export-menu__item-icon">
                <i className={`ti ti-${format.icon}`} aria-hidden="true" />
              </span>
              <span className="attendees-export-menu__item-text">
                <strong>{format.label}</strong>
                <span>{format.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
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
  const [pageSize, setPageSize] = useState(25);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "admitted" | "not_admitted">("all");
  const [rsvpStatusFilter, setRsvpStatusFilter] = useState<"" | RsvpStatus>("");
  const [ticketTypeFilter, setTicketTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState<AttendeeSortBy>("name");
  const [sortDir, setSortDir] = useState<AttendeeSortDir>("asc");
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);
  const [ticketTypesError, setTicketTypesError] = useState<string | null>(null);
  const [ticketTypesRetryToken, setTicketTypesRetryToken] = useState(0);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [loading, setLoading] = useState(true);
  // True once the very first fetch (success or failure) has settled - distinguishes the
  // real first-load skeleton from a later filter/search landing on zero matches, which
  // should dim in place like any other refetch instead of flashing the skeleton again.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sendTicketsOpen, setSendTicketsOpen] = useState(false);
  const [sendTarget, setSendTarget] = useState<"unsent" | "all">("unsent");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [bulkSendBusy, setBulkSendBusy] = useState(false);
  const [bulkSendConfirmOpen, setBulkSendConfirmOpen] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AttendeeRowDto | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const passActionBusyRef = useRef(new Set<string>());
  const [passActionBusyVersion, setPassActionBusyVersion] = useState(0);
  const passActionBusyIds = useMemo(
    () => new Set(passActionBusyRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passActionBusyVersion is a version counter; the ref holds the data, the state is the invalidation signal
    [passActionBusyVersion],
  );

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
    setTicketTypes([]);
    setTicketTypesError(null);
    const ac = new AbortController();
    fetchTicketTypes(eventId, ac.signal)
      .then((types) => {
        if (ac.signal.aborted) return;
        setTicketTypes(types);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setTicketTypes([]);
        setTicketTypesError(operatorApiErrorMessage(err, "Couldn't load types."));
      });
    return () => ac.abort();
  }, [eventId, ticketTypesRetryToken]);

  // Whether the header "Send tickets" button should work at all — shared with the Attendee
  // Detail page's "Resend ticket" gate via useMailConfigured.
  const mailConfigured = useMailConfigured(eventId);

  const loadList = useCallback(async () => {
    if (!eventId) return;

    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;

    setLoading(true);
    setSelectedIds(new Set());
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
          sortBy,
          sortDir,
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      setItems(data.items);
      setTotal(data.total);
      setLoadError(null);
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
        setLoadError(
          err.status === 403 ? "You do not have access to this event." : "Failed to load attendees.",
        );
      } else {
        setLoadError("Failed to load attendees.");
      }
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
        setHasLoadedOnce(true);
      }
    }
  }, [
    eventId,
    page,
    pageSize,
    searchQuery,
    statusFilter,
    ticketTypeFilter,
    rsvpStatusFilter,
    sortBy,
    sortDir,
    reportApiError,
  ]);

  useEffect(() => {
    void loadList();
    return () => listAbortRef.current?.abort();
  }, [loadList, reloadToken]);

  useEffect(() => () => exportAbortRef.current?.abort(), []);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!eventId) return;

      exportAbortRef.current?.abort();
      const ac = new AbortController();
      exportAbortRef.current = ac;

      setExportingFormat(format);
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
          addToast(operatorApiErrorMessage(err, "Request failed."), "error");
        } else {
          addToast("Export failed.", "error");
        }
      } finally {
        if (!ac.signal.aborted) setExportingFormat(null);
      }
    },
    [eventId, searchQuery, statusFilter, ticketTypeFilter, rsvpStatusFilter, reportApiError, addToast],
  );

  const handleCreated = (attendee: AttendeeDetailDto) => {
    addToast(`${attendee.name} added`, "success");
    setPage(1);
    setReloadToken((n) => n + 1);
  };

  const handlePassStatusChange = useCallback(
    async (row: AttendeeRowDto, nextStatus: "registered" | "revoked") => {
      if (!eventId) return;
      if (passActionBusyRef.current.has(row.id)) return;
      passActionBusyRef.current.add(row.id);
      setPassActionBusyVersion((version) => version + 1);
      setRevokeError(null);
      try {
        const updated = await updateAttendee(eventId, row.id, {
          status: nextStatus,
          expected_updated_at: row.updated_at,
        });
        setItems((prev) => prev.map((item) => (item.id === row.id ? mergeAttendeeRow(item, updated) : item)));
        setRevokeOpen(false);
        setRevokeTarget(null);
        addToast(nextStatus === "revoked" ? "Pass revoked" : "Pass restored", "success");
      } catch (err) {
        if (err instanceof ApiError) {
          reportApiError(err.status);
          if (err.status === 401) {
            const next = encodeURIComponent(window.location.pathname);
            window.location.assign(`/login?next=${next}`);
            return;
          }
          if (err.status === 409) {
            if (err.code === "event_full") {
              addToast("Event is at capacity — pass cannot be restored.", "error");
            } else if (err.code === "stale_write") {
              addToast("Someone else updated this attendee — reloading list", "warning");
              setRevokeOpen(false);
              setRevokeTarget(null);
              setRevokeError(null);
              setReloadToken((n) => n + 1);
            } else if (revokeOpen) {
              setRevokeError("Could not update pass status.");
            } else {
              addToast("Could not update pass status.", "error");
            }
            return;
          }
        }
        if (revokeOpen) {
          setRevokeError(operatorApiErrorMessage(err, "Could not update pass status."));
        } else {
          addToast(operatorApiErrorMessage(err, "Could not update pass status."), "error");
        }
      } finally {
        if (passActionBusyRef.current.delete(row.id)) {
          setPassActionBusyVersion((version) => version + 1);
        }
      }
    },
    [addToast, eventId, reportApiError, revokeOpen],
  );

  const handleSendTicketsConfirm = async () => {
    if (!eventId) return;
    setSendBusy(true);
    setSendError(null);
    try {
      const result = await bulkResendTickets(eventId, sendTarget);
      setSendTicketsOpen(false);
      notifyBulkSendResult(result, addToast);
      setReloadToken((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
        setSendError(operatorApiErrorMessage(err, "Send failed."));
      } else {
        setSendError("Failed to queue tickets.");
      }
    } finally {
      setSendBusy(false);
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** Selects/deselects every currently-loaded row — scoped to this page only, never across pages. */
  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const allSelected = items.length > 0 && items.every((item) => prev.has(item.id));
      return allSelected ? new Set() : new Set(items.map((item) => item.id));
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  /** Separate, additive bulk-send path for an explicit subset of selected attendees — the
   * existing header "Send tickets" dialog (all / undelivered-only) is untouched. No
   * templateId here on purpose: the server falls back to the built-in default ("ticket")
   * template when it's omitted, the same as the plain bulk-resend endpoint already does -
   * so this works even for an event with no persisted ticket template row. */
  const handleBulkSendSelected = async () => {
    if (!eventId || selectedIds.size === 0) return;
    setBulkSendBusy(true);
    try {
      const result = await sendEventBulk(eventId, {
        filter: { type: "attendee_ids", ids: [...selectedIds] },
      });
      notifyBulkSendResult(result, addToast);
      setReloadToken((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
        addToast(operatorApiErrorMessage(err, "Send failed."), "error");
      } else {
        addToast("Failed to queue tickets.", "error");
      }
    } finally {
      setBulkSendBusy(false);
    }
  };

  /** Bulk GDPR erasure for an explicit subset of selected attendees — same effect as running
   * the attendee detail page's "Delete attendee" once per selected row. */
  const handleBulkDeleteSelected = async () => {
    if (!eventId || selectedIds.size === 0) return;
    setBulkDeleteBusy(true);
    try {
      const { deletedCount } = await bulkDeleteAttendees(eventId, [...selectedIds]);
      addToast(`${deletedCount} attendee${deletedCount === 1 ? "" : "s"} permanently deleted`, "success");
      setBulkDeleteConfirmOpen(false);
      clearSelection();
      setReloadToken((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
        addToast(operatorApiErrorMessage(err, "Delete failed."), "error");
      } else {
        addToast("Failed to delete attendees.", "error");
      }
    } finally {
      setBulkDeleteBusy(false);
    }
  };

  const isUnfilteredEmpty =
    total === 0 && !searchQuery && statusFilter === "all" && !ticketTypeFilter && !rsvpStatusFilter;

  if (!eventId) return <p>Missing event.</p>;

  return (
    <>
      <PageHeader
        title="Attendees"
        subtitle="Manage attendee records and resend tickets."
        actions={
          <>
            {isEventArchived(event) ? (
              <ArchivedGuard event={event} reasonId="import-attendees-reason" placement="below">
                {(guard) => (
                  <Button variant="secondary" {...guard}>
                    Import
                  </Button>
                )}
              </ArchivedGuard>
            ) : (
              <Link to={`/admin/events/${eventId}/attendees/import`}>
                <Button variant="secondary">Import</Button>
              </Link>
            )}
            <ArchivedGuard event={event} reasonId="add-attendee-reason" placement="below">
              {(guard) => (
                <Button variant="primary" {...guard} onClick={() => setAddOpen(true)}>
                  + Add attendee
                </Button>
              )}
            </ArchivedGuard>
            <ArchivedGuard
              event={event}
              reasonId="send-tickets-reason"
              disabled={sendBusy || mailConfigured === false}
              tooltip={
                mailConfigured === false
                  ? "No mail transport configured for this event. Set one up in Event Settings → Mailing."
                  : undefined
              }
              placement="below"
            >
              {(guard) => (
                <Button
                  variant="secondary"
                  {...guard}
                  onClick={() => {
                    setSendTarget("unsent");
                    setSendError(null);
                    setSendTicketsOpen(true);
                  }}
                >
                  {sendBusy ? "Sending…" : "Send tickets"}
                </Button>
              )}
            </ArchivedGuard>
            <ExportMenu exportingFormat={exportingFormat} onExport={handleExport} />
          </>
        }
      />

      {loadError && !loading ? (
        <EmptyState
          title="Could not load attendees"
          description={loadError}
          action={
            <Button type="button" variant="secondary" onClick={() => void loadList()}>
              Retry
            </Button>
          }
        />
      ) : (
        <AttendeesTable
        items={items}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={loading}
        hasLoadedOnce={hasLoadedOnce}
        isUnfilteredEmpty={isUnfilteredEmpty}
        searchInput={searchInput}
        statusFilter={statusFilter}
        ticketTypeFilter={ticketTypeFilter}
        rsvpStatusFilter={rsvpStatusFilter}
        ticketTypes={ticketTypes}
        ticketTypesError={ticketTypesError}
        onRetryTicketTypes={() => setTicketTypesRetryToken((n) => n + 1)}
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
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(column) => {
          if (column === sortBy) {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
          } else {
            setSortBy(column);
            setSortDir("asc");
          }
          setPage(1);
        }}
        onViewAttendee={(id) => navigate(`/admin/events/${eventId}/attendees/${id}`)}
        onRevokePass={(row) => {
          setRevokeTarget(row);
          setRevokeError(null);
          setRevokeOpen(true);
        }}
        onRestorePass={(row) => void handlePassStatusChange(row, "registered")}
        passActionBusyIds={passActionBusyIds}
        onPageChange={setPage}
        onPageSizeChange={(v) => {
          setPageSize(v);
          setPage(1);
        }}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleSelectAll={toggleSelectAllOnPage}
        onClearSelection={clearSelection}
        onBulkSendTickets={() => setBulkSendConfirmOpen(true)}
        bulkSendBusy={bulkSendBusy}
        canBulkSend={mailConfigured !== false}
        onBulkDelete={() => setBulkDeleteConfirmOpen(true)}
        eventTimezone={event.timezone}
        event={event}
      />
      )}

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

      <ConfirmDialog
        open={revokeOpen}
        title="Revoke pass?"
        message={
          revokeTarget
            ? `Revoke the pass for ${revokeTarget.name}? They will no longer be able to check in until the pass is restored.`
            : ""
        }
        confirmLabel="Revoke pass"
        confirmVariant="danger"
        loading={revokeTarget ? passActionBusyIds.has(revokeTarget.id) : false}
        errorMessage={revokeError ?? undefined}
        onConfirm={() => {
          if (revokeTarget) void handlePassStatusChange(revokeTarget, "revoked");
        }}
        onCancel={() => {
          if (!revokeTarget || !passActionBusyIds.has(revokeTarget.id)) {
            setRevokeOpen(false);
            setRevokeTarget(null);
            setRevokeError(null);
          }
        }}
      />

      <ConfirmDialog
        open={bulkSendConfirmOpen}
        title="Send tickets?"
        message={`Send tickets to ${selectedIds.size} selected attendee${selectedIds.size === 1 ? "" : "s"}?`}
        confirmLabel="Send tickets"
        loading={bulkSendBusy}
        onConfirm={() => {
          setBulkSendConfirmOpen(false);
          void handleBulkSendSelected();
        }}
        onCancel={() => {
          if (!bulkSendBusy) setBulkSendConfirmOpen(false);
        }}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        title={`Permanently delete ${selectedIds.size} attendee${selectedIds.size === 1 ? "" : "s"}?`}
        message="This cannot be undone. For each selected attendee, this permanently removes:"
        confirmLabel="Delete attendees"
        confirmVariant="danger"
        loading={bulkDeleteBusy}
        confirmDelaySeconds={BULK_DELETE_CONFIRM_DELAY_SECONDS}
        onConfirm={() => void handleBulkDeleteSelected()}
        onCancel={() => {
          if (!bulkDeleteBusy) setBulkDeleteConfirmOpen(false);
        }}
      >
        <ul className="confirm-dialog__list">
          <li>Profile and contact details</li>
          <li>Ticket deliveries</li>
          <li>Wallet pass</li>
          <li>Check-in history</li>
        </ul>
      </ConfirmDialog>
    </>
  );
}
