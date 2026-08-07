import type { PrismaClient } from "@admitto/db";
import { resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import {
  buildExportColumns,
  buildExportCsv,
  buildSanitizedExportRows,
} from "./attendees-export.js";
import { buildExportPdfBuffer } from "./attendees-export-pdf.js";
import { buildExportXlsxBuffer } from "./attendees-export-xlsx.js";
import type { ExportAttendeeSqlRow } from "./attendees-list-filters.js";
import { loadEventCustomDataFields } from "./event-custom-fields.js";
import { loadEventTicketTypes } from "./ticket-types.js";

export type AttendeesExportFormat = "csv" | "xlsx" | "pdf";

export type AttendeesExportArtifact = {
  bytes: Buffer;
  filename: string;
  contentType: string;
  rowCount: number;
};

/**
 * Build a filtered/selected attendees export file (CSV, XLSX, or PDF).
 * Shared by the sync selected-export HTTP path and the async worker drain.
 */
export async function buildAttendeesExportArtifact(
  db: PrismaClient,
  eventId: string,
  rows: ExportAttendeeSqlRow[],
  format: AttendeesExportFormat,
  event: { title: string; date: Date; timezone: string },
): Promise<AttendeesExportArtifact> {
  const timeZone = resolvePreviewEventTimeZone(event.timezone);
  const [attributeFields, ticketTypes] = await Promise.all([
    loadEventCustomDataFields(db, eventId),
    loadEventTicketTypes(db, eventId),
  ]);
  const exportColumns = buildExportColumns(attributeFields);
  const exportRows = buildSanitizedExportRows(rows, attributeFields, timeZone, ticketTypes);
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `attendees-${eventId}-${timestamp}.${format}`;

  if (format === "csv") {
    return {
      bytes: Buffer.from(buildExportCsv(exportRows, exportColumns), "utf8"),
      filename,
      contentType: "text/csv; charset=utf-8",
      rowCount: exportRows.length,
    };
  }

  if (format === "pdf") {
    const bytes = await buildExportPdfBuffer(exportRows, exportColumns, {
      title: event.title,
      date: event.date,
    });
    return {
      bytes: Buffer.from(bytes),
      filename,
      contentType: "application/pdf",
      rowCount: exportRows.length,
    };
  }

  const bytes = await buildExportXlsxBuffer(exportRows, exportColumns);
  return {
    bytes: Buffer.from(bytes),
    filename,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    rowCount: exportRows.length,
  };
}
