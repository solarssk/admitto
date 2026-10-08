import { Prisma } from "@admitto/db/client";

const REMOVED_REASON = "Entry removed: the person's data was erased";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ADDRESS_CHARACTER = /[a-z0-9._%+@-]/;

/** True when `text` contains `email` as a whole address: the character before and after must not
 * continue an address, so erasing `a@x.com` does not also match `banana@x.com`. */
function containsAddress(text: string, email: string): boolean {
  for (let from = text.indexOf(email); from !== -1; from = text.indexOf(email, from + 1)) {
    const before = text.charAt(from - 1);
    const after = text.charAt(from + email.length);
    if (!(before && ADDRESS_CHARACTER.test(before)) && !(after && ADDRESS_CHARACTER.test(after))) return true;
  }
  return false;
}

function mentionsAny(value: unknown, emails: readonly string[]): boolean {
  const text = JSON.stringify(value ?? null).toLowerCase();
  return emails.some((email) => containsAddress(text, email));
}

/**
 * The saved result of an import (AdminJob.result_json) lists the rows it skipped, with the email
 * of each, and the rows it could not read, with the whole CSV row and a reason that quotes the
 * value. Those copies are not keyed by attendee, so an erasure cannot find them by id: this blanks
 * every entry that mentions one of the given addresses (the addresses the erased attendees had)
 * and leaves everything else, including all the counts, as it was.
 *
 * The jobs are locked, in id order, before they are read: two erasures of different people listed
 * in the same import would otherwise each rewrite the job from a stale copy and bring the other's
 * address back. A job that is still running has no result yet; the import that wrote it skipped
 * the attendee before the erasure and is not covered.
 *
 * Returns the number of jobs rewritten.
 */
export async function scrubImportJobResults(
  tx: Prisma.TransactionClient,
  eventId: string,
  emails: readonly string[],
): Promise<number> {
  const needles = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email.length > 0))];
  if (needles.length === 0) return 0;
  const jobs = await tx.$queryRaw<{ id: string; result_json: unknown }[]>`
    SELECT "id", "result_json" FROM "AdminJob"
    WHERE "event_id" = ${eventId} AND "type" = 'import_commit' AND "result_json" IS NOT NULL
    ORDER BY "id"
    FOR UPDATE
  `;

  let rewritten = 0;
  for (const job of jobs) {
    if (!isRecord(job.result_json)) continue;
    const result: JsonRecord = { ...job.result_json };
    let changed = false;

    if (Array.isArray(result.skipped)) {
      result.skipped = result.skipped.map((entry: unknown) => {
        if (!mentionsAny(entry, needles)) return entry;
        changed = true;
        return { email: null, reason: REMOVED_REASON };
      });
    }
    if (Array.isArray(result.invalidRows)) {
      result.invalidRows = result.invalidRows.map((entry: unknown) => {
        if (!mentionsAny(entry, needles)) return entry;
        changed = true;
        return { rowIndex: isRecord(entry) ? (entry.rowIndex ?? null) : null, raw: null, reason: REMOVED_REASON };
      });
    }

    if (changed) {
      await tx.adminJob.update({ where: { id: job.id }, data: { result_json: result as Prisma.InputJsonValue } });
      rewritten += 1;
    }
  }
  return rewritten;
}
