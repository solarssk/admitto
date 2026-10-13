/**
 * Shared import commit transaction (HTTP enqueue path validates capacity first;
 * worker re-runs this after loading the staged CSV).
 */
import type { Prisma, PrismaClient } from "@admitto/db";
import { assertImportCapacityInTx } from "./event-capacity.js";
import {
  acquireEventTicketTypesLock,
  acquireEventCapacityLock,
  EVENT_CAPACITY_TRANSACTION_OPTIONS,
  loadEventCustomDataFields,
  filterCustomDataAttributeFields,
  writeBulkActionLog,
} from "@admitto/tickets";
import { commitImport } from "./importer.js";
import { loadImportTicketTypes } from "./ticket-type-import.js";
import { parseAttendees } from "./parser.js";
import type { AttendeeRow, ImportAttributeField, ImportSummary, SkippedRow } from "./types.js";

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
  /**
   * When set, mark this AdminJob `succeeded` inside the same DB transaction as the import
   * commit so a crash after commit cannot leave the job `running` for the stale reaper.
   */
  adminJobId?: string | null;
};

export type ExecuteImportCommitResult = {
  importId: string;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  created: number;
  updated: number;
  skipped: SkippedRow[];
  /** Uncapped committed skip total (skipped array is capped for the response payload). */
  skippedCount: number;
  invalidRows: Array<{ rowIndex: number; reason: string }>;
  invalidCount: number;
};

/**
 * The job of this import was closed before it could start: an erasure or a removal in the event stopped it, or it
 * was reclaimed as stale. Thrown first in the import's transaction, so nothing of the import is written.
 */
export class ImportStoppedError extends Error {
  readonly code = "import_stopped" as const;

  constructor() {
    super("Import stopped before it finished.");
    this.name = "ImportStoppedError";
  }
}

export { ImportCapacityExceededError } from "./event-capacity.js";

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
      if (params.adminJobId) {
        // First, before any other lock: the row of the job is held until the import has committed, so an erasure or
        // a removal in the event (which locks the open jobs before it locks an attendee, see lockOpenAttendeeJobs)
        // either waits for this import to finish or has already closed the job, and then nothing of this import
        // is written. Whichever came first, no person is created or changed behind an erasure's back.
        const [job] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status" FROM "AdminJob" WHERE "id" = ${params.adminJobId} FOR UPDATE
        `;
        if (job?.status !== "running") throw new ImportStoppedError();
      }
      if (ticketTypes) {
        await acquireEventTicketTypesLock(tx, params.eventId);
      }

      // Catalog before capacity, and capacity before dry-run classification or attendee locks.
      await acquireEventCapacityLock(tx, params.eventId);

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

      capacityForcedMeta = await assertImportCapacityInTx(tx, params.eventId, dry.toCreate, params.forceCapacity);

      const result = await commitImport(
        params.eventId,
        rowsToCommit,
        {
          dryRun: false,
          forceCapacity: params.forceCapacity,
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

      if (params.adminJobId) {
        const invalidCombined = [...parsed.invalidRows, ...lockInvalidatedRows];
        await tx.adminJob.updateMany({
          where: { id: params.adminJobId, status: "running" },
          data: {
            status: "succeeded",
            finished_at: new Date(),
            to_create: result.toCreate,
            to_update: result.toUpdate,
            to_skip: result.toSkip,
            created_count: result.created,
            updated_count: result.updated,
            skipped_count: result.skipped.length,
            invalid_count: invalidCombined.length,
            result_json: {
              importId: params.importId,
              toCreate: result.toCreate,
              toUpdate: result.toUpdate,
              toSkip: result.toSkip,
              created: result.created,
              updated: result.updated,
              skipped: capRows(result.skipped),
              skippedCount: result.skipped.length,
              invalidRows: capRows(invalidCombined),
              invalidCount: invalidCombined.length,
            },
            error: null,
          },
        });
      }

      return result;
    },
    EVENT_CAPACITY_TRANSACTION_OPTIONS,
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
    skippedCount: summary.skipped.length,
    invalidRows: capRows(allInvalid),
    invalidCount: allInvalid.length,
  };
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
