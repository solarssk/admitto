import { z } from "zod";
import { splitCsvLine } from "@admitto/shared";
import { RESERVED_CUSTOM_DATA_SOURCE_FIELDS } from "@admitto/tickets";
import {
  buildAttributeHeaderKeys,
  extractCustomDataFromRow,
} from "./custom-data-import.js";
import { resolveImportTicketType } from "./ticket-type-import.js";
import type {
  AttendeeRow,
  ImportTicketType,
  InvalidRow,
  ParseAttendeesOptions,
  ParseResult,
} from "./types.js";

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
  for (const [index, key] of headers.entries()) {
    Object.defineProperty(record, key, {
      value: (cells.at(index) ?? "").trim(),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return record;
}

/** Normalize the header line, warn on duplicate/unknown columns and a missing `email` column. */
function parseHeaderLine(
  headerLine: string,
  attributeHeaderKeys: Set<string>,
  warnings: string[],
): string[] {
  const rawHeaders = splitCsvLine(headerLine).map(normalizeHeader);

  const dupHeaders = [...new Set(rawHeaders.filter((h, i) => rawHeaders.indexOf(h) !== i))];
  if (dupHeaders.length > 0) {
    warnings.push(`Duplicate column(s) detected (last value used): ${dupHeaders.join(", ")}`);
  }

  for (const h of rawHeaders) {
    if ((CANONICAL_COLUMNS as readonly string[]).includes(h)) continue;
    if (attributeHeaderKeys.has(h)) continue;
    warnings.push(`Unknown column ignored: "${h}"`);
  }

  if (!rawHeaders.includes("email")) {
    warnings.push("CSV has no 'email' column. All rows will be invalid");
  }

  return rawHeaders;
}

type IdentityResolution =
  | { ok: true; firstName: string; lastName: string }
  | { ok: false; reason: string };

/** Validate first_name/last_name are both present and the email is well-formed. */
function resolveIdentity(rawFirstName: string, rawLastName: string, email: string): IdentityResolution {
  if (!rawFirstName || !rawLastName) {
    return { ok: false, reason: "Both first_name and last_name are required" };
  }

  if (!email) {
    return { ok: false, reason: "Missing email" };
  }
  if (!emailSchema.safeParse(email).success) {
    return { ok: false, reason: `Invalid email: "${email}"` };
  }

  return { ok: true, firstName: rawFirstName, lastName: rawLastName };
}

/** Cross-row duplicate/collision check for email, external_uuid and qr_payload. */
function findDuplicateIdentifierConflict(
  email: string,
  externalUUID: string | undefined,
  qrPayload: string | undefined,
  seenEmails: Set<string>,
  seenUUIDs: Set<string>,
  seenQrPayloads: Set<string>,
  seenAgencyIdentifiers: Set<string>,
): string | undefined {
  if (seenEmails.has(email)) {
    return `Duplicate email in file: "${email}"`;
  }
  if (externalUUID && seenUUIDs.has(externalUUID)) {
    return `Duplicate external_uuid in file: "${externalUUID}"`;
  }
  if (qrPayload && seenQrPayloads.has(qrPayload)) {
    return `Duplicate qr_payload in file: "${qrPayload}"`;
  }
  if (externalUUID && seenAgencyIdentifiers.has(externalUUID) && !seenUUIDs.has(externalUUID)) {
    return `Agency identifier collides across columns: "${externalUUID}"`;
  }
  if (qrPayload && seenAgencyIdentifiers.has(qrPayload) && !seenQrPayloads.has(qrPayload)) {
    return `Agency identifier collides across columns: "${qrPayload}"`;
  }
  return undefined;
}

/** Catalog membership (batch 04 / #351) — only enforced when the caller opted in by passing
 * ticketTypes; undefined means "not validating" (today's free-text behavior), preserved for
 * callers that don't yet pass a catalog. A matched value is normalized to the canonical key
 * so a human-typed "VIP"/"vip"/"Vip" all converge on the one entry everywhere downstream. */
function resolveRowTicketType(
  rawTicketType: string | undefined,
  ticketTypes: ImportTicketType[] | undefined,
): { value: string | undefined; reason?: string } {
  if (rawTicketType === undefined || ticketTypes === undefined) {
    return { value: rawTicketType };
  }
  const found = resolveImportTicketType(rawTicketType, ticketTypes);
  if (!found) {
    return { value: rawTicketType, reason: `Unknown ticket type: "${rawTicketType}"` };
  }
  return { value: found.key };
}

function markIdentifiersSeen(
  email: string,
  externalUUID: string | undefined,
  qrPayload: string | undefined,
  seenEmails: Set<string>,
  seenUUIDs: Set<string>,
  seenQrPayloads: Set<string>,
  seenAgencyIdentifiers: Set<string>,
): void {
  seenEmails.add(email);
  if (externalUUID) seenUUIDs.add(externalUUID);
  if (qrPayload) seenQrPayloads.add(qrPayload);
  if (externalUUID) seenAgencyIdentifiers.add(externalUUID);
  if (qrPayload) seenAgencyIdentifiers.add(qrPayload);
}

interface ValidatedRowInput {
  rowIdx: number;
  firstName: string;
  lastName: string;
  email: string;
  ticketType: string | undefined;
  externalUUID: string | undefined;
  qrPayload: string | undefined;
  company: string | undefined;
  department: string | undefined;
  customData: Record<string, string> | undefined;
}

function buildValidatedRow({
  rowIdx,
  firstName,
  lastName,
  email,
  ticketType,
  externalUUID,
  qrPayload,
  company,
  department,
  customData,
}: ValidatedRowInput): AttendeeRow {
  return {
    rowIndex: rowIdx,
    first_name: firstName,
    last_name: lastName,
    email,
    ...(ticketType !== undefined && { ticket_type: ticketType }),
    ...(externalUUID !== undefined && { external_uuid: externalUUID }),
    ...(qrPayload !== undefined && { qr_payload: qrPayload }),
    ...(company !== undefined && { company }),
    ...(department !== undefined && { department }),
    ...(customData !== undefined && { custom_data: customData }),
  };
}

export function parseAttendees(csvString: string, options: ParseAttendeesOptions = {}): ParseResult {
  const attributeFields = options.attributeFields ?? [];
  const ticketTypes = options.ticketTypes;
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

  const rawHeaders = parseHeaderLine(lines[0]!, attributeHeaderKeys, warnings);

  const seenEmails = new Set<string>();
  const seenUUIDs = new Set<string>();
  const seenQrPayloads = new Set<string>();
  const seenAgencyIdentifiers = new Set<string>();

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const line = lines.at(rowIdx)!;
    const cells = splitCsvLine(line);
    const raw = buildRow(rawHeaders, cells);

    const email = (raw["email"] ?? "").trim().toLowerCase();
    const externalUUID = (raw["external_uuid"] ?? "").trim() || undefined;
    const qrPayload = (raw["qr_payload"] ?? "").trim() || undefined;
    const rawTicketType = (raw["ticket_type"] ?? "").trim() || undefined;
    const company = (raw["company"] ?? "").trim() || undefined;
    const department = (raw["department"] ?? "").trim() || undefined;

    const rawFirstName = (raw["first_name"] ?? "").trim();
    const rawLastName = (raw["last_name"] ?? "").trim();

    const identity = resolveIdentity(rawFirstName, rawLastName, email);
    if (!identity.ok) {
      invalidRows.push({ rowIndex: rowIdx, raw, reason: identity.reason });
      continue;
    }
    const { firstName, lastName } = identity;

    const duplicateReason = findDuplicateIdentifierConflict(
      email,
      externalUUID,
      qrPayload,
      seenEmails,
      seenUUIDs,
      seenQrPayloads,
      seenAgencyIdentifiers,
    );
    if (duplicateReason) {
      invalidRows.push({ rowIndex: rowIdx, raw, reason: duplicateReason });
      continue;
    }

    const customResult = extractCustomDataFromRow(raw, attributeFields, duplicateLabels);
    if (!customResult.ok) {
      invalidRows.push({ rowIndex: rowIdx, raw, reason: customResult.reason });
      continue;
    }

    const ticketResult = resolveRowTicketType(rawTicketType, ticketTypes);
    if (ticketResult.reason) {
      invalidRows.push({ rowIndex: rowIdx, raw, reason: ticketResult.reason });
      continue;
    }

    markIdentifiersSeen(email, externalUUID, qrPayload, seenEmails, seenUUIDs, seenQrPayloads, seenAgencyIdentifiers);

    validRows.push(
      buildValidatedRow({
        rowIdx,
        firstName,
        lastName,
        email,
        ticketType: ticketResult.value,
        externalUUID,
        qrPayload,
        company,
        department,
        customData: customResult.custom_data,
      }),
    );
  }

  if (validRows.length === 0 && invalidRows.length === 0) {
    warnings.push("CSV has a header row but no data rows");
  }

  return { validRows, invalidRows, warnings };
}
