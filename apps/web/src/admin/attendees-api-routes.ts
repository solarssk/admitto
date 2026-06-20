import { createRequire } from "node:module";
import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  listDeliveries,
  resendTicketEmail,
  toDeliveryDto,
  type DeliveryDto,
  type MailDeliveryDeps,
} from "@admitto/mail-delivery";
import { formatEventDate, resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import {
  collectEventCustomDataFields,
  customDataValue,
  parseCustomData,
  writeActionLog,
  writeBulkActionLog,
  type EventItemContent,
} from "@admitto/tickets";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  positiveIntQuery,
  requireEventId,
} from "./admin-helpers.js";
import { optimisticAttendeeUpdate, StaleWriteError, isStaleWrite } from "./optimistic-update.js";

const ATTENDEE_LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  company: true,
  department: true,
  custom_data: true,
  ticket_type: true,
  admitted_at: true,
} as const;

const ATTENDEE_DETAIL_SELECT = {
  id: true,
  name: true,
  email: true,
  company: true,
  department: true,
  ticket_type: true,
  status: true,
  admitted_at: true,
  custom_data: true,
  updated_at: true,
} as const;

const patchAttendeeFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(254).optional(),
    company: z.string().trim().max(200).optional().nullable(),
    department: z.string().trim().max(200).optional().nullable(),
    ticket_type: z.string().trim().max(100).optional().nullable(),
    custom_data_fields: z
      .record(
        z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(/^[a-z0-9_]+$/),
        z.string().trim().max(100).nullable(),
      )
      .optional(),
  })
  .strict();

const patchAttendeeSchema = patchAttendeeFieldsSchema.extend({
  // Optional at parse time; required in handler when computePatchChanges finds a real delta (no-op exempt).
  expected_updated_at: z.string().datetime({ offset: true }).optional(),
});

const resendBodySchema = z
  .object({
    to: z.string().trim().email().optional(),
  })
  .strict();

const EXPORT_ROW_CAP = 50_000;

/** Fixed column headers for XLSX/PDF export (includes check-off). Attribute columns appended at runtime. */
const EXPORT_BASE_COLUMNS = [
  "✓",
  "Name",
  "Email",
  "Company",
  "Department",
  "Ticket type",
  "Check-in status",
  "Admitted at",
] as const;

const EXPORT_BASE_PDF_WIDTHS = [22, 85, 100, 75, 70, 65, 75, 80] as const;
const EXPORT_ATTRIBUTE_PDF_WIDTH = 55;
/** Printable width on A4 landscape with 40pt side margins (pdfkit default). */
const PDF_PRINTABLE_WIDTH = 762;

if (EXPORT_BASE_PDF_WIDTHS.length !== EXPORT_BASE_COLUMNS.length) {
  throw new Error("EXPORT_BASE_PDF_WIDTHS must match EXPORT_BASE_COLUMNS length");
}

const EXPORT_ATTENDEE_SELECT = {
  name: true,
  email: true,
  company: true,
  department: true,
  custom_data: true,
  ticket_type: true,
  admitted_at: true,
} as const;

type SanitizedExportRow = {
  check_off: string;
  name: string;
  email: string;
  company: string;
  department: string;
  ticket_type: string;
  check_in_status: string;
  admitted_at: string;
  attribute_values: string[];
};

type AttendeeListFilterParams = {
  q?: string;
  status: "all" | "admitted" | "not_admitted";
  ticket_type?: string;
};

/** Format admitted_at for export in the event default timezone (YYYY-MM-DD HH:mm). */
function formatAdmittedAtLocal(date: Date, timeZone: string): string {
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

/** Guard against CSV/formula injection — prefix cells starting with = + - @ TAB CR. */
function sanitizeCell(value: string | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

/** RFC 4180 CSV field quoting (escape embedded double quotes). */
function quoteCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** RFC 6266 attachment header with `"` escaped in the filename. */
function exportContentDisposition(filename: string): string {
  const safeFilename = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `attachment; filename="${safeFilename}"`;
}

/** Build CSV text for sanitized export rows (CRLF, quoted fields). */
function buildExportCsv(exportRows: SanitizedExportRow[], exportColumns: string[]): string {
  const csvColumns = exportColumns.slice(1);
  const header = csvColumns.map(quoteCsvCell).join(",");
  const csvRows = exportRows.map((r) =>
    [
      r.name,
      r.email,
      r.company,
      r.department,
      r.ticket_type,
      r.check_in_status,
      r.admitted_at,
      ...r.attribute_values,
    ]
      .map(quoteCsvCell)
      .join(","),
  );
  return [header, ...csvRows].join("\r\n");
}

/** Build Prisma where for attendee list and export (status/ticket_type only — no search). */
function buildAttendeeListWhere(
  eventId: string,
  params: AttendeeListFilterParams,
): Prisma.AttendeeWhereInput {
  const { status, ticket_type } = params;
  return {
    event_id: eventId,
    ...(status === "admitted" ? { admitted_at: { not: null } } : {}),
    ...(status === "not_admitted" ? { admitted_at: null } : {}),
    ...(ticket_type ? { ticket_type } : {}),
  };
}

function attendeeStatusSql(status: AttendeeListFilterParams["status"]) {
  if (status === "admitted") return Prisma.sql`AND admitted_at IS NOT NULL`;
  if (status === "not_admitted") return Prisma.sql`AND admitted_at IS NULL`;
  return Prisma.empty;
}

function attendeeTicketTypeSql(ticket_type?: string) {
  return ticket_type ? Prisma.sql`AND ticket_type = ${ticket_type}` : Prisma.empty;
}

/** Search OR (columns + custom_data json), inlined in SQL — no id materialization. */
function attendeeSearchOrSql(q: string) {
  const pattern = `%${q}%`;
  return Prisma.sql`AND (
    name ILIKE ${pattern}
    OR email ILIKE ${pattern}
    OR company ILIKE ${pattern}
    OR department ILIKE ${pattern}
    OR (custom_data->>'company') ILIKE ${pattern}
    OR (custom_data->>'department') ILIKE ${pattern}
  )`;
}

async function countFilteredAttendees(
  db: PrismaClient,
  eventId: string,
  params: AttendeeListFilterParams,
): Promise<number> {
  const { q, status, ticket_type } = params;
  if (!q) {
    return db.attendee.count({ where: buildAttendeeListWhere(eventId, params) });
  }
  const [{ count }] = await db.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count FROM "Attendee"
    WHERE event_id = ${eventId}
      ${attendeeStatusSql(status)}
      ${attendeeTicketTypeSql(ticket_type)}
      ${attendeeSearchOrSql(q)}
  `;
  return Number(count);
}

type AttendeeListSqlRow = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  custom_data: unknown;
  ticket_type: string | null;
  admitted_at: Date | null;
};

async function findFilteredAttendeesForList(
  db: PrismaClient,
  eventId: string,
  params: AttendeeListFilterParams,
  page: number,
  pageSize: number,
): Promise<AttendeeListSqlRow[]> {
  const { q, status, ticket_type } = params;
  if (!q) {
    return db.attendee.findMany({
      where: buildAttendeeListWhere(eventId, params),
      select: ATTENDEE_LIST_SELECT,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }
  const skip = (page - 1) * pageSize;
  return db.$queryRaw<AttendeeListSqlRow[]>`
    SELECT id, name, email, company, department, custom_data, ticket_type, admitted_at
    FROM "Attendee"
    WHERE event_id = ${eventId}
      ${attendeeStatusSql(status)}
      ${attendeeTicketTypeSql(ticket_type)}
      ${attendeeSearchOrSql(q)}
    ORDER BY name ASC
    LIMIT ${pageSize} OFFSET ${skip}
  `;
}

type ExportAttendeeSqlRow = {
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  custom_data: unknown;
  ticket_type: string | null;
  admitted_at: Date | null;
};

async function findFilteredAttendeesForExport(
  db: PrismaClient,
  eventId: string,
  params: AttendeeListFilterParams,
): Promise<ExportAttendeeSqlRow[]> {
  const { q, status, ticket_type } = params;
  if (!q) {
    return db.attendee.findMany({
      where: buildAttendeeListWhere(eventId, params),
      select: EXPORT_ATTENDEE_SELECT,
      orderBy: { name: "asc" },
    });
  }
  return db.$queryRaw<ExportAttendeeSqlRow[]>`
    SELECT name, email, company, department, custom_data, ticket_type, admitted_at
    FROM "Attendee"
    WHERE event_id = ${eventId}
      ${attendeeStatusSql(status)}
      ${attendeeTicketTypeSql(ticket_type)}
      ${attendeeSearchOrSql(q)}
    ORDER BY name ASC
    LIMIT ${EXPORT_ROW_CAP}
  `;
}

/** Build XLSX bytes for sanitized export rows (dynamic exceljs import, ESM-safe). */
async function buildExportXlsxBuffer(
  exportRows: SanitizedExportRow[],
  exportColumns: string[],
): Promise<Uint8Array> {
  const exceljs = await import("exceljs");
  const ExcelJS = exceljs.default ?? exceljs;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Attendees");
  ws.columns = exportColumns.map((h, i) => ({
    header: h,
    width: i === 0 ? 5 : 28,
  }));
  for (const r of exportRows) {
    const row = ws.addRow([
      r.check_off,
      r.name,
      r.email,
      r.company,
      r.department,
      r.ticket_type,
      r.check_in_status,
      r.admitted_at,
      ...r.attribute_values,
    ]);
    row.getCell(1).alignment = { horizontal: "center" };
  }
  ws.pageSetup = {
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    orientation: "landscape",
    paperSize: 9,
  };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const PDF_ROW_HEIGHT = 16;
const PDF_FONT_SIZE = 8;
const PDF_PAGE_BOTTOM = 555;
const PDF_FONT = "DejaVuSans";
const PDF_FONT_BOLD = "DejaVuSans-Bold";

const PDF_MIN_COLUMN_WIDTH = 20;

function sumPdfColumnWidths(widths: number[]): number {
  return widths.reduce((sum, w) => sum + w, 0);
}

/** Scale columns down proportionally when rounding pushed the layout past the printable width. */
function scalePdfColumnWidths(widths: number[], maxTotal: number): number[] {
  const total = sumPdfColumnWidths(widths);
  if (total <= maxTotal) return widths;
  const scale = maxTotal / total;
  return widths.map((w) => Math.max(PDF_MIN_COLUMN_WIDTH, Math.floor(w * scale)));
}

function buildExportPdfColumnWidths(attributeFieldCount: number): number[] {
  const base = [...EXPORT_BASE_PDF_WIDTHS];
  if (attributeFieldCount === 0) return base;

  const minAttrWidth = 28;
  const baseTotal = sumPdfColumnWidths(base);
  const defaultTotal = baseTotal + attributeFieldCount * EXPORT_ATTRIBUTE_PDF_WIDTH;

  if (defaultTotal <= PDF_PRINTABLE_WIDTH) {
    return [...base, ...Array.from({ length: attributeFieldCount }, () => EXPORT_ATTRIBUTE_PDF_WIDTH)];
  }

  const spaceForAttrs = PDF_PRINTABLE_WIDTH - baseTotal;
  if (spaceForAttrs >= attributeFieldCount * minAttrWidth) {
    const attrWidth = Math.floor(spaceForAttrs / attributeFieldCount);
    return [...base, ...Array.from({ length: attributeFieldCount }, () => attrWidth)];
  }

  const attrWidth = minAttrWidth;
  const targetBaseTotal = PDF_PRINTABLE_WIDTH - attributeFieldCount * minAttrWidth;
  const scaledBase =
    targetBaseTotal > 0
      ? base.map((w) =>
          Math.max(PDF_MIN_COLUMN_WIDTH, Math.floor((w * targetBaseTotal) / baseTotal)),
        )
      : base;

  return scalePdfColumnWidths(
    [...scaledBase, ...Array.from({ length: attributeFieldCount }, () => attrWidth)],
    PDF_PRINTABLE_WIDTH,
  );
}

const require = createRequire(import.meta.url);

function resolvePdfFontFile(bold: boolean): string {
  const file = bold ? "DejaVuSans-Bold.ttf" : "DejaVuSans.ttf";
  return require.resolve(`dejavu-fonts-ttf/ttf/${file}`);
}

/** Build PDF bytes for export rows (dynamic pdfkit import, ESM-safe). */
async function buildExportPdfBuffer(
  exportRows: SanitizedExportRow[],
  exportColumns: string[],
  eventMeta: { title: string; date: Date },
  timeZone: string,
): Promise<Uint8Array> {
  const pdfColWidths = buildExportPdfColumnWidths(exportColumns.length - EXPORT_BASE_COLUMNS.length);
  const pdfkitMod = await import("pdfkit");
  const PDFDocument = pdfkitMod.default ?? pdfkitMod;

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40 });
  doc.registerFont(PDF_FONT, resolvePdfFontFile(false));
  doc.registerFont(PDF_FONT_BOLD, resolvePdfFontFile(true));
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const eventDateStr = formatEventDate(eventMeta.date, timeZone);
  doc.fontSize(14).font(PDF_FONT_BOLD).text(`${eventMeta.title} — ${eventDateStr}`);
  doc.moveDown(0.5);

  let y = doc.y;

  const drawTableHeader = () => {
    doc.fontSize(PDF_FONT_SIZE).font(PDF_FONT_BOLD);
    let x = 40;
    for (let i = 0; i < exportColumns.length; i++) {
      doc.text(exportColumns[i]!, x, y, { width: pdfColWidths[i], lineBreak: false });
      x += pdfColWidths[i]!;
    }
    y += PDF_ROW_HEIGHT;
    doc.font(PDF_FONT);
  };

  drawTableHeader();

  for (const row of exportRows) {
    if (y + PDF_ROW_HEIGHT > PDF_PAGE_BOTTOM) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
      y = 40;
      drawTableHeader();
    }
    const cells = [
      row.check_off,
      row.name,
      row.email,
      row.company,
      row.department,
      row.ticket_type,
      row.check_in_status,
      row.admitted_at,
      ...row.attribute_values,
    ];
    doc.fontSize(PDF_FONT_SIZE);
    let x = 40;
    for (let i = 0; i < cells.length; i++) {
      doc.text(cells[i] ?? "", x, y, { width: pdfColWidths[i], lineBreak: false, ellipsis: true });
      x += pdfColWidths[i]!;
    }
    y += PDF_ROW_HEIGHT;
  }

  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });
  doc.end();
  await done;

  return new Uint8Array(Buffer.concat(chunks));
}

/** Append bulk audit row after a successful filtered export (no raw search term). */
async function auditAttendeesExported(
  db: PrismaClient,
  c: Context,
  eventId: string,
  format: "xlsx" | "csv" | "pdf",
  count: number,
  filters: { status: string; ticket_type?: string; has_query: boolean },
): Promise<void> {
  await db.$transaction(async (tx) => {
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "attendees_exported",
      audit: adminAuditFromContext(c),
      metadata: {
        format,
        count,
        filters: {
          status: filters.status,
          ticket_type: filters.ticket_type ?? null,
          has_query: filters.has_query,
        },
      },
    });
  });
}

export type AttendeeRowDto = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  ticket_type: string | null;
  check_in_status: "admitted" | "not_admitted";
  last_mail_status: string | null;
};

export type AttendeeDetailDto = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  status: string;
  check_in_status: "admitted" | "not_admitted";
  admitted_at: string | null;
  updated_at: string;
  custom_data: unknown;
  deliveries: DeliveryDto[];
};

/** Map admitted_at to API check-in status for list/detail DTOs. */
function checkInStatus(admittedAt: Date | null): "admitted" | "not_admitted" {
  return admittedAt ? "admitted" : "not_admitted";
}

/** Resolve company/department from custom_data with legacy column fallback (operator parity). */
function resolveCompanyDepartment(attendee: {
  custom_data: unknown;
  company: string | null;
  department: string | null;
}): { company: string | null; department: string | null } {
  const cd = parseCustomData(attendee.custom_data);
  return {
    company: cd.company ?? attendee.company,
    department: cd.department ?? attendee.department,
  };
}

/** Clone custom_data JSON for partial updates without dropping unknown keys. */
function cloneCustomData(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

/** Load dynamic custom_data attribute definitions for an event (all items, enabled or not). */
async function loadEventCustomDataFields(
  db: PrismaClient,
  eventId: string,
): Promise<EventItemContent[]> {
  const items = await db.eventItem.findMany({
    where: { event_id: eventId },
    select: { config: true },
    orderBy: { key: "asc" },
  });
  return collectEventCustomDataFields(items.map((i) => i.config));
}

function buildSanitizedExportRows(
  rows: ExportAttendeeSqlRow[],
  attributeFields: EventItemContent[],
  timeZone: string,
): SanitizedExportRow[] {
  return rows.map((row) => {
    const { company, department } = resolveCompanyDepartment(row);
    return {
      check_off: "",
      name: sanitizeCell(row.name),
      email: sanitizeCell(row.email),
      company: sanitizeCell(company),
      department: sanitizeCell(department),
      ticket_type: sanitizeCell(row.ticket_type),
      check_in_status: row.admitted_at ? "admitted" : "not_admitted",
      admitted_at: row.admitted_at ? formatAdmittedAtLocal(row.admitted_at, timeZone) : "",
      attribute_values: attributeFields.map((field) =>
        sanitizeCell(customDataValue(row.custom_data, field.source_field)),
      ),
    };
  });
}

function buildExportColumnLabels(attributeFields: EventItemContent[]): string[] {
  const labelCounts = new Map<string, number>();
  for (const field of attributeFields) {
    labelCounts.set(field.label, (labelCounts.get(field.label) ?? 0) + 1);
  }
  return attributeFields.map((field) => {
    const label =
      (labelCounts.get(field.label) ?? 0) > 1
        ? `${field.label} (${field.source_field})`
        : field.label;
    return sanitizeCell(label);
  });
}

function buildExportColumns(attributeFields: EventItemContent[]): string[] {
  return [...EXPORT_BASE_COLUMNS, ...buildExportColumnLabels(attributeFields)];
}

/** Require `:id` attendee route param or return 400. */
function requireAttendeeId(c: Context): string | Response {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "id required" }, 400);
  return id;
}

/** Load attendee scoped to event; null when missing or cross-event (caller returns 403). */
async function loadAttendeeInEvent(
  db: PrismaClient,
  eventId: string,
  attendeeId: string,
) {
  const row = await db.attendee.findUnique({
    where: { id: attendeeId },
    select: { ...ATTENDEE_DETAIL_SELECT, event_id: true },
  });
  if (!row || row.event_id !== eventId) return null;
  return row;
}

/** Parse and clamp list query params (`page`, `pageSize`, `q`, `status`, `ticket_type`). */
function parseListQuery(c: Context): {
  page: number;
  pageSize: number;
  q?: string;
  status: "all" | "admitted" | "not_admitted";
  ticket_type?: string;
} {
  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 100);
  const qRaw = c.req.query("q")?.trim();
  const q = qRaw ? qRaw : undefined;
  const statusRaw = c.req.query("status") ?? "all";
  const status =
    statusRaw === "admitted" || statusRaw === "not_admitted" ? statusRaw : "all";
  const ticketTypeRaw = c.req.query("ticket_type")?.trim();
  const ticket_type = ticketTypeRaw ? ticketTypeRaw : undefined;
  return { page, pageSize, q, status, ticket_type };
}

/** Latest email delivery status per attendee id (one entry per id). */
async function lastMailStatusByAttendee(
  db: PrismaClient,
  attendeeIds: string[],
): Promise<Map<string, string>> {
  if (attendeeIds.length === 0) return new Map();

  const deliveries = await db.emailDelivery.findMany({
    where: { attendee_id: { in: attendeeIds } },
    select: { attendee_id: true, status: true },
    orderBy: { created_at: "desc" },
  });

  const map = new Map<string, string>();
  for (const row of deliveries) {
    if (!map.has(row.attendee_id)) {
      map.set(row.attendee_id, row.status);
    }
  }
  return map;
}

/** Serialize a list row with derived check-in and last-mail status. */
function serializeAttendeeRow(
  row: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    department: string | null;
    custom_data: unknown;
    ticket_type: string | null;
    admitted_at: Date | null;
  },
  lastMail: Map<string, string>,
): AttendeeRowDto {
  const { company } = resolveCompanyDepartment(row);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company,
    ticket_type: row.ticket_type,
    check_in_status: checkInStatus(row.admitted_at),
    last_mail_status: lastMail.get(row.id) ?? null,
  };
}

/** Build attendee detail DTO including delivery log (no token fields). */
async function buildAttendeeDetailDto(
  db: PrismaClient,
  eventId: string,
  row: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    department: string | null;
    ticket_type: string | null;
    status: string;
    admitted_at: Date | null;
    custom_data: unknown;
    updated_at: Date;
  },
): Promise<AttendeeDetailDto> {
  const { items: deliveries } = await listDeliveries(
    { eventId, filters: { attendeeId: row.id } },
    db,
  );
  const { company, department } = resolveCompanyDepartment(row);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company,
    department,
    ticket_type: row.ticket_type,
    status: row.status,
    check_in_status: checkInStatus(row.admitted_at),
    admitted_at: row.admitted_at ? row.admitted_at.toISOString() : null,
    updated_at: row.updated_at.toISOString(),
    custom_data: row.custom_data ?? null,
    deliveries: deliveries.map(toDeliveryDto),
  };
}

/** GET /api/admin/events/:eventId/attendees */
export async function handleListEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const { page, pageSize, q, status, ticket_type } = parseListQuery(c);

  const filterParams = { q, status, ticket_type };

  const [total, rows] = await Promise.all([
    countFilteredAttendees(db, eventId, filterParams),
    findFilteredAttendeesForList(db, eventId, filterParams, page, pageSize),
  ]);

  const lastMail = await lastMailStatusByAttendee(
    db,
    rows.map((r) => r.id),
  );

  return c.json({
    items: rows.map((r) => serializeAttendeeRow(r, lastMail)),
    total,
    page,
    pageSize,
  });
}

/** GET /api/admin/events/:eventId/attendees/ticket-types — distinct non-empty ticket_type labels. */
export async function handleListTicketTypes(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const rows = await db.attendee.findMany({
    where: { event_id: eventId, ticket_type: { not: null } },
    select: { ticket_type: true },
    distinct: ["ticket_type"],
    orderBy: { ticket_type: "asc" },
  });

  const types = rows
    .map((r) => r.ticket_type)
    .filter((t): t is string => t !== null && t.trim() !== "");

  return c.json({ types });
}

/** GET /api/admin/events/:eventId/attendees/export — filtered subset as XLSX, CSV, or PDF (no tokens). */
export async function handleExportAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const formatRaw = c.req.query("format");
  if (formatRaw !== "xlsx" && formatRaw !== "csv" && formatRaw !== "pdf") {
    return c.json({ error: "format must be xlsx, csv, or pdf" }, 400);
  }
  const format = formatRaw;

  const { q, status, ticket_type } = parseListQuery(c);
  const timeZone = resolvePreviewEventTimeZone();

  const filterParams = { q, status, ticket_type };

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { title: true, date: true },
  });

  if (!event) {
    return c.json({ error: "forbidden" }, 403);
  }

  const total = await countFilteredAttendees(db, eventId, filterParams);
  if (total > EXPORT_ROW_CAP) {
    return c.json({ error: "export_too_large", count: total, cap: EXPORT_ROW_CAP }, 400);
  }

  const [rows, attributeFields] = await Promise.all([
    findFilteredAttendeesForExport(db, eventId, filterParams),
    loadEventCustomDataFields(db, eventId),
  ]);

  const exportColumns = buildExportColumns(attributeFields);
  const exportRows = buildSanitizedExportRows(rows, attributeFields, timeZone);

  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `attendees-${eventId}-${timestamp}.${format}`;
  const auditFilters = { status, ticket_type, has_query: Boolean(q) };

  if (format === "csv") {
    const csv = buildExportCsv(exportRows, exportColumns);
    await auditAttendeesExported(db, c, eventId, format, exportRows.length, auditFilters);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": exportContentDisposition(filename),
      },
    });
  }

  if (format === "pdf") {
    const bytes = await buildExportPdfBuffer(
      exportRows,
      exportColumns,
      { title: event.title, date: event.date },
      timeZone,
    );
    await auditAttendeesExported(db, c, eventId, format, exportRows.length, auditFilters);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": exportContentDisposition(filename),
      },
    });
  }

  const bytes = await buildExportXlsxBuffer(exportRows, exportColumns);
  await auditAttendeesExported(db, c, eventId, format, exportRows.length, auditFilters);
  return new Response(bytes, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": exportContentDisposition(filename),
    },
  });
}

/** GET /api/admin/events/:eventId/attendees/:id */
export async function handleGetEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const row = await loadAttendeeInEvent(db, eventId, attendeeId);
  if (!row) return c.json({ error: "forbidden" }, 403);

  const dto = await buildAttendeeDetailDto(db, eventId, row);
  return c.json(dto);
}

type PatchInput = z.infer<typeof patchAttendeeFieldsSchema>;

/** Compute Prisma update payload and changed field names from a PATCH body. */
function computePatchChanges(
  existing: {
    name: string;
    email: string;
    company: string | null;
    department: string | null;
    ticket_type: string | null;
    custom_data: unknown;
  },
  patch: PatchInput,
): { data: Prisma.AttendeeUpdateInput; fields: string[] } | null {
  const fields: string[] = [];
  const data: Prisma.AttendeeUpdateInput = {};
  const resolved = resolveCompanyDepartment(existing);
  let customData: Record<string, unknown> | null = null;

  const touchCustomData = (): Record<string, unknown> => {
    if (!customData) customData = cloneCustomData(existing.custom_data);
    return customData;
  };

  if (patch.name !== undefined && patch.name !== existing.name) {
    data.name = patch.name;
    fields.push("name");
  }
  if (patch.email !== undefined && patch.email !== existing.email) {
    data.email = patch.email;
    fields.push("email");
  }
  if (patch.company !== undefined && patch.company !== resolved.company) {
    data.company = patch.company;
    const raw = touchCustomData();
    if (patch.company === null || patch.company === "") delete raw.company;
    else raw.company = patch.company;
    fields.push("company");
  }
  if (patch.department !== undefined && patch.department !== resolved.department) {
    data.department = patch.department;
    const raw = touchCustomData();
    if (patch.department === null || patch.department === "") delete raw.department;
    else raw.department = patch.department;
    fields.push("department");
  }
  if (patch.ticket_type !== undefined && patch.ticket_type !== existing.ticket_type) {
    data.ticket_type = patch.ticket_type;
    fields.push("ticket_type");
  }
  if (patch.custom_data_fields) {
    for (const [sourceField, next] of Object.entries(patch.custom_data_fields)) {
      const current = customDataValue(existing.custom_data, sourceField);
      const normalizedNext = next === null || next === "" ? null : next;
      if (normalizedNext !== current) {
        const raw = touchCustomData();
        if (normalizedNext === null) {
          delete raw[sourceField];
        } else {
          raw[sourceField] = normalizedNext;
        }
        fields.push(sourceField);
      }
    }
  }

  if (customData) {
    data.custom_data = customData as Prisma.InputJsonValue;
  }

  if (fields.length === 0) return null;
  return { data, fields };
}

/** PATCH /api/admin/events/:eventId/attendees/:id */
export async function handlePatchEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadAttendeeInEvent(db, eventId, attendeeId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = patchAttendeeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const { expected_updated_at: expectedUpdatedAtRaw, ...patchFields } = parsed.data;

  if (patchFields.custom_data_fields) {
    const allowedFields = await loadEventCustomDataFields(db, eventId);
    const allowed = new Set(allowedFields.map((f) => f.source_field));
    for (const key of Object.keys(patchFields.custom_data_fields)) {
      if (!allowed.has(key)) {
        return c.json({ error: "unknown_custom_data_field" }, 400);
      }
    }
  }

  const changes = computePatchChanges(existing, patchFields);
  if (!changes) {
    const dto = await buildAttendeeDetailDto(db, eventId, existing);
    return c.json(dto);
  }

  if (!expectedUpdatedAtRaw) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
  if (Number.isNaN(expectedUpdatedAt.getTime())) {
    return c.json({ error: "validation_failed" }, 400);
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const result = await optimisticAttendeeUpdate(tx, {
        id: attendeeId,
        expectedUpdatedAt,
        data: changes.data,
        select: ATTENDEE_DETAIL_SELECT,
      });

      // Fail fast before any other writes in this transaction.
      if (isStaleWrite(result)) throw new StaleWriteError();

      await writeActionLog(tx, {
        event_id: eventId,
        attendee_id: attendeeId,
        action_type: "attendee_edited",
        audit: adminAuditFromContext(c),
        metadata: { fields: changes.fields },
      });

      return result.row;
    });

    const dto = await buildAttendeeDetailDto(db, eventId, updated);
    return c.json(dto);
  } catch (err) {
    if (err instanceof StaleWriteError) {
      return c.json({ error: "stale_write" }, 409);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json({ error: "email_conflict" }, 409);
    }
    console.error("handlePatchEventAttendee failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** POST /api/admin/events/:eventId/attendees/:id/resend */
export async function handleResendEventAttendeeTicket(
  c: Context,
  db: PrismaClient,
  mailDeps: MailDeliveryDeps = {},
): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadAttendeeInEvent(db, eventId, attendeeId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  let body: unknown = {};
  try {
    const text = await c.req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = resendBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const to = parsed.data.to;
  const targetEmail = to ?? existing.email;
  const alternate = Boolean(to && to !== existing.email);

  // SECURITY NOTE (ADR 0021): `to` is validated as email format only — no domain allowlist.
  // Per-attendee and global-per-user rate limits apply. All resends are audit-logged.
  // A domain allowlist per org/event is planned for v0.5 (see follow-up task).
  // Rationale: admins legitimately resend to corporate relay addresses outside the registrant's
  // personal domain; a hardcoded allowlist would break that use-case without org configuration.
  const sendResult = await resendTicketEmail(attendeeId, db, process.env, mailDeps, { to });

  const skipped = sendResult.skipped.find((s) => s.attendeeId === attendeeId);
  if (skipped) {
    return c.json({ error: "resend_skipped", reason: skipped.reason }, 422);
  }

  const created = sendResult.deliveries.find((d) => d.attendeeId === attendeeId);
  if (!created) {
    return c.json({ error: "delivery_not_created" }, 500);
  }

  const deliveryRow = await db.emailDelivery.findUnique({
    where: { id: created.deliveryId },
  });

  if (!deliveryRow || deliveryRow.event_id !== eventId) {
    return c.json({ error: "delivery_not_found" }, 500);
  }

  const { items: deliveries } = await listDeliveries(
    { eventId, filters: { attendeeId } },
    db,
  );
  const latest = deliveries.find((d) => d.id === created.deliveryId);
  if (!latest) {
    return c.json({ error: "delivery_not_found" }, 500);
  }

  await db.$transaction(async (tx) => {
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: attendeeId,
      action_type: "ticket_resent",
      audit: adminAuditFromContext(c),
      metadata: { alternate },
    });
  });

  return c.json(toDeliveryDto(latest));
}
