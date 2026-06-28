import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Card, EmptyState, PageHeader, Skeleton, Stat, useToast } from "@admitto/ui";
import {
  ApiError,
  eventReportsPrintUrl,
  exportEventReportsCsv,
  fetchEventReports,
} from "../api/client.js";
import type { EventReportsResponse } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { formatEventCalendarDate, formatEventDateTime, formatEventTime } from "../utils/event-dates.js";
import "./reports-page.css";

const LOG_PAGE_SIZE = 50;

function calendarDateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function admissionLogSpansMultipleDates(
  log: EventReportsResponse["admission_log"],
  timeZone: string,
): boolean {
  const dates = new Set(log.map((row) => calendarDateInZone(row.admitted_at, timeZone)));
  return dates.size > 1;
}

function formatAdmittedTime(iso: string, timeZone: string, includeDate: boolean): string {
  if (includeDate) return formatEventDateTime(iso, timeZone);
  return formatEventTime(iso, timeZone);
}

function visibleHourRange(byHour: EventReportsResponse["by_hour"]): EventReportsResponse["by_hour"] {
  const nonZero = byHour.filter((row) => row.count > 0);
  if (nonZero.length === 0) return byHour;

  const firstIdx = byHour.indexOf(nonZero[0]!);
  const lastIdx = byHour.indexOf(nonZero[nonZero.length - 1]!);
  const start = Math.max(0, firstIdx - 1);
  const end = Math.min(byHour.length - 1, lastIdx + 1);
  return byHour.slice(start, end + 1);
}

function HourlyChart({ byHour }: { byHour: EventReportsResponse["by_hour"] }) {
  const visible = visibleHourRange(byHour);
  const max = Math.max(...visible.map((row) => row.count), 1);

  return (
    <div className="reports-chart" role="img" aria-label="Hourly admissions chart">
      {visible.map((row) => (
        <div key={row.hour} className="reports-chart__bar-wrap">
          <div className="reports-chart__count">{row.count > 0 ? row.count : ""}</div>
          <div
            className="reports-chart__bar"
            style={{
              height: `${(row.count / max) * 100}%`,
              background: row.count > 0 ? "var(--primary)" : "var(--surface-elevated)",
            }}
            title={`${row.hour}: ${row.count} admissions`}
          />
          <div className="reports-chart__label">{row.hour}</div>
        </div>
      ))}
    </div>
  );
}

function ByTicketType({ rows }: { rows: EventReportsResponse["by_ticket_type"] }) {
  if (rows.length === 0) {
    return <p className="reports-muted">No attendees registered yet.</p>;
  }

  return (
    <div className="reports-bytype">
      {rows.map((row) => (
        <div key={row.type} className="reports-bytype__row">
          <div className="reports-bytype__label">
            <span>{row.type}</span>
            <span className="reports-muted">
              {row.admitted}/{row.total} ({row.admission_pct}%)
            </span>
          </div>
          <div className="reports-bytype__track">
            <div
              className="reports-bytype__fill"
              style={{
                width: `${row.admission_pct}%`,
                background:
                  row.admission_pct > 80
                    ? "var(--status-ok)"
                    : row.admission_pct > 50
                      ? "var(--primary)"
                      : "var(--status-warn)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

interface AdmissionLogProps {
  log: EventReportsResponse["admission_log"];
  byTicketType: EventReportsResponse["by_ticket_type"];
  timeZone: string;
  truncated: boolean;
  totalAdmitted: number;
}

function AdmissionLog({ log, byTicketType, timeZone, truncated, totalAdmitted }: AdmissionLogProps) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);

  const includeAdmissionDate = useMemo(
    () => admissionLogSpansMultipleDates(log, timeZone),
    [log, timeZone],
  );

  const filtered = typeFilter === "all" ? log : log.filter((row) => row.ticket_type === typeFilter);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE));
  const paged = filtered.slice((page - 1) * LOG_PAGE_SIZE, page * LOG_PAGE_SIZE);

  return (
    <Card title="Admission log" padded={false}>
      {truncated && (
        <p className="reports-log-truncated">
          Showing the first {log.length} of {totalAdmitted} admissions. Export CSV for the full log
          (up to 10,000 rows).
        </p>
      )}
      <div className="reports-log-toolbar">
        <label className="reports-log-filter">
          <span className="reports-log-filter__label">Ticket type</span>
          <select
            className="reports-log-filter__select"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All ticket types</option>
            {byTicketType.map((row) => (
              <option key={row.type} value={row.type}>
                {row.type}
              </option>
            ))}
          </select>
        </label>
        <span className="reports-muted">
          Showing {paged.length} of {total}
        </span>
      </div>
      <div className="reports-log-table-wrap">
        <table className="reports-log-table">
          <thead>
            <tr>
              <th>Attendee</th>
              <th>Ticket type</th>
              <th>Admitted at</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((row) => (
              <tr key={row.attendee_id}>
                <td>
                  <div className="reports-log-user">
                    <strong>{row.name}</strong>
                    <span className="reports-mono reports-muted">{row.email}</span>
                  </div>
                </td>
                <td>{row.ticket_type}</td>
                <td className="reports-mono">
                  {formatAdmittedTime(row.admitted_at, timeZone, includeAdmissionDate)}
                </td>
                <td className="reports-muted">{row.device_id ?? "—"}</td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={4} className="reports-log-empty">
                  No admissions match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {total > LOG_PAGE_SIZE && (
        <div className="reports-log-foot">
          <Button
            variant="secondary"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}

export function ReportsPage() {
  const { eventId } = useParams();
  const { addToast } = useToast();
  const { reportApiError } = useConnectionState();
  const abortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const [data, setData] = useState<EventReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);

  const loadData = useCallback(async () => {
    if (!eventId) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const report = await fetchEventReports(eventId, ac.signal);
      if (ac.signal.aborted) return;
      setData(report);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setData(null);
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
        setError(err.status === 403 ? "You do not have access to this event." : err.message);
      } else {
        setError("Failed to load report.");
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [eventId, reportApiError]);

  useEffect(() => {
    void loadData();
    return () => abortRef.current?.abort();
  }, [loadData]);

  useEffect(() => () => exportAbortRef.current?.abort(), []);

  const handleExportCsv = useCallback(async () => {
    if (!eventId || exportingCsv) return;

    exportAbortRef.current?.abort();
    const ac = new AbortController();
    exportAbortRef.current = ac;

    setExportingCsv(true);
    try {
      await exportEventReportsCsv(eventId, ac.signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof ApiError) {
        reportApiError(err.status);
        if (err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
          return;
        }
        addToast(err.message, "error");
      } else {
        addToast("Export failed", "error");
      }
    } finally {
      if (!ac.signal.aborted) setExportingCsv(false);
    }
  }, [eventId, exportingCsv, addToast, reportApiError]);

  const handleExportPdf = useCallback(() => {
    if (!eventId) return;
    window.open(eventReportsPrintUrl(eventId), "_blank", "noopener,noreferrer");
  }, [eventId]);

  if (!eventId) return <p>Missing event.</p>;

  const subtitle = data
    ? `${data.event.title} · ${formatEventCalendarDate(data.event.date)}`
    : "Admission statistics and export";

  return (
    <div className="screen reports-page">
      <PageHeader
        title="Reports"
        subtitle={subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<i className="ti ti-file-text" aria-hidden="true" />}
              disabled={loading || exportingCsv || !!error}
              onClick={() => void handleExportCsv()}
            >
              Export CSV
            </Button>
            <Button
              variant="secondary"
              icon={<i className="ti ti-file-type-pdf" aria-hidden="true" />}
              disabled={loading || !!error}
              onClick={handleExportPdf}
            >
              Export PDF
            </Button>
          </>
        }
      />

      {loading && (
        <div className="reports-loading">
          <div className="reports-stats-grid">
            {[1, 2, 3, 4].map((key) => (
              <Skeleton key={key} variant="rect" height={100} />
            ))}
          </div>
          <Skeleton variant="rect" height={160} className="reports-loading__chart" />
        </div>
      )}

      {!loading && error && (
        <EmptyState
          icon={<i className="ti ti-alert-triangle" aria-hidden="true" />}
          title="Failed to load report"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void loadData()}>
              Retry
            </Button>
          }
        />
      )}

      {!loading && !error && data && data.summary.admitted === 0 && (
        <EmptyState
          icon={<i className="ti ti-chart-bar-off" aria-hidden="true" />}
          title="No check-ins yet"
          description="Reports will appear here once attendees start checking in."
        />
      )}

      {!loading && !error && data && data.summary.admitted > 0 && (
        <>
          <div className="reports-stats-grid">
            <Card>
              <Stat
                label="Total attendees"
                value={data.summary.total_attendees.toString()}
                sub={
                  data.event.capacity != null
                    ? `of ${data.event.capacity} capacity`
                    : "No capacity set"
                }
                icon={<i className="ti ti-users" aria-hidden="true" />}
              />
            </Card>
            <Card>
              <Stat
                label="Admitted"
                value={data.summary.admitted.toString()}
                sub={`${data.summary.admission_rate_pct}% admission rate`}
                icon={<i className="ti ti-circle-check" aria-hidden="true" />}
              />
            </Card>
            <Card>
              <Stat
                label="No-shows"
                value={data.summary.no_shows.toString()}
                icon={<i className="ti ti-circle-x" aria-hidden="true" />}
              />
            </Card>
            <Card>
              <Stat
                label="Peak hour"
                value={data.summary.peak_hour ?? "—"}
                sub={
                  data.summary.peak_hour
                    ? `${data.summary.peak_hour_count} admissions`
                    : "No check-ins yet"
                }
                icon={<i className="ti ti-clock" aria-hidden="true" />}
              />
            </Card>
          </div>

          <div className="reports-panels">
            <Card title={`Hourly admissions (${data.timezone})`}>
              <HourlyChart byHour={data.by_hour} />
            </Card>
            <Card title="By ticket type">
              <ByTicketType rows={data.by_ticket_type} />
            </Card>
          </div>

          <AdmissionLog
            key={data.event.id}
            log={data.admission_log}
            byTicketType={data.by_ticket_type}
            timeZone={data.timezone}
            truncated={data.admission_log_truncated}
            totalAdmitted={data.admission_log_total}
          />
        </>
      )}
    </div>
  );
}
