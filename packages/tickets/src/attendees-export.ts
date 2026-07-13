import type { PrismaClient } from "@prisma/client";
import { resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import { customDataValue, parseCustomData } from "./custom-data.js";
import { loadEventCustomDataFields } from "./event-custom-fields.js";
import type { EventItemContent } from "./types.js";
import { sanitizeCsvCell } from "./csv-sanitize.js";
import {
  countFilteredAttendees,
  EXPORT_ROW_CAP,
  findFilteredAttendeesForExport,
  type AttendeeListFilterParams,
  type ExportAttendeeSqlRow,
} from "./attendees-list-filters.js";

/** Fixed column headers for XLSX/PDF/CSV export (includes check-off). Attribute columns appended at runtime. */
export const EXPORT_BASE_COLUMNS = [
  "✓",
  "Name",
  "Email",
  "Company",
  "Department",
  "Ticket type",
  "Check-in status",
  "Admitted at",
] as const;

export type SanitizedExportRow = {
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

export class AttendeeExportTooLargeError extends Error {
  constructor(
    public readonly count: number,
    public readonly cap: number = EXPORT_ROW_CAP,
  ) {
    super(`export_too_large: ${count} rows exceeds cap ${cap}`);
    this.name = "AttendeeExportTooLargeError";
  }
}

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

/** RFC 4180 CSV field quoting (escape embedded double quotes). */
function quoteCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
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


export function buildSanitizedExportRows(
  rows: ExportAttendeeSqlRow[],
  attributeFields: EventItemContent[],
  timeZone: string,
): SanitizedExportRow[] {
  return rows.map((row) => {
    const { company, department } = resolveCompanyDepartment(row);
    return {
      check_off: "",
      name: sanitizeCsvCell(row.name),
      email: sanitizeCsvCell(row.email),
      company: sanitizeCsvCell(company),
      department: sanitizeCsvCell(department),
      ticket_type: sanitizeCsvCell(row.ticket_type),
      check_in_status: row.admitted_at ? "admitted" : "not_admitted",
      admitted_at: row.admitted_at ? formatAdmittedAtLocal(row.admitted_at, timeZone) : "",
      attribute_values: attributeFields.map((field) =>
        sanitizeCsvCell(customDataValue(row.custom_data, field.source_field)),
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
    return sanitizeCsvCell(label);
  });
}

export function buildExportColumns(attributeFields: EventItemContent[]): string[] {
  return [...EXPORT_BASE_COLUMNS, ...buildExportColumnLabels(attributeFields)];
}

/** Build CSV text for sanitized export rows (CRLF, quoted fields). */
export function buildExportCsv(exportRows: SanitizedExportRow[], exportColumns: string[]): string {
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

export type ExportAttendeesCsvResult = {
  csv: string;
  rowCount: number;
  exportColumns: string[];
  exportRows: SanitizedExportRow[];
  timeZone: string;
};

/** Load filtered attendees and build sanitized CSV export (same logic as admin HTTP export). */
export async function exportAttendeesCsv(
  db: PrismaClient,
  eventId: string,
  filters: AttendeeListFilterParams,
): Promise<ExportAttendeesCsvResult> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { timezone: true },
  });
  if (!event) {
    throw new Error("event_not_found");
  }

  const timeZone = resolvePreviewEventTimeZone(event.timezone);
  const total = await countFilteredAttendees(db, eventId, filters);
  if (total > EXPORT_ROW_CAP) {
    throw new AttendeeExportTooLargeError(total);
  }

  const [rows, attributeFieldsResult] = await Promise.all([
    findFilteredAttendeesForExport(db, eventId, filters),
    loadEventCustomDataFields(db, eventId).catch((err) => err),
  ]);
  if (attributeFieldsResult instanceof Error) {
    throw attributeFieldsResult;
  }

  const exportColumns = buildExportColumns(attributeFieldsResult);
  const exportRows = buildSanitizedExportRows(rows, attributeFieldsResult, timeZone);
  const csv = buildExportCsv(exportRows, exportColumns);

  return {
    csv,
    rowCount: exportRows.length,
    exportColumns,
    exportRows,
    timeZone,
  };
}
