/**
 * CLI for importing attendees from a CSV file.
 *
 *   npx tsx src/cli.ts --event <eventId> --file attendees.csv           (dry-run by default)
 *   npx tsx src/cli.ts --event <eventId> --file attendees.csv --commit
 *   npx tsx src/cli.ts --event <eventId> --file attendees.csv --commit --overwrite
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@admitto/db";
import { acquireEventTicketTypesLock } from "@admitto/tickets";
import { parseAttendees } from "./parser.js";
import { commitImport } from "./importer.js";
import { formatSkippedImportRow } from "./cli-output.js";
import { loadImportTicketTypes } from "./ticket-type-import.js";
import type { AttendeeRow, ImportSummary } from "./types.js";

/** Lock wait + row writes share this budget - same values as import-api-routes.ts's
 * handleImportCommit (queued concurrent commits), duplicated here since this package can't
 * depend on apps/web (CodeRabbit review: the default $transaction timeout is 5s, too short for a
 * large CSV competing with other imports for the per-event lock). */
const IMPORT_TX_TIMEOUT_MS = 120_000;
const IMPORT_TX_MAX_WAIT_MS = 30_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Args for one import run, split out from the `process.argv`/`process.exit` shell below so tests
 * can invoke the core logic directly instead of shelling out to `npx tsx` per test. */
export type RunImportOptions = {
  eventId: string;
  filePath: string;
  commit: boolean;
  overwrite: boolean;
};

export type RunImportResult = {
  warnings: string[];
  /** Parse-time invalid rows plus any rows the lock-time catalog recheck excluded below - merged
   * so the caller reports one consistent picture instead of two separate listings. */
  invalidRows: { rowIndex: number; reason: string }[];
  /** Rows actually eligible to commit after the lock-time recheck (0 when nothing to import). */
  validCount: number;
  /** Null when there was nothing to import - commitImport was never called. */
  summary: ImportSummary | null;
};

/**
 * Parse a CSV file and commit it against an event's ticket-type catalog.
 *
 * Locked against a concurrent ticket-type DELETE for the whole commit (TOCTOU fix) - same pattern
 * as apps/web's import-api-routes.ts handleImportCommit: the `ticketTypes` catalog snapshot loaded
 * before the transaction opened stays valid once the lock is held, since a delete's own in-use
 * recheck can no longer slip in and remove a type this batch is about to write. The catalog is
 * reread fresh under the lock and any row whose type was deleted in the narrow window between the
 * snapshot and the lock being held is dropped before commitImport ever sees it. Runs the same way
 * for dry-run and real commits - a dry-run preview should still reflect a race-free picture of
 * what actually committing would do.
 */
export async function runImport(options: RunImportOptions): Promise<RunImportResult> {
  const { eventId, filePath, commit, overwrite } = options;

  // Fail fast with a readable error - commitImport normally checks this too, but only once rows
  // reach it, so a bad --event id with an all-invalid (or empty) CSV would otherwise never trigger
  // that check and silently "succeed" with zero imported rows instead.
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new Error(`Event not found: "${eventId}"`);

  // `filePath` is the local operator's explicit --file selection; this CLI never accepts it over HTTP.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- local operator-selected import file
  const csv = fs.readFileSync(filePath, "utf8");
  const ticketTypes = await loadImportTicketTypes(prisma, eventId);
  const parsed = parseAttendees(csv, { ticketTypes });

  if (parsed.validRows.length === 0) {
    return {
      warnings: parsed.warnings,
      invalidRows: parsed.invalidRows,
      validCount: 0,
      summary: null,
    };
  }

  const { summary, rowsCommitted, lockInvalidatedRows } = await prisma.$transaction(
    async (tx) => {
      let rowsToCommit = parsed.validRows;
      let freshTicketTypes = ticketTypes;
      const lockInvalidated: { rowIndex: number; reason: string }[] = [];

      // Only taken when the import actually validates against a catalog - guarded the same way
      // import-api-routes.ts's handleImportCommit guards it, in case a future caller opts out.
      if (ticketTypes) {
        await acquireEventTicketTypesLock(tx, eventId);

        freshTicketTypes = await loadImportTicketTypes(tx, eventId);
        const freshKeys = new Set(freshTicketTypes.map((t) => t.key));
        const stillValid: AttendeeRow[] = [];
        for (const row of parsed.validRows) {
          if (row.ticket_type !== undefined && !freshKeys.has(row.ticket_type)) {
            lockInvalidated.push({
              rowIndex: row.rowIndex,
              reason: `Unknown ticket type: "${row.ticket_type}"`,
            });
          } else {
            stillValid.push(row);
          }
        }
        rowsToCommit = stillValid;
      }

      const result = await commitImport(
        eventId,
        rowsToCommit,
        { overwrite, dryRun: !commit, ownedTransaction: true, ticketTypes: freshTicketTypes },
        tx,
      );
      return { summary: result, rowsCommitted: rowsToCommit.length, lockInvalidatedRows: lockInvalidated };
    },
    { timeout: IMPORT_TX_TIMEOUT_MS, maxWait: IMPORT_TX_MAX_WAIT_MS },
  );

  return {
    warnings: parsed.warnings,
    invalidRows: [...parsed.invalidRows, ...lockInvalidatedRows],
    validCount: rowsCommitted,
    summary,
  };
}

async function main() {
  const eventId = arg("event");
  const file = arg("file");
  const commit = flag("commit");
  const overwrite = flag("overwrite");

  if (!eventId || !file) {
    console.error("Usage: import-attendees --event <id> --file <path> [--commit] [--overwrite]");
    process.exit(1);
  }

  const filePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);

  const result = await runImport({ eventId, filePath, commit, overwrite });

  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.warn(`⚠  ${w}`);
  }
  if (result.invalidRows.length > 0) {
    console.warn(`\n${result.invalidRows.length} invalid row(s):`);
    for (const r of result.invalidRows) {
      console.warn(`  row ${r.rowIndex}: ${r.reason}`);
    }
  }

  console.log(`\nParsed: ${result.validCount} valid, ${result.invalidRows.length} invalid`);

  if (!result.summary) {
    console.log("Nothing to import.");
    return;
  }

  const summary = result.summary;
  const mode = commit ? "COMMIT" : "DRY-RUN";
  console.log(`\n[${mode}] event=${eventId} overwrite=${overwrite}`);
  console.log(`  to create : ${summary.toCreate}`);
  console.log(`  to update : ${summary.toUpdate}`);
  console.log(`  to skip   : ${summary.toSkip}`);

  if (commit) {
    console.log(`  created   : ${summary.created}`);
    console.log(`  updated   : ${summary.updated}`);
  }

  if (summary.skipped.length > 0) {
    console.log(`\nSkipped:`);
    for (const s of summary.skipped) console.log(formatSkippedImportRow(s));
  }

  if (!commit) {
    console.log("\nRun with --commit to apply changes.");
  }
}

// Don't run the CLI shell (argv parsing, process.exit) when this file is imported by a test
// exercising runImport directly - same NODE_ENV=test guard used for this exact reason in
// apps/web/src/index.ts and ops/migrations-check.ts.
if (process.env.NODE_ENV !== "test") {
  try {
    await main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
