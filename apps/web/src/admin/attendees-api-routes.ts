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
import type { AttendeeStatus } from "@admitto/db/status";
import { formatEventDate, resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import {
  loadEventCustomDataFields,
  buildCustomDataFromInput,
  validateCustomDataPatch,
  assertCustomDataMeetsRequirements,
  customDataValue,
  parseCustomData,
  writeActionLog,
  writeActionLogMany,
  writeAdminAuditLog,
  writeBulkActionLog,
  type EventItemContent,
  ATTENDEE_EXPORT_RSVP_STATUSES,
  ATTENDEE_MAIL_STATUS_FILTERS,
  ATTENDEE_SORT_COLUMNS,
  EXPORT_ROW_CAP,
  countFilteredAttendees,
  findFilteredAttendeesForExport,
  findFilteredAttendeesForList,
  findSelectedAttendeesForExport,
  isAdmittable,
  admitAttendee,
  revokeCheckIn,
  revokeCheckInMutation,
  revokeItemState,
  revokeItemsForAttendees,
  getAttendeeCard,
  UndoNotAllowedError,
  type OpsAuditContext,
  ADMITTABLE_STATUS_LIST,
  IllegalItemTransitionError,
  loadEventTicketTypes,
  assertTicketTypeInCatalog,
  UnknownTicketTypeError,
  acquireEventTicketTypesLock,
  REVOCABLE_ITEM_STATES,
  type AdmitResult,
  type AttendeeMailStatusFilter,
  type AttendeeSortBy,
  type AttendeeSortDir,
  type ExportAttendeeSqlRow,
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
  itemTransitionErrorResponse,
  positiveIntQuery,
  requireEventId,
  resolveClientTimezone,
  resolveMailInstanceBaseUrl,
} from "./admin-helpers.js";
import { mailNotConfiguredResponse } from "./mail-settings-shared.js";
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
  created_at: true,
  client_timezone: true,
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
async function parseOptionalJsonBody(c: Context): Promise<unknown> {
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
  const safeFilename = filename.replaceAll(/\\/g, String.raw`\\`).replaceAll(/"/g, '\\"');
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

/** Append bulk audit row after a successful filtered or explicit-selection export (no raw
 * search term, no attendee ids — `selected_count` is how many ids the operator requested,
 * while `count` above it is how many rows actually exported). */
async function auditAttendeesExported(
  db: PrismaClient,
  c: Context,
  eventId: string,
  format: "xlsx" | "csv" | "pdf",
  count: number,
  filters:
    | { status: string; ticket_type?: string; mail_status?: string; has_query: boolean }
    | { selected_count: number },
): Promise<void> {
  await db.$transaction(async (tx) => {
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "attendees_exported",
      audit: adminAuditFromContext(c),
      metadata: {
        format,
        count,
        filters:
          "selected_count" in filters
            ? { selected_count: filters.selected_count }
            : {
                status: filters.status,
                ticket_type: filters.ticket_type ?? null,
                mail_status: filters.mail_status ?? null,
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
  /** Whether this attendee currently has at least one issued/returned item hand-out — lets the
   * Attendees list's bulk "Revoke items" action report how many of the selection it would
   * actually affect, not just the raw selection size. */
  has_issued_items: boolean;
};

export type AttendeeActionLogEntryDto = {
  id: string;
  action_type: string;
  actor_display: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  /** Acting admin's IANA timezone at write time, when known. */
  client_timezone: string | null;
};

export type AttendeeDetailItemDto = {
  key: string;
  label: string;
  icon: string | null;
  state: string;
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
  created_at: string;
  /** Acting admin's IANA timezone at attendee-creation time, when known (manual add / import). */
  client_timezone: string | null;
  updated_at: string;
  rsvp_status: RsvpStatus;
  rsvp_updated_at: string | null;
  rsvp_source: string | null;
  ticket_ref: string | null;
  custom_data: unknown;
  deliveries: DeliveryDto[];
  action_log: AttendeeActionLogEntryDto[];
  event_items: AttendeeDetailItemDto[];
};

/** Read-only event-day item summary for the attendee detail page — same source data as the
 * check-in AttendeeCardDto (enabled EventItems + this attendee's AttendeeItemState rows), but
 * without getAttendeeCard's ensureAttendeeItemStates write-on-read side effect: a plain detail
 * view has no reason to create pending-state rows the operator card would lazily backfill.
 * Deliberately doesn't surface each item's configured content_fields (e.g. shirt size) inline -
 * with several fields configured that reads as clutter next to the item name and duplicates the
 * Additional information card, which already lists every custom_data field on its own (PO review). */
async function loadAttendeeItemsSummary(
  db: PrismaClient,
  eventId: string,
  attendeeId: string,
): Promise<AttendeeDetailItemDto[]> {
  const items = await db.eventItem.findMany({
    where: { event_id: eventId, enabled: true },
    orderBy: { key: "asc" },
  });
  if (items.length === 0) return [];

  const states = await db.attendeeItemState.findMany({
    where: { attendee_id: attendeeId, event_item_id: { in: items.map((item) => item.id) } },
  });
  const stateByItem = new Map(states.map((s) => [s.event_item_id, s.state]));

  return items.map((item) => ({
    key: item.key,
    label: item.label,
    icon: item.icon,
    state: stateByItem.get(item.id) ?? "pending",
  }));
}

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
  if (row?.event_id !== eventId) return null;
  return row;
}

type ManagedEventAttendee = {
  attendee: NonNullable<Awaited<ReturnType<typeof loadAttendeeInEvent>>>;
  attendeeId: string;
  eventId: string;
};

/** Resolve, authorize, and load an attendee scoped to the requested event. */
async function requireManagedEventAttendee(
  c: Context,
  db: PrismaClient,
): Promise<ManagedEventAttendee | Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const attendee = await loadAttendeeInEvent(db, eventId, attendeeId);
  if (!attendee) return c.json({ error: "forbidden" }, 403);

  return { attendee, attendeeId, eventId };
}

/** Parse and clamp list query params (`page`, `pageSize`, `q`, `status`, `ticket_type`, `mail_status`, `sortBy`, `sortDir`). */
function parseListQuery(c: Context): {
  page: number;
  pageSize: number;
  q?: string;
  status: "all" | "admitted" | "not_admitted";
  ticket_type?: string;
  rsvp_status?: RsvpStatus;
  mail_status?: AttendeeMailStatusFilter;
  sortBy: AttendeeSortBy;
  sortDir: AttendeeSortDir;
} {
  const page = positiveIntQuery(c.req.query("page"), 1);
  const pageSize = positiveIntQuery(c.req.query("pageSize"), 25, 100);
  const qRaw = c.req.query("q")?.trim();
  const q = qRaw || undefined;
  const statusRaw = c.req.query("status") ?? "all";
  const status =
    statusRaw === "admitted" || statusRaw === "not_admitted" ? statusRaw : "all";
  const ticketTypeRaw = c.req.query("ticket_type")?.trim();
  const ticket_type = ticketTypeRaw || undefined;
  const rsvpRaw = c.req.query("rsvp_status")?.trim();
  const rsvp_status = RSVP_STATUSES.includes(rsvpRaw as RsvpStatus)
    ? (rsvpRaw as RsvpStatus)
    : undefined;
  const mailStatusRaw = c.req.query("mail_status")?.trim();
  const mail_status = ATTENDEE_MAIL_STATUS_FILTERS.includes(mailStatusRaw as AttendeeMailStatusFilter)
    ? (mailStatusRaw as AttendeeMailStatusFilter)
    : undefined;
  const sortByRaw = c.req.query("sortBy");
  const sortBy = ATTENDEE_SORT_COLUMNS.includes(sortByRaw as AttendeeSortBy)
    ? (sortByRaw as AttendeeSortBy)
    : "name";
  const sortDirRaw = c.req.query("sortDir");
  const sortDir: AttendeeSortDir = sortDirRaw === "desc" ? "desc" : "asc";
  return { page, pageSize, q, status, ticket_type, rsvp_status, mail_status, sortBy, sortDir };
}

/** Latest email delivery status per attendee id (one entry per id). Tiebreak on `id` desc
 * after `created_at` desc, not just created_at — two deliveries for the same attendee can
 * share a millisecond timestamp (e.g. a resend queued in the same request), and without a
 * deterministic tiebreak here this could disagree with attendeeMailStatusSql's `mail_status`
 * filter (packages/tickets/attendees-list-filters.ts), which already tiebreaks the same way
 * specifically so the Mail column badge and the filter always agree on "latest" (code
 * review). */
async function lastMailStatusByAttendee(
  db: PrismaClient,
  attendeeIds: string[],
): Promise<Map<string, string>> {
  if (attendeeIds.length === 0) return new Map();

  const deliveries = await db.emailDelivery.findMany({
    where: { attendee_id: { in: attendeeIds } },
    select: { attendee_id: true, status: true },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
  });

  const map = new Map<string, string>();
  for (const row of deliveries) {
    if (!map.has(row.attendee_id)) {
      map.set(row.attendee_id, row.status);
    }
  }
  return map;
}

/** Attendee ids (within the given set) that currently have at least one issued/returned item
 * hand-out — backs the Attendees list's `has_issued_items` row field. */
async function issuedItemsAttendeeIds(db: PrismaClient, attendeeIds: string[]): Promise<Set<string>> {
  if (attendeeIds.length === 0) return new Set();

  const states = await db.attendeeItemState.findMany({
    where: { attendee_id: { in: attendeeIds }, state: { in: REVOCABLE_ITEM_STATES } },
    select: { attendee_id: true },
    distinct: ["attendee_id"],
  });
  return new Set(states.map((s) => s.attendee_id));
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
      client_timezone: true,
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
      client_timezone: log.client_timezone,
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
  issuedItems: Set<string>,
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
    has_issued_items: issuedItems.has(row.id),
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
    created_at: Date;
    client_timezone: string | null;
    updated_at: Date;
    rsvp_status: string;
    rsvp_updated_at: Date | null;
    rsvp_source: string | null;
    token_enc: string | null;
    public_ref: string | null;
  },
): Promise<AttendeeDetailDto> {
  const [deliveriesResult, action_log, event_items] = await Promise.all([
    listDeliveries({ eventId, filters: { attendeeId: row.id } }, db),
    loadAttendeeActionLogEntries(db, row.id),
    loadAttendeeItemsSummary(db, eventId, row.id),
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
    created_at: row.created_at.toISOString(),
    client_timezone: row.client_timezone,
    updated_at: row.updated_at.toISOString(),
    rsvp_status: row.rsvp_status as RsvpStatus,
    rsvp_updated_at: row.rsvp_updated_at ? row.rsvp_updated_at.toISOString() : null,
    rsvp_source: row.rsvp_source,
    ticket_ref: buildTicketRefPreview(row),
    custom_data: row.custom_data ?? null,
    deliveries: deliveriesResult.items.map(toDeliveryDto),
    action_log,
    event_items,
  };
}

/** GET /api/admin/events/:eventId/attendees */
export async function handleListEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const { page, pageSize, q, status, ticket_type, rsvp_status, mail_status, sortBy, sortDir } = parseListQuery(c);

  const filterParams = { q, status, ticket_type, rsvp_status, mail_status };

  const [total, rows] = await Promise.all([
    countFilteredAttendees(db, eventId, filterParams),
    findFilteredAttendeesForList(db, eventId, filterParams, page, pageSize, sortBy, sortDir),
  ]);

  const attendeeIds = rows.map((r) => r.id);
  const [lastMail, issuedItems] = await Promise.all([
    lastMailStatusByAttendee(db, attendeeIds),
    issuedItemsAttendeeIds(db, attendeeIds),
  ]);

  c.header("Cache-Control", "no-store");
  return c.json({
    items: rows.map((r) => serializeAttendeeRow(r, lastMail, issuedItems)),
    total,
    page,
    pageSize,
  });
}

type ExportFormat = "xlsx" | "csv" | "pdf";

/** Shared by the filtered (GET) and explicit-selection (POST) export handlers: builds the
 * sanitized export rows, writes the bulk-action audit entry, and returns the file response for
 * whichever format was requested. */
async function buildExportFileResponse(
  db: PrismaClient,
  c: Context,
  eventId: string,
  rows: ExportAttendeeSqlRow[],
  format: ExportFormat,
  event: { title: string; date: Date; timezone: string },
  auditFilters:
    | { status: string; ticket_type?: string; mail_status?: string; has_query: boolean }
    | { selected_count: number },
): Promise<Response> {
  const timeZone = resolvePreviewEventTimeZone(event.timezone);
  const [attributeFieldsResult, ticketTypes] = await Promise.all([
    loadEventCustomDataFields(db, eventId).catch((err) => err),
    loadEventTicketTypes(db, eventId),
  ]);
  if (attributeFieldsResult instanceof Error) {
    return c.json({ error: customDataErrorCode(attributeFieldsResult) }, 400);
  }
  const attributeFields = attributeFieldsResult;

  const exportColumns = buildExportColumns(attributeFields);
  const exportRows = buildSanitizedExportRows(rows, attributeFields, timeZone, ticketTypes);

  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `attendees-${eventId}-${timestamp}.${format}`;

  if (format === "csv") {
    const csv = buildExportCsv(exportRows, exportColumns);
    await auditAttendeesExported(db, c, eventId, format, exportRows.length, auditFilters);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": exportContentDisposition(filename),
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
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
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
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
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}

/** GET /api/admin/events/:eventId/attendees/export — filtered subset as XLSX, CSV, or PDF (no
 * tokens). An explicit-selection export (checked rows in the bulk bar) is a separate POST
 * endpoint (`handleExportSelectedAttendees`, below) — its ids never travel in a query string,
 * since the default reverse-proxy access log records the full request URI (unlike this app's
 * own PII-free access log), and a selection of attendee ids is exactly the kind of detail that
 * log shouldn't retain. */
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

  const { q, status, ticket_type, rsvp_status, mail_status } = parseListQuery(c);
  const filterParams = { q, status, ticket_type, rsvp_status, mail_status };

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { title: true, date: true, timezone: true },
  });
  if (!event) {
    return c.json({ error: "not_found" }, 404);
  }

  const total = await countFilteredAttendees(db, eventId, filterParams);
  if (total > EXPORT_ROW_CAP) {
    return c.json({ error: "export_too_large", count: total, cap: EXPORT_ROW_CAP }, 400);
  }

  const rows = await findFilteredAttendeesForExport(db, eventId, filterParams);
  return buildExportFileResponse(db, c, eventId, rows, format, event, {
    status,
    ticket_type,
    mail_status,
    has_query: Boolean(q),
  });
}

const exportSelectedBodySchema = z
  .object({
    attendee_ids: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
    format: z.enum(["xlsx", "csv", "pdf"]),
  })
  .strict();

/** POST /api/admin/events/:eventId/attendees/export-selected — CSV/XLSX/PDF of an explicit
 * subset of attendees (the bulk bar's "Export selected"), bypassing list filters entirely. A
 * POST with the ids in the JSON body, not a GET with them in the query string (Codex review,
 * #520): the default reverse-proxy access log records the full request URI, and this app's own
 * access log deliberately excludes query strings for exactly this reason (deploy/README.md) —
 * a GET here would have quietly reopened that same PII-adjacent leak one layer down. Capped at
 * the same BULK_SEND_LIMIT as every other bulk action now that the ids aren't URL-length
 * constrained. Ids that don't belong to this event are silently ignored (findSelectedAttendeesForExport),
 * same convention as bulk delete/check-in. */
export async function handleExportSelectedAttendees(c: Context, db: PrismaClient): Promise<Response> {
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
  const parsed = exportSelectedBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);
  const { attendee_ids: attendeeIds, format } = parsed.data;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { title: true, date: true, timezone: true },
  });
  if (!event) {
    return c.json({ error: "not_found" }, 404);
  }

  const rows = await findSelectedAttendeesForExport(db, eventId, attendeeIds);
  return buildExportFileResponse(db, c, eventId, rows, format, event, {
    selected_count: attendeeIds.length,
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
  c.header("Cache-Control", "no-store");
  return c.json(dto);
}

type PatchInput = z.infer<typeof patchAttendeeFieldsSchema>;

/** Fields whose before/after value is recorded verbatim in AttendeeActionLog.metadata -
 * see DATA-PROTECTION.md's "Admin audit trail" section for the full reasoning: this is a
 * deliberate accountability record (GDPR Art. 5(2)), not a routine log line, admin-only, and
 * cascade-deletes with the attendee (Prisma `onDelete: Cascade`) so erasure already covers it.
 * Deliberately excludes `name` and every custom_data field (dietary, accessibility, emergency
 * contact, and other free-text attributes an event might collect) - those can hold
 * special-category data (GDPR Art. 9) a guest typed into a form field, which this fixed list
 * is not meant to capture; an edit to any of those still shows only the field name (#364). */
const LOGGED_VALUE_FIELDS = new Set(["email", "company", "department", "ticket_type"]);

/** Diff a mirrored company/department field against custom_data and the legacy column, for
 * `computePatchChanges` below — pushes to `fields`/`valueChanges` (via `logValue`) and touches
 * custom_data only when the value actually changed. */
function applyMirroredScalarPatchField(
  field: "company" | "department",
  current: string | null,
  next: string | null | undefined,
  data: Prisma.AttendeeUncheckedUpdateInput,
  touchCustomData: () => Record<string, unknown>,
  fields: string[],
  logValue: (field: string, from: string | null, to: string | null) => void,
): void {
  if (next === undefined || next === current) return;
  if (field === "company") data.company = next;
  else data.department = next;
  const raw = touchCustomData();
  if (next === null || next === "") delete raw[field];
  else raw[field] = next;
  fields.push(field);
  logValue(field, current, next);
}

/** Diff each `custom_data_fields` entry in a PATCH against current custom_data, for
 * `computePatchChanges` below — mutates `fields` and lazily touches custom_data only for entries
 * that actually changed. */
function applyCustomDataFieldPatches(
  existingCustomData: unknown,
  patchFields: Record<string, string | null>,
  touchCustomData: () => Record<string, unknown>,
  fields: string[],
): void {
  for (const [sourceField, next] of Object.entries(patchFields)) {
    const current = customDataValue(existingCustomData, sourceField);
    const normalizedNext = next === null || next === "" ? null : next;
    if (normalizedNext === current) continue;
    const raw = touchCustomData();
    if (normalizedNext === null) {
      delete raw[sourceField];
    } else {
      raw[sourceField] = normalizedNext;
    }
    fields.push(sourceField);
  }
}

/** Compute Prisma update payload, changed field names, and before/after values (for
 * LOGGED_VALUE_FIELDS only) from a PATCH body. */
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
): {
  data: Prisma.AttendeeUncheckedUpdateInput;
  fields: string[];
  valueChanges: Record<string, { from: string | null; to: string | null }>;
} | null {
  const fields: string[] = [];
  const valueChanges: Record<string, { from: string | null; to: string | null }> = {};
  const logValue = (field: string, from: string | null, to: string | null) => {
    if (LOGGED_VALUE_FIELDS.has(field)) valueChanges[field] = { from, to };
  };
  // Unchecked: ticket_type is now also a scalar FK column for the (event_id, ticket_type)
  // relation to TicketType, so Prisma's relation-aware AttendeeUpdateInput no longer exposes it
  // as a plain settable field - this function only ever sets raw scalar columns directly (never
  // touches the relation object itself), matching the Unchecked variant's intended use.
  const data: Prisma.AttendeeUncheckedUpdateInput = {};
  const resolved = resolveCompanyDepartment(existing);
  let customData: Record<string, unknown> | null = null;

  const touchCustomData = (): Record<string, unknown> => {
    customData ??= cloneCustomData(existing.custom_data);
    return customData;
  };

  if (patch.name !== undefined && patch.name !== existing.name) {
    data.name = patch.name;
    fields.push("name");
  }
  if (patch.email !== undefined && patch.email !== existing.email) {
    data.email = patch.email;
    fields.push("email");
    logValue("email", existing.email, patch.email);
  }
  applyMirroredScalarPatchField(
    "company",
    resolved.company,
    patch.company,
    data,
    touchCustomData,
    fields,
    logValue,
  );
  applyMirroredScalarPatchField(
    "department",
    resolved.department,
    patch.department,
    data,
    touchCustomData,
    fields,
    logValue,
  );
  if (patch.ticket_type !== undefined && patch.ticket_type !== existing.ticket_type) {
    data.ticket_type = patch.ticket_type;
    fields.push("ticket_type");
    logValue("ticket_type", existing.ticket_type, patch.ticket_type);
  }
  if (patch.custom_data_fields) {
    applyCustomDataFieldPatches(existing.custom_data, patch.custom_data_fields, touchCustomData, fields);
  }

  if (customData) {
    data.custom_data = customData as Prisma.InputJsonValue;
  }

  if (fields.length === 0) return null;
  return { data, fields, valueChanges };
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
  return "validation_failed";
}

/** Validates ticket_type against the event's live catalog (batch 04 / #351) - shared by create
 * and patch. An empty/falsy value (including "" once normalized by the caller) is treated as "no
 * type" rather than an invalid catalog value. Accepts `tx` as well as the bare client so callers
 * can run this inside the same transaction that holds acquireEventTicketTypesLock (TOCTOU fix,
 * code review) - validating on the bare `db` before a transaction opened let a concurrent
 * ticket-type DELETE's in-use recheck pass (it couldn't see this write yet) and remove the type
 * this row was about to reference. */
async function validateTicketTypeCatalog(
  db: PrismaClient | Prisma.TransactionClient,
  eventId: string,
  ticketType: string | null | undefined,
): Promise<{ error: string } | null> {
  if (!ticketType) return null;
  try {
    assertTicketTypeInCatalog(await loadEventTicketTypes(db, eventId), ticketType);
    return null;
  } catch (err) {
    if (err instanceof UnknownTicketTypeError) return { error: "unknown_ticket_type" };
    throw err;
  }
}

/** Parses and validates the required `expected_updated_at` CAS token — extracted guard clause
 * from `handlePatchEventAttendee`. */
function parseExpectedUpdatedAt(raw: string | undefined): Date | { error: string } {
  if (!raw) return { error: "validation_failed" };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { error: "validation_failed" };
  return parsed;
}

type PatchAttendeeStatusChange = "registered" | "revoked" | undefined;

function computeStatusChange(
  existingStatus: string,
  patchStatus: PatchAttendeeStatusChange,
): PatchAttendeeStatusChange {
  if (patchStatus === undefined || patchStatus === existingStatus) return undefined;
  return patchStatus;
}

/** Validates `profilePatch.custom_data_fields` against the event's configured fields and
 * normalizes an explicit "" ticket_type to null (clears the type instead of silently bypassing
 * catalog validation, CodeRabbit review) — extracted guard clause from
 * `handlePatchEventAttendee`. Mutates `profilePatch` in place; returns an error payload for the
 * caller to respond with, or null. The actual catalog-membership check (batch 04 / #351) happens
 * inside the PATCH transaction, under the same advisory lock ticket-type DELETE uses (TOCTOU
 * fix, code review) - see the comment there. */
async function validateAndNormalizeProfilePatch(
  existing: { custom_data: unknown },
  profilePatch: Omit<PatchInput, "rsvp_status" | "status">,
  loadAllowedFieldsOnce: () => Promise<EventItemContent[]>,
): Promise<{ error: string } | null> {
  if (profilePatch.custom_data_fields) {
    try {
      profilePatch.custom_data_fields = validateCustomDataPatch(
        await loadAllowedFieldsOnce(),
        existing.custom_data,
        profilePatch.custom_data_fields,
      );
    } catch (err) {
      return { error: customDataErrorCode(err) };
    }
  }

  if (profilePatch.ticket_type === "") {
    profilePatch.ticket_type = null;
  }

  return null;
}

/** When profile fields or RSVP status changed, re-validates the resulting custom_data against
 * the event's required-field configuration — extracted guard clause from
 * `handlePatchEventAttendee`. No-ops when neither changed, or when the event has no configured
 * fields at all. */
async function assertPatchCustomDataRequirements(
  existing: { custom_data: unknown },
  profileChanges: ReturnType<typeof computePatchChanges>,
  rsvpChange: ReturnType<typeof computeRsvpChange>,
  loadAllowedFieldsOnce: () => Promise<EventItemContent[]>,
): Promise<{ error: string } | null> {
  if (!profileChanges && !rsvpChange) return null;

  let fields: EventItemContent[];
  try {
    fields = await loadAllowedFieldsOnce();
  } catch (err) {
    return { error: customDataErrorCode(err) };
  }
  if (fields.length === 0) return null;

  try {
    const nextCustomData =
      profileChanges?.data.custom_data !== undefined
        ? profileChanges.data.custom_data
        : existing.custom_data;
    assertCustomDataMeetsRequirements(fields, nextCustomData);
    return null;
  } catch (err) {
    return { error: customDataErrorCode(err) };
  }
}

/** Merges the resolved profile/RSVP/status changes into a single Prisma update payload. */
function buildPatchUpdateData(
  profileChanges: ReturnType<typeof computePatchChanges>,
  rsvpChange: ReturnType<typeof computeRsvpChange>,
  statusChange: PatchAttendeeStatusChange,
): Prisma.AttendeeUpdateInput {
  return {
    ...(profileChanges?.data ?? {}),
    ...(rsvpChange?.data ?? {}),
    ...(statusChange !== undefined ? { status: statusChange } : {}),
  };
}

/** Catalog membership check (batch 04 / #351), re-validated here (not on the bare `db` before
 * the transaction opened) and locked against a concurrent ticket-type DELETE (TOCTOU fix, code
 * review) - same rationale as handleCreateEventAttendee. Only taken when ticket_type is actually
 * changing to a new, non-empty value: computePatchChanges already excludes it from `fields` when
 * the patch leaves it untouched or resubmits the same value, and clearing it to null can't
 * orphan a reference, so neither case needs the lock. Throws the 400 Response for the
 * transaction's catch to surface. */
async function guardPatchTicketTypeChange(
  c: Context,
  tx: Prisma.TransactionClient,
  eventId: string,
  profileChanges: ReturnType<typeof computePatchChanges>,
  nextTicketType: string | null | undefined,
): Promise<void> {
  if (!profileChanges?.fields.includes("ticket_type") || !nextTicketType) return;
  await acquireEventTicketTypesLock(tx, eventId);
  const ticketTypeError = await validateTicketTypeCatalog(tx, eventId, nextTicketType);
  if (ticketTypeError) throw c.json(ticketTypeError, 400);
}

/** Re-checks event capacity when a PATCH restores a previously non-admittable attendee to an
 * admittable status (capacity_reactivation), under the same advisory lock the create/check-in
 * paths use — returns the forced-admit detail for the audit log, or undefined when nothing
 * needed forcing (or no restore happened at all). Throws the capacity Response for the
 * transaction's catch to surface. */
async function guardPatchCapacityRestore(
  c: Context,
  tx: Prisma.TransactionClient,
  eventId: string,
  existingStatus: string,
  statusChange: PatchAttendeeStatusChange,
): Promise<{ forced: true; capacity: number; current: number } | undefined> {
  if (!isCapacityReactivation(existingStatus, statusChange)) return undefined;
  await acquireEventCapacityLock(tx, eventId);
  const capacityResult = await assertEventCapacityForIncoming(c, tx, eventId, 1);
  if (capacityResult instanceof Response) throw capacityResult;
  if (capacityResult && "forced" in capacityResult) return capacityResult;
  return undefined;
}

/** Any transition to a non-admittable status must not leave a stale admission behind —
 * restoring the pass later would otherwise resurrect a "checked in" state from before the
 * revoke without a new scan ever happening (PO review). isAdmittable() rather than a literal
 * "revoked" check so this still holds if the status enum this route accepts ever widens to
 * include "cancelled" (already a first-class AttendeeStatus, just not settable here yet).
 * `existingAdmittedAt` was read before the transaction started, so a concurrent request
 * (operator undo, another admin's revoke-check-in) may have already cleared it —
 * revokeCheckInMutation throws in that case; that's fine, there's nothing left to revoke, but it
 * must not abort the status change itself (bugbot). Uses the mutation-only helper (not
 * revokeCheckInTx) since this side-effect path builds its own response DTO and would otherwise
 * pay for an unused AttendeeCardDto build (event items, item states, notes, authors). Mutates
 * `result.row` in place so the caller's response DTO reflects the fresh admitted_at/updated_at. */
async function clearAdmissionOnNonAdmittableTransition(
  c: Context,
  tx: Prisma.TransactionClient,
  eventId: string,
  attendeeId: string,
  statusChange: PatchAttendeeStatusChange,
  existingAdmittedAt: Date | null,
  result: { row: { admitted_at: Date | null; updated_at: Date } },
): Promise<void> {
  if (statusChange === undefined || isAdmittable(statusChange) || !existingAdmittedAt) return;
  try {
    await revokeCheckInMutation({ eventId, attendeeId, audit: adminAuditFromContext(c) }, tx);
    // result.row was read before the clear above, and the mutation's own attendee update bumps
    // updated_at again (Attendee.updated_at is @updatedAt) — re-read both so the response DTO's
    // expected_updated_at stays valid for the client's next edit.
    const fresh = await tx.attendee.findUniqueOrThrow({
      where: { id: attendeeId },
      select: { admitted_at: true, updated_at: true },
    });
    result.row.admitted_at = fresh.admitted_at;
    result.row.updated_at = fresh.updated_at;
  } catch (err) {
    if (!(err instanceof UndoNotAllowedError)) throw err;
  }
}

/** Core PATCH transaction body: re-validates ticket_type/capacity under their advisory locks,
 * applies the CAS update, clears a stale admission on a non-admittable transition, and writes
 * one action-log entry per kind of change that actually happened. Extracted out of
 * `handlePatchEventAttendee` (as a plain named function, not an inline callback) so its own
 * Cognitive Complexity stays within limits. */
async function runPatchAttendeeTransaction(
  tx: Prisma.TransactionClient,
  ctx: {
    c: Context;
    eventId: string;
    attendeeId: string;
    existing: { status: string; admitted_at: Date | null };
    profileChanges: ReturnType<typeof computePatchChanges>;
    profilePatchTicketType: string | null | undefined;
    rsvpChange: ReturnType<typeof computeRsvpChange>;
    statusChange: PatchAttendeeStatusChange;
    expectedUpdatedAt: Date;
    updateData: Prisma.AttendeeUpdateInput;
  },
): Promise<Prisma.AttendeeGetPayload<{ select: typeof ATTENDEE_DETAIL_SELECT }>> {
  const {
    c,
    eventId,
    attendeeId,
    existing,
    profileChanges,
    profilePatchTicketType,
    rsvpChange,
    statusChange,
    expectedUpdatedAt,
    updateData,
  } = ctx;

  await guardPatchTicketTypeChange(c, tx, eventId, profileChanges, profilePatchTicketType);

  const restoreCapacityForced = await guardPatchCapacityRestore(
    c,
    tx,
    eventId,
    existing.status,
    statusChange,
  );

  const result = await optimisticAttendeeUpdate(tx, {
    id: attendeeId,
    expectedUpdatedAt,
    data: updateData,
    select: ATTENDEE_DETAIL_SELECT,
  });

  if (isStaleWrite(result)) throw new StaleWriteError();

  await clearAdmissionOnNonAdmittableTransition(
    c,
    tx,
    eventId,
    attendeeId,
    statusChange,
    existing.admitted_at,
    result,
  );

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
      metadata: { fields: profileChanges.fields, field_changes: profileChanges.valueChanges },
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
}

/** Maps a thrown error from the PATCH transaction to its HTTP response — extracted from
 * `handlePatchEventAttendee`'s catch block. */
function patchAttendeeErrorResponse(c: Context, err: unknown): Response {
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

/** PATCH /api/admin/events/:eventId/attendees/:id */
export async function handlePatchEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const attendeeContextOrRes = await requireManagedEventAttendee(c, db);
  if (attendeeContextOrRes instanceof Response) return attendeeContextOrRes;
  const { attendee: existing, attendeeId, eventId } = attendeeContextOrRes;

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

  let allowedFields: EventItemContent[] | undefined;
  async function loadAllowedFieldsOnce(): Promise<EventItemContent[]> {
    allowedFields ??= await loadEventCustomDataFields(db, eventId);
    return allowedFields;
  }

  const profilePatchError = await validateAndNormalizeProfilePatch(existing, profilePatch, loadAllowedFieldsOnce);
  if (profilePatchError) return c.json(profilePatchError, 400);

  const profileChanges = computePatchChanges(existing, profilePatch);
  const rsvpChange = computeRsvpChange(existing.rsvp_status, patchRsvp);
  const statusChange = computeStatusChange(existing.status, patchStatus);

  if (!profileChanges && !rsvpChange && !statusChange) {
    const dto = await buildAttendeeDetailDto(db, eventId, existing);
    return c.json(dto);
  }

  const requirementsError = await assertPatchCustomDataRequirements(
    existing,
    profileChanges,
    rsvpChange,
    loadAllowedFieldsOnce,
  );
  if (requirementsError) return c.json(requirementsError, 400);

  const expectedUpdatedAtResult = parseExpectedUpdatedAt(expectedUpdatedAtRaw);
  if (!(expectedUpdatedAtResult instanceof Date)) return c.json(expectedUpdatedAtResult, 400);
  const expectedUpdatedAt = expectedUpdatedAtResult;

  const updateData = buildPatchUpdateData(profileChanges, rsvpChange, statusChange);

  try {
    const updated = await db.$transaction((tx) =>
      runPatchAttendeeTransaction(tx, {
        c,
        eventId,
        attendeeId,
        existing,
        profileChanges,
        profilePatchTicketType: profilePatch.ticket_type,
        rsvpChange,
        statusChange,
        expectedUpdatedAt,
        updateData,
      }),
    );

    const dto = await buildAttendeeDetailDto(db, eventId, updated);
    return c.json(dto);
  } catch (err) {
    return patchAttendeeErrorResponse(c, err);
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
      select: {
        event_id: true,
        name: true,
        email: true,
        event: { select: { organization_id: true, title: true } },
      },
    });
    if (!existing || existing.event_id !== eventId) return "forbidden" as const;

    const [emailDeliveries, walletPasses, checkIns] = await Promise.all([
      tx.emailDelivery.deleteMany({ where: { event_id: eventId, attendee_id: attendeeId } }),
      tx.walletPass.deleteMany({ where: { attendee_id: attendeeId } }),
      tx.checkIn.deleteMany({ where: { event_id: eventId, attendee_id: attendeeId } }),
    ]);

    const attendeeDelete = await tx.attendee.deleteMany({ where: { id: attendeeId, event_id: eventId } });
    if (attendeeDelete.count === 0) return "gone" as const;

    const audit = adminAuditFromContext(c);
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "attendee_erased",
      audit,
      metadata: {
        attendee_id: attendeeId,
        removed: {
          email_deliveries: emailDeliveries.count,
          wallet_passes: walletPasses.count,
          check_ins: checkIns.count,
        },
      },
    });
    // Also written to the central admin audit log (Instance Settings → Audit log) - the
    // attendee's own AttendeeActionLog trail disappears along with the row it's about (PO
    // review: no central record of who erased an attendee, unlike event/user/session actions).
    // Deliberately includes the erased attendee's name/email here, unlike
    // writeBulkActionLog's own erasure entry above - a superadmin-only security/incident
    // record needs to answer "who was deleted" (e.g. a compromised admin account mass-erasing
    // attendees) to meet GDPR Art. 33/34 breach-notification duties, which is impossible if
    // the identity is gone from every table. Lawful basis: Art. 6(1)(f) legitimate interest
    // (security monitoring), scoped to this one admin-only log - not the erasure action itself.
    await writeAdminAuditLog(tx, {
      organizationId: existing.event.organization_id,
      actorUserId: audit.operator ?? c.get("auth").userId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      actionType: "attendee_erased",
      metadata: {
        event_id: eventId,
        event_title: existing.event.title,
        attendee_id: attendeeId,
        attendee_name: existing.name,
        attendee_email: existing.email,
      },
    });
    return "deleted" as const;
  });

  if (result === "forbidden") return c.json({ error: "forbidden" }, 403);
  return c.body(null, 204);
}

const bulkDeleteAttendeesBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

/** POST /api/admin/events/:eventId/attendees/bulk-delete — GDPR erasure for a selection of
 * attendees at once, from the Attendees list's row-selection bulk bar. Same per-attendee
 * cleanup and audit trail as the single-attendee DELETE above, just batched; ids that don't
 * belong to this event are silently ignored rather than failing the whole request (the UI can
 * only ever select rows already scoped to the current event's current page). */
export async function handleBulkDeleteEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
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
  const parsed = bulkDeleteAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const deletedCount = await db.$transaction(async (tx) => {
    const owned = await tx.attendee.findMany({
      where: { id: { in: parsed.data.attendeeIds }, event_id: eventId },
      select: { id: true, name: true, email: true },
    });
    if (owned.length === 0) return 0;
    const ids = owned.map((a) => a.id);

    const [emailDeliveries, walletPasses, checkIns] = await Promise.all([
      tx.emailDelivery.deleteMany({ where: { event_id: eventId, attendee_id: { in: ids } } }),
      tx.walletPass.deleteMany({ where: { attendee_id: { in: ids } } }),
      tx.checkIn.deleteMany({ where: { event_id: eventId, attendee_id: { in: ids } } }),
    ]);

    // Raw DELETE ... RETURNING instead of deleteMany: a concurrent request can erase an
    // overlapping attendee between the findMany above and this statement, and deleteMany only
    // reports a count, not which rows it actually removed. RETURNING captures exactly what this
    // statement deleted, so the audit entries below can't over-report who this request erased
    // (CodeRabbit review).
    const deleted = await tx.$queryRaw<{ id: string; name: string; email: string }[]>`
      DELETE FROM "Attendee" WHERE id IN (${Prisma.join(ids)}) AND event_id = ${eventId}
      RETURNING id, name, email
    `;
    if (deleted.length === 0) return 0;

    const audit = adminAuditFromContext(c);
    await writeBulkActionLog(tx, {
      event_id: eventId,
      action_type: "attendees_bulk_erased",
      audit,
      metadata: {
        attendee_ids: deleted.map((a) => a.id),
        removed: {
          email_deliveries: emailDeliveries.count,
          wallet_passes: walletPasses.count,
          check_ins: checkIns.count,
        },
      },
    });
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { organization_id: true, title: true } });
    // See the matching note on attendee_erased above - name/email are deliberately included in
    // this one central, superadmin-only log (not the erasure action's own AttendeeActionLog
    // entry) so a security incident affecting multiple attendees at once is investigable.
    await writeAdminAuditLog(tx, {
      organizationId: event?.organization_id ?? null,
      actorUserId: audit.operator ?? c.get("auth").userId,
      sessionId: audit.sessionId,
      ip: audit.ip,
      actionType: "attendees_bulk_erased",
      metadata: {
        event_id: eventId,
        event_title: event?.title,
        count: deleted.length,
        attendees: deleted.map((a) => ({ id: a.id, name: a.name, email: a.email })),
      },
    });
    return deleted.length;
  });

  return c.json({ deletedCount });
}

/** One row's computed bulk write, shared by every "assign one field to every selected
 * attendee" endpoint below: the value this row held for the field being changed *before* this
 * request — the per-row CAS key `applyBulkAttendeeChanges` re-validates at write time, so a
 * concurrent edit (e.g. the single-attendee PATCH) that changes it first isn't silently
 * clobbered and doesn't get a log entry recording a "from" value the row no longer actually
 * held (code review, PR #569) — and the audit-log metadata to record for it. `null` means the
 * row is already at the target value. */
type BulkFieldChange = { oldValue: string | null; metadata: Record<string, unknown> };

function computeTicketTypeChange(existingTicketType: string | null, target: string): BulkFieldChange | null {
  if (existingTicketType === target) return null;
  return {
    oldValue: existingTicketType,
    metadata: { fields: ["ticket_type"], field_changes: { ticket_type: { from: existingTicketType, to: target } } },
  };
}

/** Diffs already-fetched owned rows against a target, writes only the ones that actually
 * change, logs one entry per changed row, and reports updated/already-set/conflict counts for
 * the bulk bar's toast — the part of a "plain bulk field write" endpoint that's genuinely
 * identical regardless of which field is being assigned (bot review: bulk-ticket-type and
 * bulk-rsvp had independently duplicated this whole tail end). The write itself is a single
 * per-row-conditional `UPDATE ... FROM (VALUES ...)` statement, not a blanket `id IN (...)`
 * updateMany: one round trip regardless of selection size (up to BULK_SEND_LIMIT), keyed on
 * each row's own `oldValue` above, so a row a concurrent write changes in the window between
 * the caller's findMany and this statement is left untouched instead of overwritten (code
 * review, PR #569) — mirrors handleBulkDeleteEventAttendees's raw DELETE ... RETURNING above for
 * the same "report exactly which rows this statement actually touched" reason. Each caller still
 * does its own findMany (own select) and any pre-transaction validation/locking (e.g. the
 * ticket-type catalog lock) before calling this, and supplies the SET clause and target column
 * for its own field (`write` below) since those genuinely differ per caller. */
async function applyBulkAttendeeChanges<Row extends { id: string }>(
  tx: Prisma.TransactionClient,
  eventId: string,
  owned: Row[],
  computeChange: (row: Row) => BulkFieldChange | null,
  actionType: string,
  audit: OpsAuditContext,
  write: {
    /** Quoted column identifier the per-row CAS re-validates, e.g. `Prisma.raw('"ticket_type"')`. */
    column: Prisma.Sql;
    setClause: Prisma.Sql;
  },
): Promise<{ updatedCount: number; alreadySetCount: number; conflictCount: number }> {
  const changes: Array<{ id: string; oldValue: string | null; metadata: Record<string, unknown> }> = [];
  for (const row of owned) {
    const change = computeChange(row);
    if (change) changes.push({ id: row.id, oldValue: change.oldValue, metadata: change.metadata });
  }
  if (changes.length === 0) {
    return { updatedCount: 0, alreadySetCount: owned.length, conflictCount: 0 };
  }

  const values = Prisma.join(changes.map((x) => Prisma.sql`(${x.id}::text, ${x.oldValue}::text)`));
  // IS NOT DISTINCT FROM (not =) — a null-safe equality that correlates a NULL oldValue
  // correctly (a plain `=` never matches NULL = NULL) and behaves identically to `=` for a
  // non-nullable column, so there's no separate flag to get wrong per caller (bot review: a
  // caller could otherwise pass the wrong nullability for its own column and silently miscount).
  const updated = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Attendee" AS t
    SET ${write.setClause}
    FROM (VALUES ${values}) AS v(id, old_value)
    WHERE t.id = v.id AND t.event_id = ${eventId} AND t.${write.column} IS NOT DISTINCT FROM v.old_value
    RETURNING t.id
  `;
  const updatedIds = new Set(updated.map((r) => r.id));
  const succeeded = changes.filter((x) => updatedIds.has(x.id));

  // Only for rows the CAS above actually touched — a row that lost the race never got this
  // write, so logging it here would fabricate a "from" value the row didn't hold at write time.
  if (succeeded.length > 0) {
    await writeActionLogMany(tx, {
      event_id: eventId,
      action_type: actionType,
      audit,
      entries: succeeded.map((x) => ({ attendee_id: x.id, metadata: x.metadata })),
    });
  }

  return {
    updatedCount: succeeded.length,
    alreadySetCount: owned.length - changes.length,
    conflictCount: changes.length - succeeded.length,
  };
}

const bulkTicketTypeBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
    ticket_type: z.string().trim().min(1).max(100),
  })
  .strict();

/** POST /api/admin/events/:eventId/attendees/bulk-ticket-type — assign one catalog ticket type
 * to every selected attendee at once, from the Attendees list's row-selection bulk bar. No
 * expected_updated_at from the client (unlike the single-attendee PATCH) — the list reloads
 * after the action and re-applying the same type is harmless — but `applyBulkAttendeeChanges`'s
 * write is still a per-row CAS on the exact ticket_type value read below, not a blanket write:
 * see its own doc comment. Ids that don't belong to this event are silently ignored, matching
 * bulk delete/check-in. Catalog membership is validated once inside the transaction, under the
 * same advisory lock ticket-type DELETE takes (TOCTOU — same rationale as the single-attendee
 * PATCH), so the picked type can't be deleted out from under the write between the picker
 * opening and submit. Rows that already have the target type are left untouched (no updated_at
 * bump, no log entry) and reported back as alreadySetCount; rows that lost the race against a
 * concurrent write are also left untouched and reported back as conflictCount, both for the
 * toast breakdown. */
export async function handleBulkTicketTypeEventAttendees(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
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
  const parsed = bulkTicketTypeBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);
  const { attendeeIds, ticket_type } = parsed.data;

  try {
    const counts = await db.$transaction(async (tx) => {
      await acquireEventTicketTypesLock(tx, eventId);
      const ticketTypeError = await validateTicketTypeCatalog(tx, eventId, ticket_type);
      if (ticketTypeError) throw c.json(ticketTypeError, 400);

      const owned = await tx.attendee.findMany({
        where: { id: { in: attendeeIds }, event_id: eventId },
        select: { id: true, ticket_type: true },
      });
      return applyBulkAttendeeChanges(
        tx,
        eventId,
        owned,
        (a) => computeTicketTypeChange(a.ticket_type, ticket_type),
        "attendee_edited",
        adminAuditFromContext(c),
        {
          column: Prisma.raw('"ticket_type"'),
          setClause: Prisma.sql`ticket_type = ${ticket_type}, updated_at = NOW()`,
        },
      );
    });

    return c.json(counts);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("handleBulkTicketTypeEventAttendees failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

const bulkRsvpBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
    rsvp_status: rsvpStatusSchema,
  })
  .strict();

/** POST /api/admin/events/:eventId/attendees/bulk-rsvp — set the attendance (RSVP) status for
 * every selected attendee at once, from the Attendees list's row-selection bulk bar. Same
 * per-row-CAS write shape as bulk-ticket-type above (see `applyBulkAttendeeChanges`'s doc
 * comment for the full rationale), minus the catalog/advisory-lock step — RSVP status is a
 * fixed enum, not a per-event catalog, so there's nothing that can be deleted out from under the
 * write. Ids that don't belong to this event are silently ignored, matching every other bulk
 * action. Rows already at the target status are left untouched (no rsvp_updated_at bump, no log
 * entry) and reported back as alreadySetCount; rows that lost the race against a concurrent
 * write are also left untouched and reported back as conflictCount, both for the toast
 * breakdown. */
export async function handleBulkRsvpEventAttendees(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
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
  const parsed = bulkRsvpBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);
  const { attendeeIds, rsvp_status } = parsed.data;

  try {
    const counts = await db.$transaction(async (tx) => {
      const owned = await tx.attendee.findMany({
        where: { id: { in: attendeeIds }, event_id: eventId },
        select: { id: true, rsvp_status: true },
      });
      // Reuses computeRsvpChange - the same "is this actually a change, what's the from/to for
      // the log entry" logic the single-attendee PATCH path uses - so the two paths can't
      // silently diverge (e.g. if rsvp_source is later derived per-actor there). Its own
      // `.data` isn't used here - the write below sets rsvp_updated_at/rsvp_source itself.
      return applyBulkAttendeeChanges(
        tx,
        eventId,
        owned,
        (a) => {
          const change = computeRsvpChange(a.rsvp_status, rsvp_status);
          return change && { oldValue: change.from, metadata: { from: change.from, to: change.to, source: "admin" } };
        },
        "rsvp_status_changed",
        adminAuditFromContext(c),
        {
          column: Prisma.raw('"rsvp_status"'),
          setClause: Prisma.sql`rsvp_status = ${rsvp_status}, rsvp_updated_at = NOW(), rsvp_source = 'admin', updated_at = NOW()`,
        },
      );
    });

    return c.json(counts);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("handleBulkRsvpEventAttendees failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}

const bulkCheckInAttendeesBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

/**
 * How many attendees' own per-attendee transactions run concurrently within one chunk of a bulk
 * check-in *or* its bulk-revoke-checkin sibling below (shared, despite the name — the two bound
 * the same shape of per-attendee transaction fan-out, so a throughput change to one is a
 * throughput change to both; tune deliberately). Each attendee still gets its own
 * `admitAttendee`/`revokeCheckInMutation` transaction (unchanged); this only bounds how many of
 * those are in flight at once, matching `packages/tickets/src/bulk-revoke.ts`'s
 * BULK_REVOKE_CONCURRENCY for the same shape of per-attendee transaction fan-out.
 */
const BULK_CHECKIN_CONCURRENCY = 10;

/** Split an array into fixed-size chunks (last chunk may be smaller) — same helper as
 * `packages/tickets/src/bulk-revoke.ts`'s local `chunk`, duplicated here rather than shared
 * since it's a trivial, dependency-free six-liner and this file is in a different package. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Maps each admitAttendee outcome to its bulk check-in response counter. `satisfies` keeps the
 * map exhaustive: adding a new AdmitResult status fails the build here instead of silently
 * falling through. */
const BULK_CHECKIN_STATUS_COUNTER = {
  VALID: "checkedIn",
  ALREADY_CHECKED_IN: "alreadyCheckedIn",
  REVOKED: "revoked",
  INVALID: "invalid",
} as const satisfies Record<
  AdmitResult["status"],
  "checkedIn" | "alreadyCheckedIn" | "revoked" | "invalid"
>;

/** POST /api/admin/events/:eventId/attendees/bulk-checkin — manual check-in for a selection of
 * attendees at once, from the Attendees list's row-selection bulk bar. Reuses `admitAttendee`
 * (the same single-use CAS path scan check-in already goes through, ADR 0010 §4) once per
 * selected id rather than a bespoke bulk update, so every existing guarantee — CAS, per-attendee
 * AttendeeActionLog write, badge issuance — applies unchanged; ids that don't belong to this
 * event are silently ignored, same convention as bulk-delete. Attendees are processed in
 * bounded-concurrency chunks (BULK_CHECKIN_CONCURRENCY) rather than fully serially, for
 * throughput on large selections, while each attendee keeps its own independent CAS transaction —
 * same shape as `revokeAllCheckInsForEvent`. Uses Promise.allSettled (not Promise.all) per chunk:
 * admitAttendee has no analogous "expected race" exception to catch-and-skip like bulk-revoke's
 * UndoNotAllowedError (it already reports a losing race as ALREADY_CHECKED_IN/REVOKED via its
 * return value, not a throw), so any throw here represents a genuine, unexpected per-attendee
 * failure rather than a routine race — but discarding an entire chunk's already-committed
 * siblings over one such failure (Promise.all's behavior) would silently under-report a mostly-
 * successful bulk operation. Settling lets every attendee's own transaction outcome be counted
 * regardless of its neighbors. */
export async function handleBulkCheckInEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
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
  const parsed = bulkCheckInAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const owned = await db.attendee.findMany({
    where: { id: { in: parsed.data.attendeeIds }, event_id: eventId },
    select: { id: true },
  });

  const audit = adminAuditFromContext(c);
  const counts = { checkedIn: 0, alreadyCheckedIn: 0, revoked: 0, invalid: 0, errored: 0 };
  for (const batch of chunk(owned, BULK_CHECKIN_CONCURRENCY)) {
    const settled = await Promise.allSettled(
      batch.map(({ id }) => admitAttendee({ attendeeId: id, eventId, method: "manual", audit }, db)),
    );
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        console.error("bulk check-in: admitAttendee failed:", outcome.reason);
        counts.errored += 1;
        continue;
      }
      counts[BULK_CHECKIN_STATUS_COUNTER[outcome.value.status]] += 1;
    }
  }

  return c.json(counts);
}

const bulkRevokeCheckInAttendeesBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

const bulkRevokePassAttendeesBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

/** POST /api/admin/events/:eventId/attendees/bulk-revoke-checkin — undo check-in for a selection
 * of attendees at once, from the Attendees list's row-selection bulk bar. Mirrors bulk-checkin's
 * shape (owned-id lookup, chunked Promise.allSettled, per-attendee independent transaction) but
 * calls `revokeCheckInMutation` directly rather than `revokeCheckIn` — a bulk response only needs
 * counts, not each attendee's full AttendeeCardDto, so this skips the per-attendee
 * getAttendeeCard query that `revokeCheckIn`/`revokeCheckInTx` would otherwise pay for
 * needlessly. `resetItems: true` matches the single-attendee "Revoke check-in" action (not the
 * pass-status-change path's resetItems: false), so a bulk revoke also clears handed-out items,
 * same as revoking one attendee at a time.
 *
 * `UndoNotAllowedError` (not currently admitted, or lost a concurrent race) and
 * `IllegalItemTransitionError` (pass already revoked/cancelled, so the item-reset cascade
 * refuses) are both routine, expected per-attendee outcomes for a bulk selection that may mix
 * already-clean attendees in with ones to revoke — counted, not treated as failures. Only a
 * genuinely unexpected throw counts as `errored`. */
export async function handleBulkRevokeCheckInEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
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
  const parsed = bulkRevokeCheckInAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const owned = await db.attendee.findMany({
    where: { id: { in: parsed.data.attendeeIds }, event_id: eventId },
    select: { id: true },
  });

  const audit = adminAuditFromContext(c);
  const counts = { revoked: 0, notAdmitted: 0, blocked: 0, errored: 0 };
  for (const batch of chunk(owned, BULK_CHECKIN_CONCURRENCY)) {
    const settled = await Promise.allSettled(
      batch.map(({ id }) =>
        db.$transaction((tx) =>
          revokeCheckInMutation({ eventId, attendeeId: id, audit, resetItems: true }, tx),
        ),
      ),
    );
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        counts.revoked += 1;
        continue;
      }
      if (outcome.reason instanceof UndoNotAllowedError) {
        counts.notAdmitted += 1;
      } else if (outcome.reason instanceof IllegalItemTransitionError) {
        counts.blocked += 1;
      } else {
        console.error("bulk revoke check-in: revokeCheckInMutation failed:", outcome.reason);
        counts.errored += 1;
      }
    }
  }

  return c.json(counts);
}

const bulkRevokeItemsAttendeesBodySchema = z
  .object({
    attendeeIds: z.array(z.string()).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

/** POST /api/admin/events/:eventId/attendees/bulk-revoke-items — reset every issued/returned
 * item hand-out back to "pending" for a selection of attendees at once, from the Attendees
 * list's row-selection bulk bar. Independent of check-in status, like its Danger Zone sibling
 * (event-wide "Revoke all items issued") — this is the same per-attendee reset scoped to an
 * explicit selection instead of the whole event; `revokeItemsForAttendees` already owns the
 * id-scoping, chunking, and per-attendee blocked-pass tolerance, so this handler is just
 * validation + the call. Regular admin (not superadmin-only, unlike the Danger Zone version),
 * matching the other bulk-selection actions in this file. */
export async function handleBulkRevokeAttendeeItems(c: Context, db: PrismaClient): Promise<Response> {
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
  const parsed = bulkRevokeItemsAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const audit = adminAuditFromContext(c);
  const revokedCount = await revokeItemsForAttendees(db, {
    eventId,
    attendeeIds: parsed.data.attendeeIds,
    audit,
  });

  return c.json({ revokedCount });
}

/** Revokes a single attendee's pass (status -> revoked), same effect as the single-attendee
 * PATCH's status-change branch but scoped to just that transition - no profile/RSVP fields, no
 * expected_updated_at optimistic-concurrency check (a bulk selection doesn't carry a per-row
 * version to compare against, so a plain CAS on status is the concurrency guard instead: only
 * attendees still in an admittable status get flipped - `ADMITTABLE_STATUS_LIST` rather than a
 * literal ["revoked","cancelled"] exclusion, so this stays correct if the status enum this route
 * accepts ever widens, matching the single-attendee PATCH handler's own isAdmittable() guard).
 * Skips (does not touch) an attendee whose status is already "revoked" or "cancelled" - matches
 * the single-attendee "Revoke pass" row button, which is hidden (not just disabled) in both
 * those cases, so a bulk selection that happens to include one is simply left alone rather than
 * treated as a failure.
 *
 * Mirrors the single-attendee route's cascade: an admitted attendee whose pass is revoked must
 * not keep a stale admission (restoring the pass later would otherwise resurrect a "checked in"
 * state without a new scan). Always attempts `revokeCheckInMutation` rather than gating on a
 * pre-batch `admitted_at` snapshot (code review) - attendeeIds can be up to BULK_SEND_LIMIT,
 * processed in sequential chunks, so a snapshot read before the batch started could be stale by
 * the time this specific attendee's own transaction runs (e.g. an operator scans them in mid-
 * batch); `revokeCheckInMutation` re-reads `admitted_at` fresh inside this same transaction and
 * throws `UndoNotAllowedError` (caught below, not a failure) if there's genuinely nothing to
 * clear. `resetItems` defaults to false - handed-out items stay handed out when only the pass is
 * revoked, same as the single-attendee path; only the explicit "Revoke check-in" action clears
 * items. */
async function revokeOneAttendeePass(
  eventId: string,
  attendeeId: string,
  previousStatus: AttendeeStatus,
  audit: OpsAuditContext,
  db: PrismaClient,
): Promise<"revoked" | "skipped"> {
  return db.$transaction(async (tx) => {
    const updated = await tx.attendee.updateMany({
      where: { id: attendeeId, event_id: eventId, status: { in: ADMITTABLE_STATUS_LIST } },
      data: { status: "revoked" },
    });
    if (updated.count === 0) return "skipped";

    try {
      await revokeCheckInMutation({ eventId, attendeeId, audit }, tx);
    } catch (err) {
      if (!(err instanceof UndoNotAllowedError)) throw err;
    }

    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: attendeeId,
      action_type: "pass_revoked",
      audit,
      metadata: { previous_status: previousStatus },
    });

    return "revoked";
  });
}

/** POST /api/admin/events/:eventId/attendees/bulk-revoke-pass — revoke the pass for a selection
 * of attendees at once, from the Attendees list's row-selection bulk bar. Same
 * owned-id/chunked-Promise.allSettled shape as the sibling bulk endpoints in this file. */
export async function handleBulkRevokeAttendeePass(c: Context, db: PrismaClient): Promise<Response> {
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
  const parsed = bulkRevokePassAttendeesBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const owned = await db.attendee.findMany({
    where: { id: { in: parsed.data.attendeeIds }, event_id: eventId },
    select: { id: true, status: true },
  });

  const audit = adminAuditFromContext(c);
  const counts = { revoked: 0, skipped: 0, errored: 0 };
  for (const batch of chunk(owned, BULK_CHECKIN_CONCURRENCY)) {
    const settled = await Promise.allSettled(
      batch.map((a) =>
        revokeOneAttendeePass(eventId, a.id, a.status as AttendeeStatus, audit, db),
      ),
    );
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        console.error("bulk revoke pass: revokeOneAttendeePass failed:", outcome.reason);
        counts.errored += 1;
        continue;
      }
      counts[outcome.value] += 1;
    }
  }

  return c.json(counts);
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
      // Catalog membership check (batch 04 / #351) - moved inside the transaction and locked
      // against a concurrent ticket-type DELETE (TOCTOU fix, code review): validating on the bare
      // `db` before this transaction opened let a concurrent delete's in-use recheck pass (it
      // couldn't see this uncommitted row) and remove the type this attendee is about to
      // reference. Only taken when a type is actually being set, so attendees that don't
      // reference one at all never pay for the lock.
      if (ticket_type) {
        await acquireEventTicketTypesLock(tx, eventId);
        const ticketTypeError = await validateTicketTypeCatalog(tx, eventId, ticket_type);
        if (ticketTypeError) throw c.json(ticketTypeError, 400);
      }

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
          client_timezone: resolveClientTimezone(c),
        },
        select: ATTENDEE_DETAIL_SELECT,
      });

      const audit = adminAuditFromContext(c);
      await writeActionLog(tx, {
        event_id: eventId,
        attendee_id: row.id,
        action_type: "attendee_created_manual",
        audit,
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
      // Also written to the central admin audit log (Instance Settings → Audit log) - see
      // the matching note on attendee_erased above for why attendee lifecycle events need a
      // record outside the attendee's own (deletable) AttendeeActionLog trail.
      const event = await tx.event.findUnique({ where: { id: eventId }, select: { organization_id: true, title: true } });
      await writeAdminAuditLog(tx, {
        organizationId: event?.organization_id ?? null,
        actorUserId: audit.operator ?? c.get("auth").userId,
        sessionId: audit.sessionId,
        ip: audit.ip,
        actionType: "attendee_created_manual",
        metadata: {
          event_id: eventId,
          event_title: event?.title,
          attendee_id: row.id,
          attendee_name: row.name,
          attendee_email: row.email,
        },
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
  const attendeeContextOrRes = await requireManagedEventAttendee(c, db);
  if (attendeeContextOrRes instanceof Response) return attendeeContextOrRes;
  const { attendee: existing, attendeeId, eventId } = attendeeContextOrRes;

  let body: unknown;
  const parsedBody = await parseOptionalJsonBody(c);
  if (parsedBody instanceof Response) return parsedBody;
  body = parsedBody;

  const parsed = resendBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const to = parsed.data.to;
  const alternate = Boolean(to && to !== existing.email);

  // SECURITY NOTE (ADR 0021): `to` is validated as email format only — no domain allowlist.
  // Per-attendee and global-per-user rate limits apply. All resends are audit-logged.
  // A domain allowlist per org/event is planned for v0.5 (see follow-up task).
  // Rationale: admins legitimately resend to corporate relay addresses outside the registrant's
  // personal domain; a hardcoded allowlist would break that use-case without org configuration.
  const baseUrlOrRes = await resolveMailInstanceBaseUrl(c, db, process.env, injectedBaseUrl);
  if (baseUrlOrRes instanceof Response) return baseUrlOrRes;
  let sendResult;
  try {
    sendResult = await resendTicketEmail(attendeeId, db, process.env, mailDeps, {
      to,
      baseUrl: baseUrlOrRes,
      timezone: resolveClientTimezone(c) ?? undefined,
    });
  } catch (err) {
    const mailErr = mailNotConfiguredResponse(c, err);
    if (mailErr) return mailErr;
    throw err;
  }

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
  if (!existing) return c.json({ error: "forbidden" }, 403);

  try {
    const result = await revokeCheckIn(
      { eventId, attendeeId, audit: adminAuditFromContext(c) },
      db,
    );
    return c.json(result);
  } catch (err) {
    if (err instanceof UndoNotAllowedError) {
      // Distinct messages for "genuinely not admitted" vs "lost a
      // concurrent-revoke race" (review finding) — matches the sibling
      // handleCheckinUndo's err.message passthrough for the same error type.
      return c.json({ error: err.message }, 409);
    }
    // revokeCheckIn cascades into the same item-reset path as handleRevokeAttendeeItem
    // (resetItems: true), which can throw IllegalItemTransitionError for a blocked pass —
    // reuse the same 409 mapping instead of falling through to a raw 500.
    return itemTransitionErrorResponse(c, err, "handleRevokeAttendeeCheckIn");
  }
}

/**
 * POST /api/admin/events/:eventId/attendees/:id/items/:itemKey/revoke
 * Admin/superadmin only (assertEventManageAccess) — resets an already-handed-out
 * item back to "pending" so it can be issued again ("cofnąć to że się to
 * wydało"). A privileged corrective action, deliberately outside the operator's
 * forward-only item state machine. Returns the refreshed AttendeeCardDto so the
 * caller can replace its local card state, matching the sibling item-action and
 * revoke-checkin endpoints.
 */
export async function handleRevokeAttendeeItem(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeIdOrRes = requireAttendeeId(c);
  if (attendeeIdOrRes instanceof Response) return attendeeIdOrRes;
  const attendeeId = attendeeIdOrRes;
  const itemKey = c.req.param("itemKey");
  if (!itemKey) return c.json({ error: "itemKey required" }, 400);

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const existing = await loadAttendeeInEvent(db, eventId, attendeeId);
  if (!existing) return c.json({ error: "forbidden" }, 403);

  try {
    await revokeItemState({ attendeeId, eventId, itemKey, audit: adminAuditFromContext(c) }, db);
    const card = await getAttendeeCard(eventId, attendeeId, db);
    return c.json({ card });
  } catch (err) {
    // e.g. unknown/disabled item key, blocked pass — mirrors the operator item-action route.
    return itemTransitionErrorResponse(c, err, "handleRevokeAttendeeItem");
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
  let sendResult;
  try {
    sendResult = await sendTicketEmails(
      eventId,
      {
        attendeeIds,
        purpose: mailPurpose,
        baseUrl: baseUrlOrRes,
        timezone: resolveClientTimezone(c) ?? undefined,
      },
      db,
      process.env,
      mailDeps,
    );
  } catch (err) {
    const mailErr = mailNotConfiguredResponse(c, err);
    if (mailErr) return mailErr;
    throw err;
  }

  const skipped = sendResult.skipped.length;
  const queued = sendResult.sent;
  const failed = sendResult.deliveries.length - sendResult.sent;

  await auditBulkTicketSend(db, c, eventId, { target, queued, skipped, failed });

  return c.json({ queued, skipped, failed } satisfies BulkResendDto);
}
