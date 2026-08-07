import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import {
  parseAttendees,
  commitImport,
  dryRunImportCounts,
  loadImportTicketTypes,
  type AttendeeRow,
  type ImportAttributeField,
  type SkippedRow,
} from "@admitto/import";
import { getDefaultStorage } from "@admitto/storage";
import {
  loadEventCustomDataFields,
  filterCustomDataAttributeFields,
} from "@admitto/tickets";
import { xlsxBufferToCsv, ImportRowLimitError, ImportZipBombError, MAX_CSV_CHARS, MAX_IMPORT_ROWS } from "./xlsx-to-csv.js";
import { logger } from "../logger.js";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  requireEventId,
  resolveClientTimezone,
} from "./admin-helpers.js";
import { assertEventCapacityForIncoming } from "./event-capacity.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Multipart framing overhead allowed on top of the file cap (body-limit middleware). */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
/** Maximum request body size for import routes (file cap plus multipart overhead). */
export const MAX_IMPORT_BODY_BYTES = MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES;

export type ImportInvalidRowDto = {
  rowIndex: number;
  reason: string;
};

/** Max valid rows returned in preview sample (data sanity check before commit). */
const SAMPLE_LIMIT = 20;

/** Max invalid/skipped rows returned per response (preview and commit alike). A file at
 * MAX_IMPORT_ROWS where every row is skipped (e.g. re-importing the same file with overwrite
 * off) would otherwise put 50 000 email/reason pairs in the payload and the admin SPA's table,
 * making both the request and the page unresponsive (CodeRabbit review). The true counts are
 * still returned in full via invalidCount/skippedCount. */
const ROW_DETAIL_LIMIT = 20;

/** One valid CSV row shaped for the import preview sample table (max SAMPLE_LIMIT per response). */
export type ImportSampleRow = {
  rowIndex: number;
  name: string;
  email: string;
  ticket_type: string;
  company: string;
  department: string;
  external_uuid: string;
  custom_data: Record<string, string>;
};

export type ImportPreviewDto = {
  importId: string;
  parse: {
    validCount: number;
    /** Capped at ROW_DETAIL_LIMIT; invalidCount below is the true total. */
    invalidRows: ImportInvalidRowDto[];
    invalidCount: number;
    warnings: string[];
  };
  summary: {
    toCreate: number;
    toUpdate: number;
    toSkip: number;
    /** Capped at ROW_DETAIL_LIMIT; toSkip above is the true total. */
    skipped: Array<{ email: string; reason: string }>;
  };
  sampleRows: ImportSampleRow[];
  attributeFieldLabels: Array<{ source_field: string; label: string }>;
};

export type ImportCommitDto = {
  importId: string;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  created: number;
  updated: number;
  /** Capped at ROW_DETAIL_LIMIT; toSkip above is the true total. */
  skipped: Array<{ email: string; reason: string }>;
  /**
   * Rows that failed the commit-time re-parse (e.g. a ticket type deleted from the catalog
   * between preview and commit) and were therefore never passed into commitImport at all - they
   * are not reflected in toCreate/toUpdate/toSkip/created/updated/skipped above. Same shape as
   * ImportPreviewDto's parse.invalidRows so the admin SPA can reuse its rendering. Capped at
   * ROW_DETAIL_LIMIT; invalidCount below is the true total.
   */
  invalidRows: ImportInvalidRowDto[];
  invalidCount: number;
};

/** 202 response after enqueueing an import commit for the Admitto worker. */
export type ImportCommitQueuedDto = {
  jobId: string;
  status: "pending";
  importId: string;
};

/** Poll payload for GET …/import/jobs/:jobId. */
export type ImportJobStatusDto = {
  jobId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  importId: string | null;
  error: string | null;
  result: ImportCommitDto | null;
};

type ImportFileType = "csv" | "xlsx";

type ParsedUpload = {
  csv: string;
  filename: string;
  overwrite: boolean;
  sizeBytes: number;
  ext: ImportFileType;
};

type UploadLogContext = {
  importId: string;
  eventId: string;
};

type UploadRejectReason =
  | "invalid_form_data"
  | "file_required"
  | "file_too_large"
  | "unsupported_file_type"
  | "invalid_file_content"
  | "too_many_rows"
  | "empty_file";

/** Lowercase file extension including the leading dot, or empty when absent. */
function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot).toLowerCase();
}

/** Map a dotted extension to a stable import file type label. */
function importFileType(ext: string): ImportFileType | null {
  if (ext === ".csv") return "csv";
  if (ext === ".xlsx") return "xlsx";
  return null;
}

/** Strip control chars and path segments from an uploaded filename for audit metadata. */
function sanitizeUploadFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  return cleaned.slice(0, 255) || "upload";
}

/** Reject CSV that exceeds post-decode row or character limits. */
function csvWithinLimits(csv: string): string | null {
  if (csv.length > MAX_CSV_CHARS) return "file too large";
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const dataRows = Math.max(0, lines.length - 1);
  if (dataRows > MAX_IMPORT_ROWS) return "too many rows";
  return null;
}

/** Defense-in-depth: XLSX must be ZIP (PK); CSV must not be a ZIP masquerading as text. */
function fileSignatureValid(buf: ArrayBuffer, ext: string): boolean {
  const bytes = new Uint8Array(buf);
  if (bytes.length === 0) return false;
  const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (ext === ".xlsx") return isZip;
  if (ext === ".csv") return !isZip;
  return false;
}

/** Decode an uploaded CSV or XLSX buffer to a CSV string (in memory). */
async function bufferToCsvString(buf: ArrayBuffer, ext: string): Promise<string> {
  if (ext === ".csv") {
    return new TextDecoder("utf-8").decode(buf);
  }
  return xlsxBufferToCsv(buf);
}

/** Remove cell-level values from parser diagnostics before returning preview to the client. */
function sanitizePreviewReason(reason: string): string {
  if (reason.startsWith("Invalid email:")) return "Invalid email format";
  if (reason.startsWith("Duplicate email in file:")) return "Duplicate email in file";
  if (reason.startsWith("Duplicate external_uuid in file:")) return "Duplicate external_uuid in file";
  if (reason.startsWith("Duplicate qr_payload in file:")) return "Duplicate qr_payload in file";
  if (reason.startsWith("Agency identifier collides")) {
    return "Agency identifier collides across columns";
  }
  if (reason.startsWith("Unknown ticket type:")) return "Unknown ticket type";
  return reason;
}

/** Strip any interpolated cell/column values from parser warning strings shown in preview. */
function sanitizePreviewWarning(warning: string): string {
  // "Row N: single-word name "Cher" — ..." → strip quoted name
  if (/^Row \d+: single-word name "/.test(warning)) {
    return warning.replace(/single-word name "[^"]*"/, "single-word name");
  }
  // "Unknown column ignored: "john@example.com"" → strip quoted value
  if (warning.startsWith('Unknown column ignored: "')) {
    return "Unknown column ignored";
  }
  // "Duplicate column(s) detected (first value used): col1, col2" → strip column list
  if (warning.startsWith("Duplicate column(s) detected")) {
    return "Duplicate column(s) detected";
  }
  return warning;
}

/**
 * Map parser invalid rows to response DTOs. Shared by the preview and commit responses so both
 * shape invalidRows identically.
 *
 * "Unknown ticket type: ..." keeps its raw value here — the admin currently fixing this import
 * needs to see which catalog value didn't match, same as before this reason gained a
 * sanitizePreviewReason case. That case exists only to keep the raw value out of the aggregated
 * log key in groupInvalidByType below (PII/log-leak fix, code review); this per-row response to
 * the uploading admin isn't a log-leak concern.
 */
function invalidRowsForResponse(
  invalidRows: { rowIndex: number; reason: string }[],
): ImportInvalidRowDto[] {
  return invalidRows.slice(0, ROW_DETAIL_LIMIT).map(({ rowIndex, reason }) => ({
    rowIndex,
    reason: reason.startsWith("Unknown ticket type:") ? reason : sanitizePreviewReason(reason),
  }));
}

/** Same cap as invalidRowsForResponse, for summary.skipped/body.skipped - both can span the
 * whole file (e.g. re-importing with overwrite off skips every row). */
function skippedRowsForResponse(skipped: SkippedRow[]): SkippedRow[] {
  return skipped.slice(0, ROW_DETAIL_LIMIT);
}

/** Group invalid rows by sanitized reason type — counts only, no cell values. */
function groupInvalidByType(invalidRows: { reason: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of invalidRows) {
    const key = sanitizePreviewReason(row.reason)
      .toLowerCase()
      .replace(/[^a-z_ ]/g, "")
      .trim()
      .replaceAll(" ", "_")
      .slice(0, 40);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Map parsed attendee rows to preview DTOs (first SAMPLE_LIMIT only).
 * PII is intentional — returned only to the admin who uploaded the file.
 *
 * @param rows - Valid rows from parseAttendees (includes file rowIndex).
 * @param attributeFields - Event custom attribute defs; keys populate custom_data on each sample row.
 */
function buildSampleRows(
  rows: AttendeeRow[],
  attributeFields: ImportAttributeField[],
): ImportSampleRow[] {
  return rows.slice(0, SAMPLE_LIMIT).map((row) => {
    const custom_data: Record<string, string> = {};
    for (const field of attributeFields) {
      custom_data[field.source_field] = row.custom_data?.[field.source_field] ?? "";
    }
    const firstName = row.first_name ?? "";
    const lastName = row.last_name ?? "";
    const name = [firstName, lastName].filter(Boolean).join(" ") || row.email;
    return {
      rowIndex: row.rowIndex,
      name,
      email: row.email,
      ticket_type: row.ticket_type ?? "",
      company: row.company ?? "",
      department: row.department ?? "",
      external_uuid: row.external_uuid ?? "",
      custom_data,
    };
  });
}

/** Log and return a 400 response for rejected uploads. */
function rejectUpload(
  c: Context,
  ctx: UploadLogContext,
  reason: UploadRejectReason,
  error: string,
  fields: {
    fileSizeBytes?: number;
    filename?: string;
  } = {},
): Response {
  logger.warn("Import upload rejected", {
    importId: ctx.importId,
    eventId: ctx.eventId,
    step: "upload_validation",
    reason,
    ...fields,
  });
  return c.json({ error, importId: ctx.importId }, 400);
}

/** Parse multipart upload, validate file type/size, and return CSV text or an error response. */
async function parseImportUpload(c: Context, ctx: UploadLogContext): Promise<ParsedUpload | Response> {
  let body: Record<string, string | File>;
  try {
    body = await c.req.parseBody();
  } catch {
    return rejectUpload(c, ctx, "invalid_form_data", "invalid form data");
  }

  const fileField = body.file;
  if (!(fileField instanceof File)) {
    return rejectUpload(c, ctx, "file_required", "file required");
  }

  const filename = sanitizeUploadFilename(fileField.name);

  if (fileField.size > MAX_FILE_BYTES) {
    return rejectUpload(c, ctx, "file_too_large", "file too large", {
      fileSizeBytes: fileField.size,
      filename,
    });
  }

  const extDot = fileExtension(fileField.name);
  const fileType = importFileType(extDot);
  if (!fileType) {
    return rejectUpload(c, ctx, "unsupported_file_type", "unsupported file type", {
      fileSizeBytes: fileField.size,
      filename,
    });
  }

  const overwriteRaw = body.overwrite;
  const overwrite = overwriteRaw === "true" || overwriteRaw === "on";

  const buf = await fileField.arrayBuffer();
  if (!fileSignatureValid(buf, extDot)) {
    return rejectUpload(c, ctx, "invalid_file_content", "invalid file content", {
      fileSizeBytes: fileField.size,
      filename,
    });
  }

  let csv: string;
  try {
    csv = await bufferToCsvString(buf, extDot);
  } catch (err) {
    if (err instanceof ImportRowLimitError || err instanceof ImportZipBombError) {
      return rejectUpload(c, ctx, "too_many_rows", "too many rows", {
        fileSizeBytes: fileField.size,
        filename,
      });
    }
    return rejectUpload(c, ctx, "invalid_file_content", "invalid file content", {
      fileSizeBytes: fileField.size,
      filename,
    });
  }

  const limitError = csvWithinLimits(csv);
  if (limitError === "file too large") {
    return rejectUpload(c, ctx, "file_too_large", "file too large", {
      fileSizeBytes: fileField.size,
      filename,
    });
  }
  if (limitError === "too many rows") {
    return rejectUpload(c, ctx, "too_many_rows", "too many rows", {
      fileSizeBytes: fileField.size,
      filename,
    });
  }

  if (!csv.trim()) {
    return rejectUpload(c, ctx, "empty_file", "empty file", {
      fileSizeBytes: fileField.size,
      filename,
    });
  }

  return {
    csv,
    filename,
    overwrite,
    sizeBytes: fileField.size,
    ext: fileType,
  };
}

/** POST /api/admin/events/:eventId/import/preview */
export async function handleImportPreview(c: Context, db: PrismaClient): Promise<Response> {
  const importId = randomUUID();
  const startTime = Date.now();

  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const uploadCtx: UploadLogContext = { importId, eventId };

  try {
    const upload = await parseImportUpload(c, uploadCtx);
    if (upload instanceof Response) return upload;

    const attributeFields = await loadImportAttributeFields(db, eventId);
    const ticketTypes = await loadImportTicketTypes(db, eventId);
    const parsed = parseAttendees(upload.csv, { attributeFields, ticketTypes });
    const summary = await commitImport(
      eventId,
      parsed.validRows,
      { dryRun: true, overwrite: upload.overwrite, attributeFields, ticketTypes },
      db,
    );

    const sampleRows = buildSampleRows(parsed.validRows, attributeFields);
    const attributeFieldLabels = attributeFields.map((f) => ({
      source_field: f.source_field,
      label: f.label,
    }));

    logger.info("Import preview complete", {
      importId,
      eventId,
      step: "preview",
      filename: upload.filename,
      fileSizeBytes: upload.sizeBytes,
      fileType: upload.ext,
      validCount: parsed.validRows.length,
      invalidCount: parsed.invalidRows.length,
      invalidRows: parsed.invalidRows.map((r) => r.rowIndex),
      invalidByType: groupInvalidByType(parsed.invalidRows),
      warningCount: parsed.warnings.length,
      toCreate: summary.toCreate,
      toUpdate: summary.toUpdate,
      toSkip: summary.toSkip,
      sampleCount: sampleRows.length,
      durationMs: Date.now() - startTime,
    });

    const body: ImportPreviewDto = {
      importId,
      parse: {
        validCount: parsed.validRows.length,
        invalidRows: invalidRowsForResponse(parsed.invalidRows),
        invalidCount: parsed.invalidRows.length,
        warnings: parsed.warnings.map(sanitizePreviewWarning),
      },
      summary: {
        toCreate: summary.toCreate,
        toUpdate: summary.toUpdate,
        toSkip: summary.toSkip,
        skipped: skippedRowsForResponse(summary.skipped),
      },
      sampleRows,
      attributeFieldLabels,
    };

    return c.json(body);
  } catch (err) {
    logger.error("Import preview failed", {
      importId,
      eventId,
      step: "preview",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    });
    return c.json({ error: "server error", importId }, 500);
  }
}

/** POST /api/admin/events/:eventId/import/commit — stage file + enqueue AdminJob (202). */
export async function handleImportCommit(c: Context, db: PrismaClient): Promise<Response> {
  const importId = randomUUID();
  const startTime = Date.now();

  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const uploadCtx: UploadLogContext = { importId, eventId };

  try {
    const upload = await parseImportUpload(c, uploadCtx);
    if (upload instanceof Response) return upload;

    const dry = await dryRunImportCounts(db, eventId, upload.csv, upload.overwrite);
    const capacityResult = await assertEventCapacityForIncoming(c, db, eventId, dry.toCreate);
    if (capacityResult instanceof Response) return capacityResult;
    const forceCapacity = Boolean(capacityResult && "forced" in capacityResult);

    const event = await db.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { organization_id: true },
    });
    const storage = getDefaultStorage();
    const staged = await storage.put(Buffer.from(upload.csv, "utf8"), {
      orgId: event.organization_id,
      eventId,
      scope: "event",
      ext: ".csv",
    });

    const audit = adminAuditFromContext(c);
    const job = await db.adminJob.create({
      data: {
        type: "import_commit",
        status: "pending",
        organization_id: event.organization_id,
        event_id: eventId,
        actor_user_id: audit.operator ?? null,
        session_id: audit.sessionId ?? null,
        client_timezone: resolveClientTimezone(c) ?? null,
        storage_key: staged.key,
        filename: upload.filename,
        overwrite: upload.overwrite,
        force_capacity: forceCapacity,
        import_id: importId,
      },
    });

    logger.info("Import commit queued", {
      importId,
      eventId,
      jobId: job.id,
      step: "enqueue",
      filename: upload.filename,
      fileSizeBytes: upload.sizeBytes,
      fileType: upload.ext,
      toCreate: dry.toCreate,
      toUpdate: dry.toUpdate,
      toSkip: dry.toSkip,
      durationMs: Date.now() - startTime,
    });

    return c.json(
      {
        jobId: job.id,
        status: "pending",
        importId,
      } satisfies ImportCommitQueuedDto,
      202,
    );
  } catch (err) {
    logger.error("Import commit enqueue failed", {
      importId,
      eventId,
      step: "enqueue",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    });
    return c.json({ error: "server error", importId }, 500);
  }
}

/** GET /api/admin/events/:eventId/import/jobs/:jobId */
export async function handleGetImportJob(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const jobId = c.req.param("jobId")?.trim();
  if (!jobId) return c.json({ error: "jobId required" }, 400);

  const job = await db.adminJob.findFirst({
    where: { id: jobId, event_id: eventId, type: "import_commit" },
  });
  if (!job) return c.json({ error: "not_found" }, 404);

  let result: ImportCommitDto | null = null;
  if (job.status === "succeeded" && job.result_json && typeof job.result_json === "object") {
    result = job.result_json as ImportCommitDto;
  }

  c.header("Cache-Control", "no-store");
  return c.json({
    jobId: job.id,
    status: job.status as ImportJobStatusDto["status"],
    importId: job.import_id,
    error: job.error,
    result,
  } satisfies ImportJobStatusDto);
}



const IMPORT_TEMPLATE_BASE_COLUMNS = [
  "first_name", "last_name", "email", "ticket_type", "company", "department", "external_uuid", "qr_payload",
] as const;

async function loadImportAttributeFields(
  db: PrismaClient,
  eventId: string,
): Promise<ImportAttributeField[]> {
  const fields = await loadEventCustomDataFields(db, eventId);
  return filterCustomDataAttributeFields(fields);
}

/** Newest-first page size for the import history card — one screen's worth, not an archive. */
const IMPORT_HISTORY_LIMIT = 20;

export type ImportHistoryEntryDto = {
  id: string;
  created_at: string;
  filename: string | null;
  created: number;
  updated: number;
  skipped: number;
};

function importHistoryNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Reads recent `attendees_imported` bulk action rows from the audit log - shared by the
 * import-history endpoint and the overview activity feed, which just need different limits. */
export async function loadRecentImportBatches(
  db: PrismaClient,
  eventId: string,
  limit: number,
): Promise<ImportHistoryEntryDto[]> {
  const rows = await db.attendeeActionLog.findMany({
    where: { event_id: eventId, action_type: "attendees_imported" },
    orderBy: { created_at: "desc" },
    take: limit,
    select: { id: true, created_at: true, metadata: true },
  });

  return rows.map((row) => {
    const meta =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    return {
      id: row.id,
      created_at: row.created_at.toISOString(),
      filename: typeof meta.filename === "string" ? meta.filename : null,
      created: importHistoryNumber(meta.created),
      updated: importHistoryNumber(meta.updated),
      skipped: importHistoryNumber(meta.skipped),
    };
  });
}

/** GET /api/admin/events/:eventId/import/history — recent commits from the audit log. The
 * `attendees_imported` bulk action rows written at commit time already carry everything the
 * history card shows (filename + created/updated/skipped counts), so this is a read of the
 * existing log, not a new table. */
export async function handleGetImportHistory(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const items = await loadRecentImportBatches(db, eventId, IMPORT_HISTORY_LIMIT);

  c.header("Cache-Control", "no-store");
  return c.json({ items });
}

function buildImportTemplateCsv(attributeFields: ImportAttributeField[]): string {
  const columns = [
    ...IMPORT_TEMPLATE_BASE_COLUMNS,
    ...attributeFields.map((field) => field.source_field),
  ];
  return `${columns.join(",")}\n`;
}

/** GET /api/admin/events/:eventId/import/template */
export async function handleGetImportTemplate(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;
  const attributeFields = await loadImportAttributeFields(db, eventId);
  const csv = buildImportTemplateCsv(attributeFields);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="admitto-import-template.csv"',
    },
  });
}
