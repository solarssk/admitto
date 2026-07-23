import { randomUUID } from "node:crypto";
import type { Attendee, Prisma, PrismaClient } from "@prisma/client";
import {
  assertCustomDataMeetsRequirements,
  filterCustomDataAttributeFields,
  type EventItemContent,
} from "@admitto/tickets";
import type { AttendeeRow, ImportOptions, ImportSummary, ImportTicketType, SkippedRow } from "./types.js";
import { importCustomDataSkipReason } from "./custom-data-import.js";
import { resolveImportTicketType } from "./ticket-type-import.js";
import { generateToken } from "@admitto/crypto";

/** Fields updated on an existing attendee when overwrite=true. Never includes status, qr_payload, external_uuid, or token_hash. */
const OVERWRITE_FIELDS = ["name", "ticket_type", "company", "department"] as const;

/** Skip reason when insert hits a unique constraint at commit time (ADR 0028). */
export const IMPORT_CONFLICT_SKIP_REASON = "Duplicate email (conflict on insert)";

type AttendeeCreateData = {
  id: string;
  event_id: string;
  email: string;
  name: string;
  ticket_type?: string;
  external_uuid?: string;
  qr_payload?: string;
  public_ref?: string;
  company?: string;
  department?: string;
  custom_data?: Prisma.InputJsonValue;
  client_timezone?: string | null;
};

type AttendeeUpdateArgs = {
  id: string;
  data: {
    name: string;
    ticket_type?: string;
    company?: string;
    department?: string;
    custom_data?: Prisma.InputJsonValue;
  };
};

function cloneCustomData(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

function mergeCustomData(existing: unknown, incoming: Record<string, string>): Prisma.InputJsonValue {
  const merged = cloneCustomData(existing);
  for (const [key, value] of Object.entries(incoming)) {
    merged[key] = value;
  }
  return merged as Prisma.InputJsonValue;
}

function resolveAttributeFields(
  options: ImportOptions,
): EventItemContent[] {
  return filterCustomDataAttributeFields(options.attributeFields ?? []);
}

function validateImportCustomData(
  fields: EventItemContent[],
  customData: unknown,
): string | null {
  if (fields.length === 0) return null;
  try {
    assertCustomDataMeetsRequirements(fields, customData);
    return null;
  } catch (err) {
    return importCustomDataSkipReason(err, fields);
  }
}

/** Re-validates a row's ticket_type against the event's catalog at commit time — the catalog can
 * change between preview and commit (e.g. a type deleted after the CSV was previewed), so
 * parse-time normalization alone isn't a sufficient guarantee. Same opt-in semantics as
 * parseAttendees: `catalog` undefined skips validation entirely (today's free-text behavior). */
function validateImportTicketType(
  raw: string | undefined,
  catalog: ImportTicketType[] | undefined,
): { value: string | undefined; skipReason: string | null } {
  if (raw === undefined || catalog === undefined) return { value: raw, skipReason: null };
  const found = resolveImportTicketType(raw, catalog);
  if (!found) return { value: undefined, skipReason: `Unknown ticket type: "${raw}"` };
  return { value: found.key, skipReason: null };
}

type ImportDb = PrismaClient | Prisma.TransactionClient;

/**
 * Insert create rows via batched `createMany` (tx-safe `skipDuplicates`).
 * Happy path: one round-trip. On partial conflict, classify skips by pre-assigned row ids.
 */
export async function createAttendeesBatch(
  client: ImportDb,
  rows: AttendeeCreateData[],
): Promise<{ created: number; skipped: SkippedRow[] }> {
  if (rows.length === 0) return { created: 0, skipped: [] };

  const rowsWithIds = rows.map((row) => ({
    ...row,
    id: row.id ?? randomUUID(),
  }));

  const { count } = await client.attendee.createMany({
    data: rowsWithIds,
    skipDuplicates: true,
  });

  if (count === rowsWithIds.length) {
    return { created: count, skipped: [] };
  }

  const inserted = await client.attendee.findMany({
    where: { id: { in: rowsWithIds.map((row) => row.id) } },
    select: { id: true },
  });
  const insertedIds = new Set(inserted.map((row) => row.id));

  let created = 0;
  const skipped: SkippedRow[] = [];
  for (const row of rowsWithIds) {
    if (insertedIds.has(row.id)) {
      created++;
    } else {
      skipped.push({ email: row.email, reason: IMPORT_CONFLICT_SKIP_REASON });
    }
  }

  return { created, skipped };
}

/** Buckets of existing attendees pre-fetched for match lookup, keyed by each identifier column. */
type ExistingAttendeeMatches = {
  byUUID: Map<string, Attendee>;
  byQrPayload: Map<string, Attendee>;
  byEmail: Map<string, Attendee>;
};

/**
 * Pre-fetch all candidate existing attendees for the given rows, batched to stay under
 * Postgres's 65 535 bind-param limit. Worst case: each row contributes email + external_uuid +
 * qr_payload = 3 params. At PREFETCH_BATCH_SIZE=5 000 that is ≤15 000 params per query, well
 * under the cap.
 */
async function prefetchExistingAttendees(
  prisma: ImportDb,
  eventId: string,
  rows: AttendeeRow[],
): Promise<ExistingAttendeeMatches> {
  const PREFETCH_BATCH_SIZE = 5_000;

  const emails = rows.map((r) => r.email);
  const uuids = rows.flatMap((r) => (r.external_uuid ? [r.external_uuid] : []));
  const qrPayloads = rows.flatMap((r) => (r.qr_payload ? [r.qr_payload] : []));
  const agencyIdentifiers = [...new Set([...uuids, ...qrPayloads])];

  const existingList: Attendee[] = [];

  for (let i = 0; i < Math.max(emails.length, agencyIdentifiers.length, 1); i += PREFETCH_BATCH_SIZE) {
    const emailBatch = emails.slice(i, i + PREFETCH_BATCH_SIZE);
    const agencyBatch = agencyIdentifiers.slice(i, i + PREFETCH_BATCH_SIZE);
    const batch = await prisma.attendee.findMany({
      where: {
        event_id: eventId,
        OR: [
          { email: { in: emailBatch, mode: "insensitive" } },
          ...(agencyBatch.length > 0 ? [{ external_uuid: { in: agencyBatch } }] : []),
          ...(agencyBatch.length > 0 ? [{ qr_payload: { in: agencyBatch } }] : []),
        ],
      },
    });
    existingList.push(...batch);
  }

  const byUUID = new Map(existingList.filter((a) => a.external_uuid).map((a) => [a.external_uuid!, a]));
  const byQrPayload = new Map(existingList.filter((a) => a.qr_payload).map((a) => [a.qr_payload!, a]));
  const byEmail = new Map(existingList.map((a) => [a.email.toLowerCase(), a]));

  return { byUUID, byQrPayload, byEmail };
}

/**
 * Resolve a row to (at most) one existing attendee across email/UUID/QR columns.
 * Match strategy: agency identifiers first (Mode B), then email (Mode A). Fallback handles
 * existing Mode A attendees re-imported with newly assigned agency identifiers.
 */
function findAttendeeMatch(
  row: AttendeeRow,
  matches: ExistingAttendeeMatches,
): { found: Attendee | undefined; conflict: boolean } {
  const emailMatch = matches.byEmail.get(row.email.toLowerCase());
  const uuidMatch = row.external_uuid ? matches.byUUID.get(row.external_uuid) : undefined;
  const uuidCrossMatch = row.external_uuid ? matches.byQrPayload.get(row.external_uuid) : undefined;
  const qrMatch = row.qr_payload ? matches.byQrPayload.get(row.qr_payload) : undefined;
  const qrCrossMatch = row.qr_payload ? matches.byUUID.get(row.qr_payload) : undefined;

  const candidates = [
    uuidMatch,
    uuidCrossMatch,
    qrMatch,
    qrCrossMatch,
    emailMatch,
  ].filter((attendee): attendee is NonNullable<typeof attendee> => attendee !== undefined);

  const distinctCandidateIds = new Set(candidates.map((attendee) => attendee.id));
  const hasCrossColumnConflict =
    (uuidCrossMatch !== undefined &&
      uuidCrossMatch.id !== emailMatch?.id &&
      uuidCrossMatch.id !== uuidMatch?.id) ||
    (qrCrossMatch !== undefined &&
      qrCrossMatch.id !== emailMatch?.id &&
      qrCrossMatch.id !== qrMatch?.id);

  return {
    found: candidates[0],
    conflict: distinctCandidateIds.size > 1 || hasCrossColumnConflict,
  };
}

/** Outcome of classifying one import row — a skip reason, or a pending create/update payload. */
type RowClassification =
  | { type: "skip"; email: string; reason: string }
  | { type: "create"; data: AttendeeCreateData }
  | { type: "update"; id: string; data: AttendeeUpdateArgs["data"] };

/**
 * Classify a row that matched an existing attendee: skip (not overwriting, or validation
 * failure) or an update payload merged with any pending update already queued for the same
 * attendee (a prior row in this same import touching the same attendee by a different column).
 * overwrite=true only ever updates presentation/profile fields — never status, qr_payload,
 * external_uuid, or token_hash.
 */
function classifyExistingRow(
  row: AttendeeRow,
  name: string,
  found: Attendee,
  options: ImportOptions,
  attributeFields: EventItemContent[],
  updatesById: Map<string, AttendeeUpdateArgs>,
): RowClassification {
  if (!options.overwrite) {
    return {
      type: "skip",
      email: row.email,
      reason: 'Attendee already exists — turn on "Overwrite existing attendees" to update it instead of skipping',
    };
  }
  const pendingUpdate = updatesById.get(found.id);
  const priorCustomData = pendingUpdate?.data.custom_data ?? found.custom_data;
  const mergedCustomData =
    row.custom_data !== undefined ? mergeCustomData(priorCustomData, row.custom_data) : priorCustomData;
  const customDataError = validateImportCustomData(attributeFields, mergedCustomData);
  if (customDataError) {
    return { type: "skip", email: row.email, reason: customDataError };
  }
  const ticketTypeResult = validateImportTicketType(row.ticket_type, options.ticketTypes);
  if (ticketTypeResult.skipReason) {
    return { type: "skip", email: row.email, reason: ticketTypeResult.skipReason };
  }
  const customDataTouched = row.custom_data !== undefined || pendingUpdate?.data.custom_data !== undefined;
  return {
    type: "update",
    id: found.id,
    data: {
      ...(pendingUpdate?.data ?? {}),
      name,
      ...(ticketTypeResult.value !== undefined && { ticket_type: ticketTypeResult.value }),
      ...(row.company !== undefined && { company: row.company }),
      ...(row.department !== undefined && { department: row.department }),
      ...(customDataTouched && {
        custom_data: mergedCustomData as Prisma.InputJsonValue,
      }),
    },
  };
}

/** Classify a row with no existing-attendee match: skip (validation failure) or a create payload. */
function classifyNewRow(
  row: AttendeeRow,
  name: string,
  eventId: string,
  options: ImportOptions,
  attributeFields: EventItemContent[],
): RowClassification {
  const customDataError = validateImportCustomData(attributeFields, row.custom_data ?? {});
  if (customDataError) {
    return { type: "skip", email: row.email, reason: customDataError };
  }
  const ticketTypeResult = validateImportTicketType(row.ticket_type, options.ticketTypes);
  if (ticketTypeResult.skipReason) {
    return { type: "skip", email: row.email, reason: ticketTypeResult.skipReason };
  }
  const isAgency = row.external_uuid !== undefined || row.qr_payload !== undefined;
  return {
    type: "create",
    data: {
      id: randomUUID(),
      event_id: eventId,
      email: row.email,
      name,
      ...(ticketTypeResult.value !== undefined && { ticket_type: ticketTypeResult.value }),
      ...(row.external_uuid !== undefined && { external_uuid: row.external_uuid }),
      ...(row.qr_payload !== undefined && { qr_payload: row.qr_payload }),
      ...(isAgency && { public_ref: generateToken() }),
      ...(row.company !== undefined && { company: row.company }),
      ...(row.department !== undefined && { department: row.department }),
      ...(row.custom_data !== undefined && {
        custom_data: row.custom_data as Prisma.InputJsonValue,
      }),
      client_timezone: options.timezone ?? null,
    },
  };
}

/** Classify a single import row — pure in-memory, no DB calls (matches were pre-fetched). */
function classifyRow(
  row: AttendeeRow,
  eventId: string,
  attributeFields: EventItemContent[],
  options: ImportOptions,
  matches: ExistingAttendeeMatches,
  updatesById: Map<string, AttendeeUpdateArgs>,
): RowClassification {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
  const { found, conflict } = findAttendeeMatch(row, matches);

  if (conflict) {
    return { type: "skip", email: row.email, reason: "Conflicting identifiers match different attendees" };
  }
  if (found) {
    return classifyExistingRow(row, name, found, options, attributeFields, updatesById);
  }
  return classifyNewRow(row, name, eventId, options, attributeFields);
}

/**
 * Postgres bind-parameter limit is 65 535.  AttendeeCreateData has up to
 * 9 columns, so one createMany with 50 k rows would exceed it.  Batch at
 * 1 000 rows per statement (≤ 9 000 params) to stay safely under the cap.
 */
const CREATE_BATCH_SIZE = 1_000;
/** Parallel update batch — keeps large overwrite imports within the 30s tx timeout. */
const UPDATE_BATCH_SIZE = 250;

/** Apply create/update operations on the provided Prisma client (no nested transaction). */
async function writeAttendeeBatches(
  client: ImportDb,
  creates: AttendeeCreateData[],
  updates: AttendeeUpdateArgs[],
  skipped: SkippedRow[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (let i = 0; i < creates.length; i += CREATE_BATCH_SIZE) {
    const batch = creates.slice(i, i + CREATE_BATCH_SIZE);
    const result = await createAttendeesBatch(client, batch);
    created += result.created;
    skipped.push(...result.skipped);
  }

  for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
    const batch = updates.slice(i, i + UPDATE_BATCH_SIZE);
    await Promise.all(batch.map(({ id, data }) => client.attendee.update({ where: { id }, data })));
    updated += batch.length;
  }

  return { created, updated };
}

/**
 * Commit validated attendee rows to the database.
 *
 * @param eventId   - Target event ID (must exist in DB).
 * @param rows      - Validated rows from parseAttendees().
 * @param options   - overwrite, dryRun, and ownedTransaction flags (dryRun/overwrite default false).
 * @param db        - Injectable Prisma client (defaults to shared singleton from @admitto/db).
 */
export async function commitImport(
  eventId: string,
  rows: AttendeeRow[],
  options: ImportOptions = {},
  db?: ImportDb,
): Promise<ImportSummary> {
  const { dryRun = false, ownedTransaction = false } = options;
  const attributeFields = resolveAttributeFields(options);

  // Lazy-load to keep the package usable without @admitto/db when dry-running with mocks.
  const prisma = db ?? (await import("@admitto/db")).prisma;

  // Fail fast with a readable error rather than a FK constraint from a later create.
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new Error(`Event not found: "${eventId}"`);

  const matches = await prefetchExistingAttendees(prisma, eventId, rows);

  // Classify rows — pure in-memory, no DB calls inside loop.
  const creates: AttendeeCreateData[] = [];
  const updatesById = new Map<string, AttendeeUpdateArgs>();
  const skipped: SkippedRow[] = [];

  for (const row of rows) {
    const result = classifyRow(row, eventId, attributeFields, options, matches, updatesById);
    if (result.type === "skip") {
      skipped.push({ email: result.email, reason: result.reason });
    } else if (result.type === "create") {
      creates.push(result.data);
    } else {
      updatesById.set(result.id, { id: result.id, data: result.data });
    }
  }

  const updates = [...updatesById.values()];

  const summary: ImportSummary = {
    toCreate: creates.length,
    toUpdate: updates.length,
    toSkip: skipped.length,
    created: 0,
    updated: 0,
    skipped,
  };

  if (!dryRun && (creates.length > 0 || updates.length > 0)) {
    let writeCounts: { created: number; updated: number };
    if (ownedTransaction) {
      writeCounts = await writeAttendeeBatches(prisma, creates, updates, skipped);
    } else {
      writeCounts = await (prisma as PrismaClient).$transaction(async (tx) =>
        writeAttendeeBatches(tx, creates, updates, skipped),
      );
    }
    summary.created = writeCounts.created;
    summary.updated = writeCounts.updated;
    summary.toSkip = skipped.length;
  }

  return summary;
}

// Suppress unused import warning for OVERWRITE_FIELDS — it documents intent even if not iterated.
(OVERWRITE_FIELDS satisfies readonly string[]);
