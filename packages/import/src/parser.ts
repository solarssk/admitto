import { z } from "zod";
import { splitCsvLine } from "@admitto/shared";
import { RESERVED_CUSTOM_DATA_SOURCE_FIELDS } from "@admitto/tickets";
import {
  buildAttributeHeaderKeys,
  extractCustomDataFromRow,
} from "./custom-data-import.js";
import type { AttendeeRow, InvalidRow, ParseAttendeesOptions, ParseResult } from "./types.js";

const CANONICAL_COLUMNS = RESERVED_CUSTOM_DATA_SOURCE_FIELDS;

const emailSchema = z.string().email();

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

function buildRow(
  headers: string[],
  cells: string[],
): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i];
    if (key !== undefined && !(key in record)) record[key] = (cells[i] ?? "").trim();
  }
  return record;
}

export function parseAttendees(csvString: string, options: ParseAttendeesOptions = {}): ParseResult {
  const attributeFields = options.attributeFields ?? [];
  const { allowedHeaders: attributeHeaderKeys, duplicateLabels } =
    buildAttributeHeaderKeys(attributeFields);

  const validRows: AttendeeRow[] = [];
  const invalidRows: InvalidRow[] = [];
  const warnings: string[] = [];

  const lines = csvString.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    warnings.push("CSV is empty");
    return { validRows, invalidRows, warnings };
  }

  const headerLine = lines[0]!;
  const rawHeaders = splitCsvLine(headerLine).map(normalizeHeader);

  const dupHeaders = [...new Set(rawHeaders.filter((h, i) => rawHeaders.indexOf(h) !== i))];
  if (dupHeaders.length > 0) {
    warnings.push(`Duplicate column(s) detected (first value used): ${dupHeaders.join(", ")}`);
  }

  for (const h of rawHeaders) {
    if ((CANONICAL_COLUMNS as readonly string[]).includes(h)) continue;
    if (attributeHeaderKeys.has(h)) continue;
    warnings.push(`Unknown column ignored: "${h}"`);
  }

  if (!rawHeaders.includes("email")) {
    warnings.push("CSV has no 'email' column — all rows will be invalid");
  }

  const seenEmails = new Set<string>();
  const seenUUIDs = new Set<string>();
  const seenQrPayloads = new Set<string>();
  const seenAgencyIdentifiers = new Set<string>();

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const line = lines[rowIdx]!;
    const cells = splitCsvLine(line);
    const raw = buildRow(rawHeaders, cells);

    const email = (raw["email"] ?? "").trim().toLowerCase();
    const externalUUID = (raw["external_uuid"] ?? "").trim() || undefined;
    const qrPayload = (raw["qr_payload"] ?? "").trim() || undefined;
    const ticketType = (raw["ticket_type"] ?? "").trim() || undefined;
    const company = (raw["company"] ?? "").trim() || undefined;
    const department = (raw["department"] ?? "").trim() || undefined;

    const rawFirstName = (raw["first_name"] ?? "").trim();
    const rawLastName = (raw["last_name"] ?? "").trim();
    const rawName = (raw["name"] ?? "").trim();

    let firstName: string;
    let lastName: string;

    if (rawFirstName || rawLastName) {
      firstName = rawFirstName;
      lastName = rawLastName;
      if (!firstName || !lastName) {
        invalidRows.push({ rowIndex: rowIdx, raw, reason: "Both first_name and last_name are required when using separate name columns" });
        continue;
      }
    } else if (rawName) {
      const spaceIdx = rawName.indexOf(" ");
      if (spaceIdx === -1) {
        warnings.push(`Row ${rowIdx}: single-word name "${rawName}" — last_name stored as empty string`);
        firstName = rawName;
        lastName = "";
      } else {
        firstName = rawName.slice(0, spaceIdx);
        lastName = rawName.slice(spaceIdx + 1).trim();
      }
    } else {
      invalidRows.push({ rowIndex: rowIdx, raw, reason: "Missing name: provide first_name + last_name or a name column" });
      continue;
    }

    if (!email) {
      invalidRows.push({ rowIndex: rowIdx, raw, reason: "Missing email" });
      continue;
    }
    if (!emailSchema.safeParse(email).success) {
      invalidRows.push({ rowIndex: rowIdx, raw, reason: `Invalid email: "${email}"` });
      continue;
    }

    if (seenEmails.has(email)) {
      invalidRows.push({ rowIndex: rowIdx, raw, reason: `Duplicate email in file: "${email}"` });
      continue;
    }
    if (externalUUID && seenUUIDs.has(externalUUID)) {
      invalidRows.push({ rowIndex: rowIdx, raw, reason: `Duplicate external_uuid in file: "${externalUUID}"` });
      continue;
    }
    if (qrPayload && seenQrPayloads.has(qrPayload)) {
      invalidRows.push({ rowIndex: rowIdx, raw, reason: `Duplicate qr_payload in file: "${qrPayload}"` });
      continue;
    }
    if (externalUUID && seenAgencyIdentifiers.has(externalUUID) && !seenUUIDs.has(externalUUID)) {
      invalidRows.push({
        rowIndex: rowIdx,
        raw,
        reason: `Agency identifier collides across columns: "${externalUUID}"`,
      });
      continue;
    }
    if (qrPayload && seenAgencyIdentifiers.has(qrPayload) && !seenQrPayloads.has(qrPayload)) {
      invalidRows.push({
        rowIndex: rowIdx,
        raw,
        reason: `Agency identifier collides across columns: "${qrPayload}"`,
      });
      continue;
    }

    const customResult = extractCustomDataFromRow(raw, attributeFields, duplicateLabels);
    if (!customResult.ok) {
      invalidRows.push({ rowIndex: rowIdx, raw, reason: customResult.reason });
      continue;
    }

    seenEmails.add(email);
    if (externalUUID) seenUUIDs.add(externalUUID);
    if (qrPayload) seenQrPayloads.add(qrPayload);
    if (externalUUID) seenAgencyIdentifiers.add(externalUUID);
    if (qrPayload) seenAgencyIdentifiers.add(qrPayload);

    validRows.push({
      rowIndex: rowIdx,
      first_name: firstName,
      last_name: lastName,
      email,
      ...(ticketType !== undefined && { ticket_type: ticketType }),
      ...(externalUUID !== undefined && { external_uuid: externalUUID }),
      ...(qrPayload !== undefined && { qr_payload: qrPayload }),
      ...(company !== undefined && { company }),
      ...(department !== undefined && { department }),
      ...(customResult.custom_data !== undefined && { custom_data: customResult.custom_data }),
    });
  }

  if (validRows.length === 0 && invalidRows.length === 0) {
    warnings.push("CSV has a header row but no data rows");
  }

  return { validRows, invalidRows, warnings };
}
