/**
 * Shared import commit transaction (HTTP enqueue path validates capacity first;
 * worker re-runs this after loading the staged CSV).
 */
import type { Prisma, PrismaClient } from "@admitto/db";
import { CAPACITY_EXCLUDED_STATUSES } from "@admitto/db";
import {
  acquireEventTicketTypesLock,
  loadEventCustomDataFields,
  filterCustomDataAttributeFields,
  writeBulkActionLog,
} from "@admitto/tickets";
import { commitImport } from "./importer.js";
import { loadImportTicketTypes } from "./ticket-type-import.js";
import { parseAttendees } from "./parser.js";
import type { AttendeeRow, ImportAttributeField, ImportSummary, SkippedRow } from "./types.js";

const IMPORT_TX_TIMEOUT_MS = 120_000;
const IMPORT_TX_MAX_WAIT_MS = 30_000;
const ROW_DETAIL_LIMIT = 20;

export type ExecuteImportCommitParams = {
  eventId: string;
  csv: string;
  overwrite: boolean;
  /** When true, capacity overflow is allowed (HTTP already verified superadmin + ?force=1). */
  forceCapacity: boolean;
  actorUserId: string | null;
  sessionId: string | null;
  timezone: string | null;
  filename: string | null;
  importId: string;
};

export type ExecuteImportCommitResult = {
  importId: string;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  created: number;
  updated: number;
  skipped: SkippedRow[];
  invalidRows: Array<{ rowIndex: number; reason: string }>;
  invalidCount: number;
};

export class ImportCapacityExceededError extends Error {
  readonly code = "event_full" as const;
  readonly capacity: number;
  readonly current: number;
  readonly incoming: number;
  readonly projected: number;

  constructor(opts: {
    capacity: number;
    current: number;
    incoming: number;
    projected: number;
  }) {
    super(
      `Import would exceed capacity. ${opts.current} existing + ${opts.incoming} new = ${opts.projected} > ${opts.capacity}.`,
    );
    this.name = "ImportCapacityExceededError";
    this.capacity = opts.capacity;
    this.current = opts.current;
    this.incoming = opts.incoming;
    this.projected = opts.projected;
  }
}

async function loadImportAttributeFields(
  db: PrismaClient | Prisma.TransactionClient,
  eventId: string,
): Promise<ImportAttributeField[]> {
  const fields = await loadEventCustomDataFields(db, eventId);
  return filterCustomDataAttributeFields(fields);
}

function capRows<T>(rows: T[]): T[] {
  return rows.slice(0, ROW_DETAIL_LIMIT);
}

/**
 * Parse + commit attendees from a CSV string under the same locks as the former HTTP sync path.
 */
export async function executeImportCommit(
  db: PrismaClient,
  params: ExecuteImportCommitParams,
): Promise<ExecuteImportCommitResult> {
  const attributeFields = await loadImportAttributeFields(db, params.eventId);
  const ticketTypes = await loadImportTicketTypes(db, params.eventId);
  const parsed = parseAttendees(params.csv, { attributeFields, ticketTypes });

  let lockInvalidatedRows: { rowIndex: number; reason: string }[] = [];
  let capacityForcedMeta: { capacity: number; current: number } | null = null;

  const summary = await db.$transaction(
    async (tx) => {
      if (ticketTypes) {
        await acquireEventTicketTypesLock(tx, params.eventId);
      }

      let rowsToCommit = parsed.validRows;
      if (ticketTypes) {
        const freshKeys = new Set((await loadImportTicketTypes(tx, params.eventId)).map((t) => t.key));
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
        params.eventId,
        rowsToCommit,
        {
          dryRun: true,
          overwrite: params.overwrite,
          ownedTransaction: true,
          attributeFields,
          ticketTypes,
        },
        tx,
      );

      capacityForcedMeta = await assertCapacityInTx(tx, params, dry.toCreate);

      const result = await commitImport(
        params.eventId,
        rowsToCommit,
        {
          dryRun: false,
          overwrite: params.overwrite,
          ownedTransaction: true,
          attributeFields,
          ticketTypes,
          timezone: params.timezone ?? undefined,
        },
        tx,
      );

      await writeBulkActionLog(tx, {
        event_id: params.eventId,
        action_type: "attendees_imported",
        audit: {
          operator: params.actorUserId ?? undefined,
          sessionId: params.sessionId ?? undefined,
          timezone: params.timezone ?? undefined,
        },
        metadata: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped.length,
          filename: params.filename,
          importId: params.importId,
          ...(capacityForcedMeta
            ? {
                forced: true,
                capacity: capacityForcedMeta.capacity,
                current: capacityForcedMeta.current,
              }
            : {}),
        },
      });

      return result;
    },
    { timeout: IMPORT_TX_TIMEOUT_MS, maxWait: IMPORT_TX_MAX_WAIT_MS },
  );

  const allInvalid = [...parsed.invalidRows, ...lockInvalidatedRows];
  return {
    importId: params.importId,
    toCreate: summary.toCreate,
    toUpdate: summary.toUpdate,
    toSkip: summary.toSkip,
    created: summary.created,
    updated: summary.updated,
    skipped: capRows(summary.skipped),
    invalidRows: capRows(allInvalid),
    invalidCount: allInvalid.length,
  };
}

async function assertCapacityInTx(
  tx: Prisma.TransactionClient,
  params: ExecuteImportCommitParams,
  incomingCount: number,
): Promise<{ capacity: number; current: number } | null> {
  if (incomingCount <= 0) return null;

  const event = await tx.event.findUnique({
    where: { id: params.eventId },
    select: { capacity: true },
  });
  if (event?.capacity == null) return null;

  const current = await tx.attendee.count({
    where: {
      event_id: params.eventId,
      status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] },
    },
  });
  const projected = current + incomingCount;
  if (projected <= event.capacity) return null;

  if (params.forceCapacity) {
    return { capacity: event.capacity, current };
  }

  throw new ImportCapacityExceededError({
    capacity: event.capacity,
    current,
    incoming: incomingCount,
    projected,
  });
}

/** Dry-run counts for enqueue-time capacity checks (no writes). */
export async function dryRunImportCounts(
  db: PrismaClient,
  eventId: string,
  csv: string,
  overwrite: boolean,
): Promise<ImportSummary> {
  const attributeFields = await loadImportAttributeFields(db, eventId);
  const ticketTypes = await loadImportTicketTypes(db, eventId);
  const parsed = parseAttendees(csv, { attributeFields, ticketTypes });
  return commitImport(
    eventId,
    parsed.validRows,
    { dryRun: true, overwrite, attributeFields, ticketTypes },
    db,
  );
}
