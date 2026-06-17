import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageEvent } from "@admitto/auth";
import { parseAttendees, commitImport } from "@admitto/import";
import { writeActionLog } from "@admitto/tickets";
import * as XLSX from "xlsx";
import { resolveClientIp } from "../rate-limit/client-ip.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type ImportInvalidRowDto = {
  rowIndex: number;
  reason: string;
};

export type ImportPreviewDto = {
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
};

export type ImportCommitDto = {
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  created: number;
  updated: number;
  skipped: Array<{ email: string; reason: string }>;
};

type ParsedUpload = {
  csv: string;
  filename: string;
  overwrite: boolean;
};

/** Return 403 when the session user cannot manage the event; otherwise null. */
async function assertEventManageAccess(
  c: Context,
  db: PrismaClient,
  eventId: string,
): Promise<Response | null> {
  const auth = c.get("auth");
  if (!(await canManageEvent(db, auth.userId, eventId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

function adminAuditFromContext(c: Context) {
  const auth = c.get("auth");
  return {
    operator: auth.userId,
    sessionId: auth.sessionId,
    ip: resolveClientIp(c),
  };
}

function requireEventId(c: Context): string | Response {
  const eventId = c.req.param("eventId");
  if (!eventId) return c.json({ error: "eventId required" }, 400);
  return eventId;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot).toLowerCase();
}

function bufferToCsvString(buf: ArrayBuffer, ext: string): string {
  if (ext === ".csv") {
    return new TextDecoder("utf-8").decode(buf);
  }
  const workbook = XLSX.read(buf, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return "";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return "";
  return XLSX.utils.sheet_to_csv(sheet);
}

async function parseImportUpload(c: Context): Promise<ParsedUpload | Response> {
  let body: Record<string, string | File>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid form data" }, 400);
  }

  const fileField = body.file;
  if (!(fileField instanceof File)) {
    return c.json({ error: "file required" }, 400);
  }

  if (fileField.size > MAX_FILE_BYTES) {
    return c.json({ error: "file too large" }, 400);
  }

  const ext = fileExtension(fileField.name);
  if (ext !== ".csv" && ext !== ".xlsx") {
    return c.json({ error: "unsupported file type" }, 400);
  }

  const overwriteRaw = body.overwrite;
  const overwrite = overwriteRaw === "true" || overwriteRaw === "on";

  const buf = await fileField.arrayBuffer();
  const csv = bufferToCsvString(buf, ext);

  return { csv, filename: fileField.name, overwrite };
}

/** POST /api/admin/events/:eventId/import/preview */
export async function handleImportPreview(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const upload = await parseImportUpload(c);
  if (upload instanceof Response) return upload;

  const parsed = parseAttendees(upload.csv);
  const summary = await commitImport(
    eventId,
    parsed.validRows,
    { dryRun: true, overwrite: upload.overwrite },
    db,
  );

  const body: ImportPreviewDto = {
    parse: {
      validCount: parsed.validRows.length,
      invalidRows: parsed.invalidRows.map(({ rowIndex, reason }) => ({ rowIndex, reason })),
      warnings: parsed.warnings,
    },
    summary: {
      toCreate: summary.toCreate,
      toUpdate: summary.toUpdate,
      toSkip: summary.toSkip,
    },
  };

  return c.json(body);
}

/** POST /api/admin/events/:eventId/import/commit */
export async function handleImportCommit(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const upload = await parseImportUpload(c);
  if (upload instanceof Response) return upload;

  const parsed = parseAttendees(upload.csv);

  try {
    const summary = await db.$transaction(async (tx) => {
      const result = await commitImport(
        eventId,
        parsed.validRows,
        { dryRun: false, overwrite: upload.overwrite, ownedTransaction: true },
        tx,
      );

      await writeActionLog(tx, {
        event_id: eventId,
        action_type: "attendees_imported",
        audit: adminAuditFromContext(c),
        metadata: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped.length,
          filename: upload.filename,
        },
      });

      return result;
    });

    const body: ImportCommitDto = {
      toCreate: summary.toCreate,
      toUpdate: summary.toUpdate,
      toSkip: summary.toSkip,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
    };

    return c.json(body);
  } catch (err) {
    console.error("handleImportCommit failed:", err);
    return c.json({ error: "server error" }, 500);
  }
}
