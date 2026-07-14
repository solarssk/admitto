import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  parseAttendees,
  commitImport,
  type AttendeeRow,
  type ImportAttributeField,
  type ImportTicketType,
} from "@admitto/import";
import {
  loadEventCustomDataFields,
  filterCustomDataAttributeFields,
  loadEventTicketTypes,
  writeBulkActionLog,
} from "@admitto/tickets";
import { xlsxBufferToCsv, ImportRowLimitError, ImportZipBombError, MAX_CSV_CHARS, MAX_IMPORT_ROWS } from "./xlsx-to-csv.js";
import { logger } from "../logger.js";
import {
  adminAuditFromContext,
  assertEventManageAccess,
  requireEventId,
} from "./admin-helpers.js";
import { assertEventCapacityForIncoming, acquireEventCapacityLock } from "./event-capacity.js";
import { acquireEventTicketTypesLock } from "./ticket-types-routes.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Multipart framing overhead allowed on top of the file cap (body-limit middleware). */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
/** Maximum request body size for import routes (file cap plus multipart overhead). */
export const MAX_IMPORT_BODY_BYTES = MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES;

/** Import commit: lock wait + row writes share this budget (queued concurrent commits). */
const IMPORT_TX_TIMEOUT_MS = 120_000;
const IMPORT_TX_MAX_WAIT_MS = 30_000;

export type ImportInvalidRowDto = {
  rowIndex: number;
  reason: string;
};

/** Max valid rows returned in preview sample (data sanity check before commit). */
const SAMPLE_LIMIT = 20;

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
    invalidRows: ImportInvalidRowDto[];
    warnings: string[];
  };
  summary: {
    toCreate: number;
    toUpdate: number;
    toSkip: number;
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
  skipped: Array<{ email: string; reason: string }>;
  /**
   * Rows that failed the commit-time re-parse (e.g. a ticket type deleted from the catalog
   * between preview and commit) and were therefore never passed into commitImport at all - they
   * are not reflected in toCreate/toUpdate/toSkip/created/updated/skipped above. Same shape as
   * ImportPreviewDto's parse.invalidRows so the admin SPA can reuse its rendering.
   */
  invalidRows: ImportInvalidRowDto[];
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
  if (/^Unknown column ignored: "/.test(warning)) {
    return "Unknown column ignored";
  }
  // "Duplicate column(s) detected (first value used): col1, col2" → strip column list
  if (/^Duplicate column\(s\) detected/.test(warning)) {
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
  return invalidRows.map(({ rowIndex, reason }) => ({
    rowIndex,
    reason: reason.startsWith("Unknown ticket type:") ? reason : sanitizePreviewReason(reason),
  }));
}

/** Group invalid rows by sanitized reason type — counts only, no cell values. */
function groupInvalidByType(invalidRows: { reason: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of invalidRows) {
    const key = sanitizePreviewReason(row.reason)
      .toLowerCase()
      .replace(/[^a-z_ ]/g, "")
      .trim()
      .replace(/ /g, "_")
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
        warnings: parsed.warnings.map(sanitizePreviewWarning),
      },
      summary: {
        toCreate: summary.toCreate,
        toUpdate: summary.toUpdate,
        toSkip: summary.toSkip,
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

/** POST /api/admin/events/:eventId/import/commit */
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

    const attributeFields = await loadImportAttributeFields(db, eventId);
    const ticketTypes = await loadImportTicketTypes(db, eventId);
    const parsed = parseAttendees(upload.csv, { attributeFields, ticketTypes });

    // Rows the transaction's lock-time catalog recheck below drops (a type deleted in the
    // narrow window between the pre-transaction snapshot above and the lock actually being
    // held) - merged into the same invalidRows reporting as the commit-time parse's own
    // invalid rows once the transaction returns.
    let lockInvalidatedRows: { rowIndex: number; reason: string }[] = [];

    const summary = await db.$transaction(
      async (tx) => {
        // Locked against a concurrent ticket-type DELETE for the whole commit (TOCTOU fix, code
        // review): the `ticketTypes` catalog snapshot loaded above, before this transaction
        // opened, stays valid once this lock is held, since a delete's own in-use recheck can no
        // longer slip in and remove a type this batch is about to write - closing the same gap
        // as attendees-api-routes.ts's create/patch handlers, which take this lock for the same
        // reason. Acquired before the capacity lock so every writer that needs both locks takes
        // them in the same order. Only taken when the import actually validates against a
        // catalog (ticketTypes is always defined here, but guarded the same way the option
        // itself is documented, in case a future caller opts out).
        if (ticketTypes) {
          await acquireEventTicketTypesLock(tx, eventId);
        }

        // The pre-transaction snapshot above can still be stale for the handful of rows whose
        // type was deleted in the window between that read and this lock actually being held -
        // reread the catalog now, under the lock, and drop any row whose (already-canonicalized)
        // key no longer exists instead of writing an attendee that references a gone type (Codex
        // review). Rows dry-run/committed below use this rechecked set, not parsed.validRows.
        let rowsToCommit = parsed.validRows;
        if (ticketTypes) {
          const freshKeys = new Set((await loadImportTicketTypes(tx, eventId)).map((t) => t.key));
          const stillValid: AttendeeRow[] = [];
          for (const row of parsed.validRows) {
            if (row.ticket_type !== undefined && !freshKeys.has(row.ticket_type)) {
              lockInvalidatedRows.push({
                rowIndex: row.rowIndex,
                reason: `Unknown ticket type: "${row.ticket_type}"`,
              });
            } else {
              stillValid.push(row);
            }
          }
          rowsToCommit = stillValid;
        }

        const dry = await commitImport(
          eventId,
          rowsToCommit,
          {
            dryRun: true,
            overwrite: upload.overwrite,
            ownedTransaction: true,
            attributeFields,
            ticketTypes,
          },
          tx,
        );

        const capacityResult = await assertEventCapacityForIncoming(
          c,
          tx,
          eventId,
          dry.toCreate,
        );
        if (capacityResult instanceof Response) {
          throw capacityResult;
        }
        const capacityForced =
          capacityResult && "forced" in capacityResult ? capacityResult : undefined;

        const result = await commitImport(
          eventId,
          rowsToCommit,
          {
            dryRun: false,
            overwrite: upload.overwrite,
            ownedTransaction: true,
            attributeFields,
            ticketTypes,
          },
          tx,
        );

        await writeBulkActionLog(tx, {
          event_id: eventId,
          action_type: "attendees_imported",
          audit: adminAuditFromContext(c),
          metadata: {
            created: result.created,
            updated: result.updated,
            skipped: result.skipped.length,
            filename: upload.filename,
            ...(capacityForced
              ? {
                  forced: true,
                  capacity: capacityForced.capacity,
                  current: capacityForced.current,
                }
              : {}),
          },
        });

        return result;
      },
      { timeout: IMPORT_TX_TIMEOUT_MS, maxWait: IMPORT_TX_MAX_WAIT_MS },
    );

    const allInvalidRows = [...parsed.invalidRows, ...lockInvalidatedRows];

    logger.info("Import commit complete", {
      importId,
      eventId,
      step: "commit",
      filename: upload.filename,
      fileSizeBytes: upload.sizeBytes,
      fileType: upload.ext,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped.length,
      // Rows the commit-time re-parse, or the lock-time catalog recheck, dropped before they
      // ever reached commitImport (e.g. a ticket type deleted from the catalog between preview
      // and commit) - same aggregation shape as the preview endpoint's logging above, for
      // observability.
      invalidCount: allInvalidRows.length,
      invalidRows: allInvalidRows.map((r) => r.rowIndex),
      invalidByType: groupInvalidByType(allInvalidRows),
      overwrite: upload.overwrite,
      durationMs: Date.now() - startTime,
    });

    const body: ImportCommitDto = {
      importId,
      toCreate: summary.toCreate,
      toUpdate: summary.toUpdate,
      toSkip: summary.toSkip,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      invalidRows: invalidRowsForResponse(allInvalidRows),
    };

    return c.json(body);
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error("Import commit failed", {
      importId,
      eventId,
      step: "commit",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    });
    return c.json({ error: "server error", importId }, 500);
  }
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

async function loadImportTicketTypes(
  db: PrismaClient | Prisma.TransactionClient,
  eventId: string,
): Promise<ImportTicketType[]> {
  const types = await loadEventTicketTypes(db, eventId);
  return types.map((t) => ({ key: t.key, label: t.label }));
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
