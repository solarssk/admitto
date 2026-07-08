import { createRequire } from "node:module";
import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  listDeliveries,
  resendTicketEmail,
  sendTicketEmails,
  toDeliveryDto,
  type DeliveryDto,
  type MailDeliveryDeps,
} from "@admitto/mail-delivery";
import { EMAIL_DELIVERY_SUCCESS_STATUSES } from "@admitto/db";
import type { AttendeeStatus } from "@admitto/db/status";
import { formatEventDate, resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import {
  collectEventCustomDataFields,
  buildCustomDataFromInput,
  validateCustomDataPatch,
  assertCustomDataMeetsRequirements,
  customDataValue,
  parseCustomData,
  writeActionLog,
  writeBulkActionLog,
  type EventItemContent,
  ATTENDEE_EXPORT_RSVP_STATUSES,
  EXPORT_ROW_CAP,
  countFilteredAttendees,
  findFilteredAttendeesForExport,
  findFilteredAttendeesForList,
  revokeCheckIn,
  revokeCheckInTx,
  UndoNotAllowedError,
} from "@admitto/tickets";
import {
  EXPORT_BASE_COLUMNS,
  buildExportColumns,
  buildExportCsv,
  buildSanitizedExportRows,
  type SanitizedExportRow,
} from "@admitto/tickets/attendees-export";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  positiveIntQuery,
  requireEventId,
  resolveMailInstanceBaseUrl,
} from "./admin-helpers.js";
import { assertEventCapacityForIncoming, acquireEventCapacityLock, isCapacityReactivation } from "./event-capacity.js";
import { randomUUID } from "node:crypto";
import { decryptFromString } from "@admitto/crypto";
import { optimisticAttendeeUpdate, StaleWriteError, isStaleWrite } from "./optimistic-update.js";
import { resolveBulkSendAttendeeIds, BULK_SEND_LIMIT } from "./bulk-send-routes.js";

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
  rsvp_status: true,
  rsvp_updated_at: true,
  rsvp_source: true,
  token_enc: true,
  public_ref: true,
} as const;

const RSVP_STATUSES = ATTENDEE_EXPORT_RSVP_STATUSES;
type RsvpStatus = (typeof RSVP_STATUSES)[number];
const rsvpStatusSchema = z.enum(RSVP_STATUSES);

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
    rsvp_status: rsvpStatusSchema.optional(),
    status: z.enum(["registered", "revoked"]).optional(),
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

/** Empty or whitespace-only POST body parses as `{}`; malformed JSON returns 400. */
async function parseOptionalJsonBody(c: Context): Promise<unknown | Response> {
  try {
    const text = await c.req.text();
    if (!text.trim()) return {};
    return JSON.parse(text);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
}

/** Hard cap on attendees in one bulk-resend to avoid request timeout. */
const BULK_RESEND_LIMIT = BULK_SEND_LIMIT;

const bulkResendBodySchema = z
  .object({
    target: z.enum(["unsent", "all"]).default("unsent"),
  })
  .strict();

export type BulkResendDto = {
  /** Deliveries accepted by the mail provider (see `sendTicketEmails` `sent`). */
  queued: number;
  skipped: number;
  /** Delivery rows created but not accepted by the provider (failed/rejected batch). */
  failed: number;
};

const customDataFieldValueSchema = z.string().trim().max(100).nullable();

const customDataFieldsRecordSchema = z.record(
  z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_]+$/),
  customDataFieldValueSchema,
);

const createAttendeeSchema = z
  .object({
    email: z.string().trim().email().max(254),
    name: z.string().trim().min(1).max(200),
    company: z.string().trim().max(200).optional(),
    department: z.string().trim().max(200).optional(),
    ticket_type: z.string().trim().max(100).optional(),
    custom_data: customDataFieldsRecordSchema.optional(),
  })
  .strict();

/** Fixed column PDF widths for export (includes check-off). Attribute columns appended at runtime. */
const EXPORT_BASE_PDF_WIDTHS = [22, 85, 100, 75, 70, 65, 75, 80] as const;
const EXPORT_ATTRIBUTE_PDF_WIDTH = 55;
/** Printable width on A4 landscape with 40pt side margins (pdfkit default). */
const PDF_PRINTABLE_WIDTH = 762;

if (EXPORT_BASE_PDF_WIDTHS.length !== EXPORT_BASE_COLUMNS.length) {
  throw new Error("EXPORT_BASE_PDF_WIDTHS must match EXPORT_BASE_COLUMNS length");
}

/** RFC 6266 attachment header with `"` escaped in the filename. */
function exportContentDisposition(filename: string): string {
  const safeFilename = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `attachment; filename="${safeFilename}"`;
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

  const eventDateStr = formatEventDate(eventMeta.date, "UTC");
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
  department: string | null;
  ticket_type: string | null;
  status: AttendeeStatus;
  check_in_status: "admitted" | "not_admitted";
  admitted_at: string | null;
  updated_at: string;
  last_mail_status: string | null;
  rsvp_status: RsvpStatus;
};

export type AttendeeActionLogEntryDto = {
  id: string;
  action_type: string;
  actor_display: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type AttendeeDetailDto = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  status: AttendeeStatus;
  check_in_status: "admitted" | "not_admitted";
  admitted_at: string | null;
  updated_at: string;
  rsvp_status: RsvpStatus;
  rsvp_updated_at: string | null;
  rsvp_source: string | null;
  ticket_ref: string | null;
  custom_data: unknown;
  deliveries: DeliveryDto[];
  action_log: AttendeeActionLogEntryDto[];
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
  rsvp_status?: RsvpStatus;
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
  const rsvpRaw = c.req.query("rsvp_status")?.trim();
  const rsvp_status = RSVP_STATUSES.includes(rsvpRaw as RsvpStatus)
    ? (rsvpRaw as RsvpStatus)
    : undefined;
  return { page, pageSize, q, status, ticket_type, rsvp_status };
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


function truncateTicketRef(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…`;
}

function buildTicketRefPreview(row: {
  token_enc: string | null;
  public_ref: string | null;
}): string | null {
  if (row.public_ref) return truncateTicketRef(row.public_ref);
  if (row.token_enc) {
    try {
      return truncateTicketRef(decryptFromString(row.token_enc));
    } catch {
      return null;
    }
  }
  return null;
}

/** Shown in activity log when a human actor has no display_name (email is never exposed). */
const ACTION_LOG_ACTOR_FALLBACK = "Admin";

async function loadAttendeeActionLogEntries(
  db: PrismaClient,
  attendeeId: string,
): Promise<AttendeeActionLogEntryDto[]> {
  const logs = await db.attendeeActionLog.findMany({
    where: { attendee_id: attendeeId },
    orderBy: { created_at: "desc" },
    take: 50,
    select: {
      id: true,
      action_type: true,
      actor_user_id: true,
      metadata: true,
      created_at: true,
    },
  });

  const actorIds = [
    ...new Set(logs.map((log) => log.actor_user_id).filter((id): id is string => id != null)),
  ];
  const users =
    actorIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, display_name: true },
        })
      : [];
  const userById = new Map(users.map((user) => [user.id, user]));

  return logs.map((log) => {
    const actor = log.actor_user_id ? userById.get(log.actor_user_id) : undefined;
    return {
      id: log.id,
      action_type: log.action_type,
      actor_display: log.actor_user_id
        ? (actor?.display_name ?? ACTION_LOG_ACTOR_FALLBACK)
        : "System",
      metadata:
        log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
          ? (log.metadata as Record<string, unknown>)
          : null,
      created_at: log.created_at.toISOString(),
    };
  });
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
    status: string;
    admitted_at: Date | null;
    updated_at: Date;
    rsvp_status: string;
  },
  lastMail: Map<string, string>,
): AttendeeRowDto {
  const { company, department } = resolveCompanyDepartment(row);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company,
    department,
    ticket_type: row.ticket_type,
    status: row.status as AttendeeStatus,
    check_in_status: checkInStatus(row.admitted_at),
    admitted_at: row.admitted_at ? row.admitted_at.toISOString() : null,
    updated_at: row.updated_at.toISOString(),
    last_mail_status: lastMail.get(row.id) ?? null,
    rsvp_status: row.rsvp_status as RsvpStatus,
  };
}

/** Build attendee detail DTO including delivery log and activity (ticket_ref is admin-only preview). */
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
    rsvp_status: string;
    rsvp_updated_at: Date | null;
    rsvp_source: string | null;
    token_enc: string | null;
    public_ref: string | null;
  },
): Promise<AttendeeDetailDto> {
  const [deliveriesResult, action_log] = await Promise.all([
    listDeliveries({ eventId, filters: { attendeeId: row.id } }, db),
    loadAttendeeActionLogEntries(db, row.id),
  ]);
  const { company, department } = resolveCompanyDepartment(row);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company,
    department,
    ticket_type: row.ticket_type,
    status: row.status as AttendeeStatus,
    check_in_status: checkInStatus(row.admitted_at),
    admitted_at: row.admitted_at ? row.admitted_at.toISOString() : null,
    updated_at: row.updated_at.toISOString(),
    rsvp_status: row.rsvp_status as RsvpStatus,
    rsvp_updated_at: row.rsvp_updated_at ? row.rsvp_updated_at.toISOString() : null,
    rsvp_source: row.rsvp_source,
    ticket_ref: buildTicketRefPreview(row),
    custom_data: row.custom_data ?? null,
    deliveries: deliveriesResult.items.map(toDeliveryDto),
    action_log,
  };
}

/** GET /api/admin/events/:eventId/attendees */
export async function handleListEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const { page, pageSize, q, status, ticket_type, rsvp_status } = parseListQuery(c);

  const filterParams = { q, status, ticket_type, rsvp_status };

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

  const { q, status, ticket_type, rsvp_status } = parseListQuery(c);

  const filterParams = { q, status, ticket_type, rsvp_status };

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { title: true, date: true, timezone: true },
  });

  if (!event) {
    return c.json({ error: "not_found" }, 404);
  }

  const timeZone = resolvePreviewEventTimeZone(event.timezone);

  const total = await countFilteredAttendees(db, eventId, filterParams);
  if (total > EXPORT_ROW_CAP) {
    return c.json({ error: "export_too_large", count: total, cap: EXPORT_ROW_CAP }, 400);
  }

  const [rows, attributeFieldsResult] = await Promise.all([
    findFilteredAttendeesForExport(db, eventId, filterParams),
    loadEventCustomDataFields(db, eventId).catch((err) => err),
  ]);
  if (attributeFieldsResult instanceof Error) {
    return c.json({ error: customDataErrorCode(attributeFieldsResult) }, 400);
  }
  const attributeFields = attributeFieldsResult;

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


function computeRsvpChange(
  existingRsvp: string,
  patchRsvp: RsvpStatus | undefined,
): { data: Prisma.AttendeeUpdateInput; from: RsvpStatus; to: RsvpStatus } | null {
  if (patchRsvp === undefined || patchRsvp === existingRsvp) return null;
  return {
    data: {
      rsvp_status: patchRsvp,
      rsvp_updated_at: new Date(),
      rsvp_source: "admin",
    },
    from: existingRsvp as RsvpStatus,
    to: patchRsvp,
  };
}

function customDataErrorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("unknown_custom_data_field:")) return "unknown_custom_data_field";
  if (message.startsWith("required_custom_data_field_missing:")) {
    return "required_custom_data_field_missing";
  }
  if (message.startsWith("conflicting_custom_data_field_options:")) {
    return "conflicting_custom_data_field_options";
  }
  return "validation_failed";
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

  const {
    expected_updated_at: expectedUpdatedAtRaw,
    rsvp_status: patchRsvp,
    status: patchStatus,
    ...profilePatch
  } = parsed.data;

  if (profilePatch.custom_data_fields) {
    let allowedFields: EventItemContent[];
    try {
      allowedFields = await loadEventCustomDataFields(db, eventId);
    } catch (err) {
      return c.json({ error: customDataErrorCode(err) }, 400);
    }
    try {
      profilePatch.custom_data_fields = validateCustomDataPatch(
        allowedFields,
        existing.custom_data,
        profilePatch.custom_data_fields,
      );
    } catch (err) {
      return c.json({ error: customDataErrorCode(err) }, 400);
    }
  }

  const profileChanges = computePatchChanges(existing, profilePatch);
  const rsvpChange = computeRsvpChange(existing.rsvp_status, patchRsvp);
  const statusChange =
    patchStatus !== undefined && patchStatus !== existing.status ? patchStatus : undefined;

  if (!profileChanges && !rsvpChange && !statusChange) {
    const dto = await buildAttendeeDetailDto(db, eventId, existing);
    return c.json(dto);
  }

  if (profileChanges || rsvpChange) {
    let allowedFields: EventItemContent[];
    try {
      allowedFields = await loadEventCustomDataFields(db, eventId);
    } catch (err) {
      return c.json({ error: customDataErrorCode(err) }, 400);
    }
    if (allowedFields.length > 0) {
      try {
        const nextCustomData =
          profileChanges?.data.custom_data !== undefined
            ? profileChanges.data.custom_data
            : existing.custom_data;
        assertCustomDataMeetsRequirements(allowedFields, nextCustomData);
      } catch (err) {
        return c.json({ error: customDataErrorCode(err) }, 400);
      }
    }
  }

  if (!expectedUpdatedAtRaw) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
  if (Number.isNaN(expectedUpdatedAt.getTime())) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const updateData: Prisma.AttendeeUpdateInput = {
    ...(profileChanges?.data ?? {}),
    ...(rsvpChange?.data ?? {}),
    ...(statusChange !== undefined ? { status: statusChange } : {}),
  };

  try {
    const updated = await db.$transaction(async (tx) => {
      const isRestore = isCapacityReactivation(existing.status, statusChange);
      let restoreCapacityForced: { forced: true; capacity: number; current: number } | undefined;

      if (isRestore) {
        await acquireEventCapacityLock(tx, eventId);
        const capacityResult = await assertEventCapacityForIncoming(c, tx, eventId, 1);
        if (capacityResult instanceof Response) throw capacityResult;
        if (capacityResult && "forced" in capacityResult) {
          restoreCapacityForced = capacityResult;
        }
      }

      const result = await optimisticAttendeeUpdate(tx, {
        id: attendeeId,
        expectedUpdatedAt,
        data: updateData,
        select: ATTENDEE_DETAIL_SELECT,
      });

      if (isStaleWrite(result)) throw new StaleWriteError();

      // Revoking the pass must not leave a stale admission behind — restoring
      // the pass later would otherwise resurrect a "checked in" state from
      // before the revoke without a new scan ever happening (PO review).
      if (statusChange === "revoked" && existing.admitted_at) {
        await revokeCheckInTx({ eventId, attendeeId, audit: adminAuditFromContext(c) }, tx);
        // result.row was read before the clear above — reflect it in the
        // response DTO without a second round-trip.
        result.row.admitted_at = null;
      }

      if (rsvpChange) {
        await writeActionLog(tx, {
          event_id: eventId,
          attendee_id: attendeeId,
          action_type: "rsvp_status_changed",
          audit: adminAuditFromContext(c),
          metadata: {
            from: rsvpChange.from,
            to: rsvpChange.to,
            source: "admin",
          },
        });
      }

      if (profileChanges) {
        await writeActionLog(tx, {
          event_id: eventId,
          attendee_id: attendeeId,
          action_type: "attendee_edited",
          audit: adminAuditFromContext(c),
          metadata: { fields: profileChanges.fields },
        });
      }

      if (statusChange !== undefined) {
        await writeActionLog(tx, {
          event_id: eventId,
          attendee_id: attendeeId,
          action_type: statusChange === "revoked" ? "pass_revoked" : "pass_restored",
          audit: adminAuditFromContext(c),
          metadata: {
            previous_status: existing.status,
            ...(restoreCapacityForced
              ? {
                  forced: true,
                  capacity: restoreCapacityForced.capacity,
                  current: restoreCapacityForced.current,
                }
              : {}),
          },
        });
      }

      return result.row;
    });

    const dto = await buildAttendeeDetailDto(db, eventId, updated);
    return c.json(dto);
  } catch (err) {
    if (err instanceof Response) return err;
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

/** DELETE /api/admin/events/:eventId/attendees/:id — GDPR erasure path. */
export async function handleDeleteEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.attendee.findUnique({
      where: { id: attendeeId },
      select: { event_id: true },
    });
    if (!existing || existing.event_id !== eventId) return "forbidden" as const;

    const [emailDeliveries, walletPasses, checkIns] = await Promise.all([
      tx.emailDelivery.deleteMany({ where: { event_id: eventId, attendee_id: attendeeId } }),
      tx.walletPass.deleteMany({ where: { attendee_id: attendeeId } }),
      tx.checkIn.deleteMany({ where: { event_id: eventId, attendee_id: attendeeId } }),
    ]);

    const attendeeDelete = await tx.attendee.deleteMany({ where: { id: attendeeId, event_id: eventId } });
    if (attendeeDelete.count === 0) return "gone" as const;

    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "attendee_erased",
      audit: adminAuditFromContext(c),
      metadata: {
        attendee_id: attendeeId,
        removed: {
          email_deliveries: emailDeliveries.count,
          wallet_passes: walletPasses.count,
          check_ins: checkIns.count,
        },
      },
    });
    return "deleted" as const;
  });

  if (result === "forbidden") return c.json({ error: "forbidden" }, 403);
  return c.body(null, 204);
}


/** POST /api/admin/events/:eventId/attendees — manual attendee create (admin/superadmin). */
export async function handleCreateEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = createAttendeeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const { email, name, company, department, ticket_type, custom_data } = parsed.data;

  const duplicate = await db.attendee.findFirst({
    where: { event_id: eventId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (duplicate) {
    return c.json(
      { code: "email_taken", error: "This email is already registered for this event." },
      409,
    );
  }

  let allowedFields: EventItemContent[];
  try {
    allowedFields = await loadEventCustomDataFields(db, eventId);
  } catch (err) {
    return c.json({ error: customDataErrorCode(err) }, 400);
  }
  let customData: Prisma.InputJsonValue | undefined;
  try {
    const built = buildCustomDataFromInput(allowedFields, custom_data);
    customData = built as Prisma.InputJsonValue | undefined;
  } catch (err) {
    return c.json({ error: customDataErrorCode(err) }, 400);
  }

  try {
    const created = await db.$transaction(async (tx) => {
      await acquireEventCapacityLock(tx, eventId);
      const capacityResult = await assertEventCapacityForIncoming(c, tx, eventId, 1);
      if (capacityResult instanceof Response) throw capacityResult;
      const capacityForced =
        capacityResult && "forced" in capacityResult ? capacityResult : undefined;

      const row = await tx.attendee.create({
        data: {
          id: randomUUID(),
          event_id: eventId,
          email,
          name,
          company: company?.trim() ? company.trim() : null,
          department: department?.trim() ? department.trim() : null,
          ticket_type: ticket_type?.trim() ? ticket_type.trim() : null,
          ...(customData !== undefined ? { custom_data: customData } : {}),
          rsvp_status: "none",
          rsvp_source: "admin",
        },
        select: ATTENDEE_DETAIL_SELECT,
      });

      await writeActionLog(tx, {
        event_id: eventId,
        attendee_id: row.id,
        action_type: "attendee_created_manual",
        audit: adminAuditFromContext(c),
        ...(capacityForced
          ? {
              metadata: {
                forced: true,
                capacity: capacityForced.capacity,
                current: capacityForced.current,
              },
            }
          : {}),
      });

      return row;
    });

    const dto = await buildAttendeeDetailDto(db, eventId, created);
    return c.json(dto, 201);
  } catch (err) {
    if (err instanceof Response) return err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return c.json(
        { code: "email_taken", error: "This email is already registered for this event." },
        409,
      );
    }
    console.error("handleCreateEventAttendee failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** POST /api/admin/events/:eventId/attendees/:id/resend */
export async function handleResendEventAttendeeTicket(
  c: Context,
  db: PrismaClient,
  mailDeps: MailDeliveryDeps = {},
  injectedBaseUrl?: string,
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

  let body: unknown;
  const parsedBody = await parseOptionalJsonBody(c);
  if (parsedBody instanceof Response) return parsedBody;
  body = parsedBody;

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
  const baseUrlOrRes = await resolveMailInstanceBaseUrl(c, db, process.env, injectedBaseUrl);
  if (baseUrlOrRes instanceof Response) return baseUrlOrRes;
  const sendResult = await resendTicketEmail(attendeeId, db, process.env, mailDeps, {
    to,
    baseUrl: baseUrlOrRes,
  });

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

/**
 * POST /api/admin/events/:eventId/attendees/:id/revoke-checkin
 * Admin/superadmin only (assertEventManageAccess) — reverses this attendee's
 * current admission regardless of who checked them in or when, distinct from
 * the operator-facing device-scoped "undo my last scan" on the check-in page.
 */
export async function handleRevokeAttendeeCheckIn(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadAttendeeInEvent(db, eventId, attendeeId);
  if (!existing) return c.json({ error: "not found" }, 404);

  try {
    const result = await revokeCheckIn(
      { eventId, attendeeId, audit: adminAuditFromContext(c) },
      db,
    );
    return c.json(result);
  } catch (err) {
    if (err instanceof UndoNotAllowedError) {
      return c.json({ error: "not_admitted" }, 409);
    }
    console.error("handleRevokeAttendeeCheckIn failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

/** Best-effort bulk send audit — must not fail the HTTP response after mail is queued. */
async function auditBulkTicketSend(
  db: PrismaClient,
  c: Context,
  eventId: string,
  metadata: { target: "unsent" | "all"; queued: number; skipped: number; failed: number },
): Promise<void> {
  try {
    await writeBulkActionLog(db, {
      event_id: eventId,
      action_type: "mail_bulk_resend",
      audit: adminAuditFromContext(c),
      metadata,
    });
  } catch (err) {
    console.error("bulk resend audit log failed:", err);
  }
}

/**
 * Queue ticket emails for many attendees in one batch.
 *
 * `target: "unsent"` selects attendees without accepted/sent/delivered/queued delivery
 * and sends via `purpose: "initial"` (atomic claim). `target: "all"` resends to every
 * attendee up to {@link BULK_RESEND_LIMIT}. Audit metadata is counts only (no PII).
 */
export async function handleBulkResendTickets(
  c: Context,
  db: PrismaClient,
  mailDeps: MailDeliveryDeps = {},
  injectedBaseUrl?: string,
): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  const parsedBody = await parseOptionalJsonBody(c);
  if (parsedBody instanceof Response) return parsedBody;
  body = parsedBody;

  const parsed = bulkResendBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const target = parsed.data.target;
  const filter =
    target === "unsent" ? ({ type: "no_delivery" } as const) : ({ type: "all" } as const);
  const noDeliveryScope = target === "unsent" ? ({ mode: "initial_ticket" } as const) : undefined;
  const { ids, overLimit } = await resolveBulkSendAttendeeIds(
    db,
    eventId,
    filter,
    noDeliveryScope,
  );

  if (overLimit) {
    return c.json({ error: "too_many_attendees", limit: BULK_RESEND_LIMIT }, 400);
  }

  if (ids.length === 0) {
    await auditBulkTicketSend(db, c, eventId, { target, queued: 0, skipped: 0, failed: 0 });
    return c.json({ queued: 0, skipped: 0, failed: 0 } satisfies BulkResendDto);
  }

  const attendeeIds = ids;
  const mailPurpose = target === "unsent" ? "initial" : "resend";
  const baseUrlOrRes = await resolveMailInstanceBaseUrl(c, db, process.env, injectedBaseUrl);
  if (baseUrlOrRes instanceof Response) return baseUrlOrRes;
  const sendResult = await sendTicketEmails(
    eventId,
    {
      attendeeIds,
      purpose: mailPurpose,
      baseUrl: baseUrlOrRes,
    },
    db,
    process.env,
    mailDeps,
  );

  const skipped = sendResult.skipped.length;
  const queued = sendResult.sent;
  const failed = sendResult.deliveries.length - sendResult.sent;

  await auditBulkTicketSend(db, c, eventId, { target, queued, skipped, failed });

  return c.json({ queued, skipped, failed } satisfies BulkResendDto);
}
