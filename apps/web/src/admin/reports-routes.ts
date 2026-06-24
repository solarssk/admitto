import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import { writeBulkActionLog } from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";

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
  by_ticket_type: Array<{
    type: string;
    total: number;
    admitted: number;
    admission_pct: number;
  }>;
  admission_log: Array<{
    attendee_id: string;
    name: string;
    email: string;
    ticket_type: string;
    admitted_at: string;
    device_id: string | null;
  }>;
  admission_log_truncated: boolean;
  admission_log_total: number;
}

function ticketTypeLabel(raw: string | null): string {
  return raw?.trim() ? raw.trim() : "(none)";
}

function oneDecimalPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function mergeTicketTypeCounts(
  rows: Array<{ ticket_type: string | null; _count: { _all: number } }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const type = ticketTypeLabel(row.ticket_type);
    map.set(type, (map.get(type) ?? 0) + row._count._all);
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
): EventReportsResponse["admission_log"][number] {
  return {
    attendee_id: row.id,
    name: row.name,
    email: row.email,
    ticket_type: ticketTypeLabel(row.ticket_type),
    admitted_at: row.admitted_at.toISOString(),
    device_id: deviceByAttendee.get(row.id) ?? null,
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
}> {
  const [totalAttendees, admittedCount, byHourRaw, byTypeTotal, byTypeAdmitted, logRows] =
    await Promise.all([
      db.attendee.count({ where: { event_id: eventId } }),
      db.attendee.count({ where: { event_id: eventId, admitted_at: { not: null } } }),
      db.$queryRaw<Array<{ hour: string; count: bigint }>>`
        SELECT
          TO_CHAR(DATE_TRUNC('hour', admitted_at AT TIME ZONE ${timeZone}), 'HH24:00') AS hour,
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
    ]);

  const byHour = buildByHour(byHourRaw);
  const { peak_hour, peak_hour_count } = resolvePeakHour(byHour, admittedCount);

  const totalByType = mergeTicketTypeCounts(byTypeTotal);
  const admittedByType = mergeTicketTypeCounts(byTypeAdmitted);

  const by_ticket_type: EventReportsResponse["by_ticket_type"] = [...totalByType.entries()]
    .map(([type, total]) => {
      const admitted = admittedByType.get(type) ?? 0;
      return {
        type,
        total,
        admitted,
        admission_pct: oneDecimalPct(admitted, total),
      };
    })
    .sort((a, b) => b.total - a.total);

  const deviceByAttendee = await loadDeviceIdsByAttendee(
    db,
    eventId,
    logRows.map((row) => row.id),
  );

  const admission_log = logRows.map((row) =>
    mapAdmissionLogRow(row as AdmittedRow, deviceByAttendee),
  );

  return {
    totalAttendees,
    admittedCount,
    byHour,
    by_ticket_type,
    admission_log,
    peak_hour,
    peak_hour_count,
  };
}

function sanitizeCsvCell(value: string | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/^[=+\-@\t\r\n]/.test(s)) return `'${s}`;
  return s;
}

function quoteCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function exportContentDisposition(filename: string): string {
  const safeFilename = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `attachment; filename="${safeFilename}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    select: { id: true, title: true, date: true, capacity: true },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const timeZone = resolvePreviewEventTimeZone();
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
    select: { id: true, title: true, date: true, slug: true, capacity: true },
  });
  if (!event) return c.json({ error: "not_found" }, 404);

  const timeZone = resolvePreviewEventTimeZone();

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  if (formatRaw === "csv") {
    const rows = await db.attendee.findMany({
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
    });

    const deviceByAttendee = await loadDeviceIdsByAttendee(
      db,
      eventId,
      rows.map((row) => row.id),
    );

    const header = ["Name", "Email", "Ticket type", "Admitted at", "Device"]
      .map((col) => quoteCsvCell(col))
      .join(",");
    const dataRows = rows.map((row) =>
      [
        row.name,
        row.email,
        ticketTypeLabel(row.ticket_type),
        row.admitted_at!.toISOString(),
        deviceByAttendee.get(row.id) ?? "",
      ]
        .map((cell) => quoteCsvCell(sanitizeCsvCell(String(cell))))
        .join(","),
    );

    const csvBody = [header, ...dataRows].join("\r\n");
    const bom = "\uFEFF";
    const filename = `admissions-${event.slug}-${dateStamp}.csv`;

    const totalAdmitted = await db.attendee.count({
      where: { event_id: eventId, admitted_at: { not: null } },
    });
    await auditReportsExported(db, c, eventId, "csv", rows.length, totalAdmitted > CSV_EXPORT_MAX);

    return new Response(bom + csvBody, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": exportContentDisposition(filename),
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
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
        `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.ticket_type)}</td><td>${escapeHtml(r.admitted_at)}</td><td>${escapeHtml(r.device_id ?? "—")}</td></tr>`,
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
  <p class="meta">Event date: ${escapeHtml(eventDate)} · Generated ${escapeHtml(new Date().toISOString())}</p>
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
  <h2>Admission log${aggregates.admittedCount > PDF_LOG_MAX ? ` (first ${PDF_LOG_MAX})` : ""}</h2>
  <table>
    <thead><tr><th>Name</th><th>Email</th><th>Ticket type</th><th>Admitted at</th><th>Device</th></tr></thead>
    <tbody>${logRows || '<tr><td colspan="5">No admissions yet</td></tr>'}</tbody>
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
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
