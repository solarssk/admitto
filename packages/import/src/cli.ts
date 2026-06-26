/**
 * CLI for importing attendees from a CSV file.
 *
 *   npx tsx src/cli.ts --event <eventId> --file attendees.csv           (dry-run by default)
 *   npx tsx src/cli.ts --event <eventId> --file attendees.csv --commit
 *   npx tsx src/cli.ts --event <eventId> --file attendees.csv --commit --overwrite
 */
import fs from "node:fs";
import path from "node:path";
import { parseAttendees } from "./parser.js";
import { commitImport } from "./importer.js";
import { formatSkippedImportRow } from "./cli-output.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
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
  const csv = fs.readFileSync(filePath, "utf8");

  const parsed = parseAttendees(csv);

  if (parsed.warnings.length > 0) {
    for (const w of parsed.warnings) console.warn(`⚠  ${w}`);
  }
  if (parsed.invalidRows.length > 0) {
    console.warn(`\n${parsed.invalidRows.length} invalid row(s):`);
    for (const r of parsed.invalidRows) {
      console.warn(`  row ${r.rowIndex}: ${r.reason}`);
    }
  }

  console.log(`\nParsed: ${parsed.validRows.length} valid, ${parsed.invalidRows.length} invalid`);

  if (parsed.validRows.length === 0) {
    console.log("Nothing to import.");
    process.exit(0);
  }

  const summary = await commitImport(eventId, parsed.validRows, {
    overwrite,
    dryRun: !commit,
  });

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

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
