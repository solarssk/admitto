import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import { loadEventTicketTypes, writeBulkActionLog, type TicketTypeInfo } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";
import { sanitizeCsvCell } from "./csv-sanitize.js";
import { attachmentContentDisposition } from "./content-disposition.js";

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
const CSV_EXPORT_MAX = 10_000;
const PDF_LOG_MAX = 100;
export const ADMISSION_LOG_LIMIT = 500;

export interface EventReportsResponse {
  timezone: string;
  event: {
    id: string;
    title: string;
    date: string;
    capacity: number | null;
  };
  summary: {
    total_attendees: number;
    admitted: number;
    no_shows: number;
    admission_rate_pct: number;
    peak_hour: string | null;
    peak_hour_count: number;
  };
  by_hour: Array<{ hour: string; count: number }>;
  /** Iterates the event's live TicketType catalog (batch 04 / #351) - a configured type with 0
   * attendees still appears, ordered same as the Event Settings tab. A trailing entry with
   * `key: null` covers attendees with no type set. A stored `ticket_type` can still reference no
   * live catalog row - the type was deleted after being assigned (same case AttendeeDetailPage.tsx
   * already surfaces as "(not in catalog)"), or an event's data was seeded/restored outside the
   * write paths that enforce catalog membership - so any remaining unmatched keys get their own
   * trailing entries too (Codex review, batch 04 / #387), instead of silently vanishing from the
   * breakdown while still counting in `summary` and the admission log. */
  by_ticket_type: Array<{
    key: string | null;
    type: string;
    color: string;
    total: number;
    admitted: number;
    admission_pct: number;
  }>;
  admission_log: Array<{
    attendee_id: string;
    name: string;
    email: string;
    ticket_type: string | null;
    admitted_at: string;
    device_id: string | null;
    items: string[];
  }>;
  admission_log_truncated: boolean;
  admission_log_total: number;
  /** Only buckets with at least one admitted attendee - the frontend zero-fills the full status
   * set (it already owns the canonical order/labels via RSVP_LABELS) rather than duplicating that
   * list here. */
  by_rsvp_status: Array<{ status: string; count: number }>;
  /** Only "scan"/"manual" - the only two check-in sources that represent an actual admission
   * method (mirrors the same filter loadDeviceIdsByAttendee already uses); "undo"/"admin_revoke"
   * are lifecycle events, not admission methods. */
  by_checkin_method: Array<{ method: string; count: number }>;
  /** Admissions per operator-labeled device (DeviceLabelStep) - same VALID/scan+manual filter as
   * by_checkin_method. `device_id: null` covers a check-in from a session that skipped labeling,
   * kept as its own bucket rather than dropped so the total still reconciles. */
  by_device: Array<{ device_id: string | null; count: number }>;
}

/** Display label for a raw ticket_type key/null in server-rendered CSV/PDF exports (the admin
 * SPA instead renders a colored TicketTypeBadge via the catalog it already has). */
function resolveTicketTypeLabel(catalog: TicketTypeInfo[], key: string | null): string {
  if (!key) return "(none)";
  return catalog.find((t) => t.key === key)?.label ?? key;
}

function oneDecimalPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Keyed by the raw ticket_type column value (catalog key, or null for "no type set") - not a
 * display label, so the caller can match counts against catalog entries in order. */
function mergeTicketTypeCounts(
  rows: Array<{ ticket_type: string | null; _count: { _all: number } }>,
): Map<string | null, number> {
  const map = new Map<string | null, number>();
  for (const row of rows) {
    map.set(row.ticket_type, (map.get(row.ticket_type) ?? 0) + row._count._all);
  }
  return map;
}

function buildByHour(raw: Array<{ hour: string; count: bigint | number }>): EventReportsResponse["by_hour"] {
  const counts = new Map(raw.map((row) => [row.hour, Number(row.count)]));
  return HOUR_LABELS.map((hour) => ({ hour, count: counts.get(hour) ?? 0 }));
}

function resolvePeakHour(byHour: EventReportsResponse["by_hour"], admittedCount: number): {
  peak_hour: string | null;
  peak_hour_count: number;
} {
  if (admittedCount === 0) {
    return { peak_hour: null, peak_hour_count: 0 };
  }
  let peakHour = byHour[0]!.hour;
  let peakCount = 0;
  for (const row of byHour) {
    if (row.count > peakCount) {
      peakCount = row.count;
      peakHour = row.hour;
    }
  }
  return { peak_hour: peakHour, peak_hour_count: peakCount };
}

async function loadDeviceIdsByAttendee(
  db: PrismaClient,
  eventId: string,
  attendeeIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (attendeeIds.length === 0) return map;

  const checkIns = await db.checkIn.findMany({
    where: {
      event_id: eventId,
      attendee_id: { in: attendeeIds },
      status: "VALID",
      source: { in: ["scan", "manual"] },
    },
    orderBy: [{ checked_in_at: "asc" }, { id: "asc" }],
    select: { attendee_id: true, device_id: true },
  });

  for (const row of checkIns) {
    if (!map.has(row.attendee_id)) {
      map.set(row.attendee_id, row.device_id);
    }
  }
  return map;
}

/** Items currently in the attendee's hands - "issued" only, not "pending" (never handed out) or
 * "returned" (handed back). Ordered by the event's item key, same order as the Requirements tab. */
async function loadIssuedItemLabelsByAttendee(
  db: PrismaClient,
  eventId: string,
  attendeeIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (attendeeIds.length === 0) return map;

  const states = await db.attendeeItemState.findMany({
    where: {
      attendee_id: { in: attendeeIds },
      state: "issued",
      event_item: { event_id: eventId },
    },
    orderBy: { event_item: { key: "asc" } },
    select: { attendee_id: true, event_item: { select: { label: true } } },
  });

  for (const row of states) {
    const labels = map.get(row.attendee_id) ?? [];
    labels.push(row.event_item.label);
    map.set(row.attendee_id, labels);
  }
  return map;
}

type AdmittedRow = {
  id: string;
  name: string;
  email: string;
  ticket_type: string | null;
  admitted_at: Date;
};

function mapAdmissionLogRow(
  row: AdmittedRow,
  deviceByAttendee: Map<string, string | null>,
  itemsByAttendee: Map<string, string[]>,
): EventReportsResponse["admission_log"][number] {
  return {
    attendee_id: row.id,
    name: row.name,
    email: row.email,
    ticket_type: row.ticket_type,
    admitted_at: row.admitted_at.toISOString(),
    device_id: deviceByAttendee.get(row.id) ?? null,
    items: itemsByAttendee.get(row.id) ?? [],
  };
}

async function loadReportsAggregates(
  db: PrismaClient,
  eventId: string,
  logLimit: number,
  timeZone: string,
): Promise<{
  totalAttendees: number;
  admittedCount: number;
  byHour: EventReportsResponse["by_hour"];
  by_ticket_type: EventReportsResponse["by_ticket_type"];
  admission_log: EventReportsResponse["admission_log"];
  peak_hour: string | null;
  peak_hour_count: number;
  ticketTypeCatalog: TicketTypeInfo[];
  by_rsvp_status: EventReportsResponse["by_rsvp_status"];
  by_checkin_method: EventReportsResponse["by_checkin_method"];
  by_device: EventReportsResponse["by_device"];
}> {
  const [
    totalAttendees,
    admittedCount,
    byHourRaw,
    byTypeTotal,
    byTypeAdmitted,
    logRows,
    catalog,
    byRsvpStatusRaw,
    byCheckinMethodRaw,
    byDeviceRaw,
  ] = await Promise.all([
      db.attendee.count({ where: { event_id: eventId } }),
      db.attendee.count({ where: { event_id: eventId, admitted_at: { not: null } } }),
      db.$queryRaw<Array<{ hour: string; count: bigint }>>`
        SELECT
          -- admitted_at is a naive TIMESTAMP storing UTC: the first AT TIME ZONE tags
          -- it as UTC, the second converts to the event timezone. A single AT TIME ZONE
          -- would *interpret* the naive value as event-local and shift every bucket.
          TO_CHAR(DATE_TRUNC('hour', (admitted_at AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'HH24:00') AS hour,
          COUNT(*)::bigint AS count
        FROM "Attendee"
        WHERE event_id = ${eventId} AND admitted_at IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `,
      db.attendee.groupBy({
        by: ["ticket_type"],
        where: { event_id: eventId },
        _count: { _all: true },
      }),
      db.attendee.groupBy({
        by: ["ticket_type"],
        where: { event_id: eventId, admitted_at: { not: null } },
        _count: { _all: true },
      }),
      db.attendee.findMany({
        where: { event_id: eventId, admitted_at: { not: null } },
        orderBy: { admitted_at: "asc" },
        take: logLimit,
        select: {
          id: true,
          name: true,
          email: true,
          ticket_type: true,
          admitted_at: true,
        },
      }),
      loadEventTicketTypes(db, eventId),
      db.attendee.groupBy({
        by: ["rsvp_status"],
        where: { event_id: eventId, admitted_at: { not: null } },
        _count: { _all: true },
      }),
      db.checkIn.groupBy({
        by: ["source"],
        where: { event_id: eventId, status: "VALID", source: { in: ["scan", "manual"] } },
        _count: { _all: true },
      }),
      db.checkIn.groupBy({
        by: ["device_id"],
        where: { event_id: eventId, status: "VALID", source: { in: ["scan", "manual"] } },
        _count: { _all: true },
      }),
    ]);

  const byHour = buildByHour(byHourRaw);
  const { peak_hour, peak_hour_count } = resolvePeakHour(byHour, admittedCount);

  const totalByType = mergeTicketTypeCounts(byTypeTotal);
  const admittedByType = mergeTicketTypeCounts(byTypeAdmitted);

  const by_ticket_type: EventReportsResponse["by_ticket_type"] = catalog.map((t) => {
    const total = totalByType.get(t.key) ?? 0;
    const admitted = admittedByType.get(t.key) ?? 0;
    return { key: t.key, type: t.label, color: t.color, total, admitted, admission_pct: oneDecimalPct(admitted, total) };
  });
  // Every write path that sets ticket_type (create, patch, import, the backfill's blank-value
  // cleanup) normalizes an empty/whitespace submission to null before persisting - resolveTicketTypeLabel
  // (used by CSV/PDF export, above) already treats both the same way. A literal "" could still
  // reach here from data written outside those paths, so it's folded into the same (none) bucket
  // here too, instead of becoming its own confusing "" (not in catalog) entry below.
  const noneTotal = (totalByType.get(null) ?? 0) + (totalByType.get("") ?? 0);
  if (noneTotal > 0) {
    const noneAdmitted = (admittedByType.get(null) ?? 0) + (admittedByType.get("") ?? 0);
    by_ticket_type.push({
      key: null,
      type: "(none)",
      color: "gray",
      total: noneTotal,
      admitted: noneAdmitted,
      admission_pct: oneDecimalPct(noneAdmitted, noneTotal),
    });
  }

  const catalogKeys = new Set(catalog.map((t) => t.key));
  const unmatchedKeys = [...totalByType.keys()]
    .filter((key): key is string => key !== null && key !== "" && !catalogKeys.has(key))
    .sort((a, b) => a.localeCompare(b));
  for (const key of unmatchedKeys) {
    const total = totalByType.get(key) ?? 0;
    const admitted = admittedByType.get(key) ?? 0;
    by_ticket_type.push({
      key,
      type: `${key} (not in catalog)`,
      color: "gray",
      total,
      admitted,
      admission_pct: oneDecimalPct(admitted, total),
    });
  }

  const attendeeIds = logRows.map((row) => row.id);
  const [deviceByAttendee, itemsByAttendee] = await Promise.all([
    loadDeviceIdsByAttendee(db, eventId, attendeeIds),
    loadIssuedItemLabelsByAttendee(db, eventId, attendeeIds),
  ]);

  const admission_log = logRows.map((row) =>
    mapAdmissionLogRow(row as AdmittedRow, deviceByAttendee, itemsByAttendee),
  );

  const by_rsvp_status = byRsvpStatusRaw.map((row) => ({
    status: row.rsvp_status,
    count: row._count._all,
  }));
  const by_checkin_method = byCheckinMethodRaw.map((row) => ({
    method: row.source!,
    count: row._count._all,
  }));
  // Ranked by count descending; ties broken by device_id ascending (Postgres's GROUP BY row
  // order isn't guaranteed) - the "(unlabeled device)" null bucket sorts last on a tie.
  const by_device = byDeviceRaw
    .map((row) => ({ device_id: row.device_id, count: row._count._all }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.device_id === null) return 1;
      if (b.device_id === null) return -1;
      return a.device_id.localeCompare(b.device_id);
    });

  return {
    totalAttendees,
    admittedCount,
    byHour,
    by_ticket_type,
    admission_log,
    ticketTypeCatalog: catalog,
    peak_hour,
    peak_hour_count,
    by_rsvp_status,
    by_checkin_method,
    by_device,
  };
}

/** Security headers for printable HTML report export (inline styles only; no scripts). */
export function getPrintableReportSecurityHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'",
  };
}

/** Format admitted_at for CSV/PDF export in the event timezone (YYYY-MM-DD HH:mm). */
function formatAdmittedAtExport(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(",", "");
}

function quoteCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Append bulk audit row after a successful reports export (CSV or printable HTML). */
async function auditReportsExported(
  db: PrismaClient,
  c: Context,
  eventId: string,
  format: "csv" | "pdf",
  count: number,
  truncated: boolean,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "reports_exported",
      audit: adminAuditFromContext(c),
      metadata: { format, count, truncated },
    });
  });
}

/** GET /api/admin/events/:eventId/reports — aggregated admission stats (read-only, no audit). */
export async function handleGetReports(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, date: true, capacity: true, timezone: true },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const timeZone = resolvePreviewEventTimeZone(event.timezone);
  const aggregates = await loadReportsAggregates(db, eventId, ADMISSION_LOG_LIMIT, timeZone);

  const body: EventReportsResponse = {
    timezone: timeZone,
    event: {
      id: event.id,
      title: event.title,
      date: event.date.toISOString(),
      capacity: event.capacity,
    },
    summary: {
      total_attendees: aggregates.totalAttendees,
      admitted: aggregates.admittedCount,
      no_shows: aggregates.totalAttendees - aggregates.admittedCount,
      admission_rate_pct: oneDecimalPct(aggregates.admittedCount, aggregates.totalAttendees),
      peak_hour: aggregates.peak_hour,
      peak_hour_count: aggregates.peak_hour_count,
    },
    by_hour: aggregates.byHour,
    by_ticket_type: aggregates.by_ticket_type,
    admission_log: aggregates.admission_log,
    admission_log_truncated: aggregates.admittedCount > ADMISSION_LOG_LIMIT,
    admission_log_total: aggregates.admittedCount,
    by_rsvp_status: aggregates.by_rsvp_status,
    by_checkin_method: aggregates.by_checkin_method,
    by_device: aggregates.by_device,
  };

  return c.json(body);
}

/** GET /api/admin/events/:eventId/reports/export?format=csv|pdf */
export async function handleExportReports(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdParam = requireEventId(c);
  if (eventIdParam instanceof Response) return eventIdParam;
  const eventId = eventIdParam;

  const formatRaw = c.req.query("format") ?? "csv";
  if (formatRaw !== "csv" && formatRaw !== "pdf") {
    return c.json({ error: "format must be csv or pdf" }, 400);
  }

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, date: true, slug: true, capacity: true, timezone: true },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const timeZone = resolvePreviewEventTimeZone(event.timezone);

  const dateStamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");

  if (formatRaw === "csv") {
    const [totalAdmitted, rows, catalog] = await Promise.all([
      db.attendee.count({ where: { event_id: eventId, admitted_at: { not: null } } }),
      db.attendee.findMany({
        where: { event_id: eventId, admitted_at: { not: null } },
        orderBy: { admitted_at: "asc" },
        take: CSV_EXPORT_MAX,
        select: {
          id: true,
          name: true,
          email: true,
          ticket_type: true,
          admitted_at: true,
        },
      }),
      loadEventTicketTypes(db, eventId),
    ]);

    const truncated = totalAdmitted > CSV_EXPORT_MAX;

    const attendeeIds = rows.map((row) => row.id);
    const [deviceByAttendee, itemsByAttendee] = await Promise.all([
      loadDeviceIdsByAttendee(db, eventId, attendeeIds),
      loadIssuedItemLabelsByAttendee(db, eventId, attendeeIds),
    ]);

    const admittedAtHeader = `Admitted at (${timeZone})`;
    const header = ["Name", "Email", "Ticket type", admittedAtHeader, "Device", "Items"]
      .map((col) => quoteCsvCell(col))
      .join(",");
    const dataRows = rows.map((row) =>
      [
        row.name,
        row.email,
        resolveTicketTypeLabel(catalog, row.ticket_type),
        formatAdmittedAtExport(row.admitted_at!, timeZone),
        deviceByAttendee.get(row.id) ?? "",
        (itemsByAttendee.get(row.id) ?? []).join(", "),
      ]
        .map((cell) => quoteCsvCell(sanitizeCsvCell(String(cell))))
        .join(","),
    );

    const truncationNotice = truncated
      ? [
          quoteCsvCell(
            sanitizeCsvCell(
              `Export truncated: first ${CSV_EXPORT_MAX} of ${totalAdmitted} admissions.`,
            ),
          ),
          quoteCsvCell(""),
          quoteCsvCell(""),
          quoteCsvCell(""),
          quoteCsvCell(""),
          quoteCsvCell(""),
        ].join(",")
      : null;

    const csvBody = [header, ...(truncationNotice ? [truncationNotice] : []), ...dataRows].join(
      "\r\n",
    );
    const bom = "\uFEFF";
    const filename = `admissions-${event.slug}-${dateStamp}.csv`;

    await auditReportsExported(db, c, eventId, "csv", rows.length, truncated);

    return new Response(bom + csvBody, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": attachmentContentDisposition(filename),
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "X-Admission-Log-Total": String(totalAdmitted),
        "X-Admission-Log-Truncated": String(truncated),
      },
    });
  }

  const aggregates = await loadReportsAggregates(db, eventId, PDF_LOG_MAX, timeZone);
  const eventDate = event.date.toISOString().slice(0, 10);

  const typeRows = aggregates.by_ticket_type
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.type)}</td><td>${t.admitted}</td><td>${t.total}</td><td>${t.admission_pct}%</td></tr>`,
    )
    .join("");

  const logRows = aggregates.admission_log
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(resolveTicketTypeLabel(aggregates.ticketTypeCatalog, r.ticket_type))}</td><td>${escapeHtml(formatAdmittedAtExport(new Date(r.admitted_at), timeZone))}</td><td>${escapeHtml(r.device_id ?? "—")}</td><td>${escapeHtml(r.items.join(", ") || "—")}</td></tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(event.title)} — Admission report</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
    h1 { margin-bottom: 0.25rem; }
    .meta { color: #555; margin-bottom: 1.5rem; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .stat { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
    .stat strong { display: block; font-size: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; font-size: 0.875rem; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
    th { background: #f5f5f5; }
    .print-hint { background: #fff8e6; border: 1px solid #f0d78c; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1.5rem; }
    @media print {
      .print-hint, .no-print { display: none; }
      body { margin: 0.5in; }
    }
  </style>
</head>
<body>
  <p class="print-hint no-print">Use your browser&rsquo;s <strong>Print</strong> dialog and choose &ldquo;Save as PDF&rdquo; to export this report.</p>
  <h1>${escapeHtml(event.title)}</h1>
  <p class="meta">Event date: ${escapeHtml(eventDate)} · Times in ${escapeHtml(timeZone)} · Generated ${escapeHtml(new Date().toISOString())}</p>
  <div class="stats">
    <div class="stat"><span>Total attendees</span><strong>${aggregates.totalAttendees}</strong></div>
    <div class="stat"><span>Admitted</span><strong>${aggregates.admittedCount}</strong></div>
    <div class="stat"><span>No-shows</span><strong>${aggregates.totalAttendees - aggregates.admittedCount}</strong></div>
    <div class="stat"><span>Admission rate</span><strong>${oneDecimalPct(aggregates.admittedCount, aggregates.totalAttendees)}%</strong></div>
  </div>
  <h2>By ticket type</h2>
  <table>
    <thead><tr><th>Type</th><th>Admitted</th><th>Total</th><th>Rate</th></tr></thead>
    <tbody>${typeRows || '<tr><td colspan="4">No attendees</td></tr>'}</tbody>
  </table>
  <h2>Admission log${aggregates.admittedCount > PDF_LOG_MAX ? ` (first ${PDF_LOG_MAX} of ${aggregates.admittedCount})` : ""}</h2>
  <table>
    <thead><tr><th>Name</th><th>Email</th><th>Ticket type</th><th>Admitted at</th><th>Device</th><th>Items</th></tr></thead>
    <tbody>${logRows || '<tr><td colspan="6">No admissions yet</td></tr>'}</tbody>
  </table>
</body>
</html>`;

  await auditReportsExported(
    db,
    c,
    eventId,
    "pdf",
    aggregates.admittedCount,
    aggregates.admittedCount > PDF_LOG_MAX,
  );

  return new Response(html, {
    status: 200,
    headers: getPrintableReportSecurityHeaders(),
  });
}
