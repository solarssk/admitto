import { Prisma } from "@admitto/db/client";

const REMOVED_REASON = "Entry removed: the person's data was erased";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A letter or a digit, in any script (an address may be an internationalised one). */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** What may stand in the local part of an address: letters, digits, the dot, the hyphen and every
 * other character RFC 5322 allows there. This app's own validator takes the underscore, the plus,
 * the hyphen and the apostrophe, so `_a@x.com`, `+a@x.com` and `o'a@x.com` are addresses of their
 * own and not `a@x.com` with a mark in front of it. */
const LOCAL_PART_CHARACTER = /[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]/u;

/** A quote mark. The apostrophe is valid in a local part, but at the start of one it is a quote
 * around the value (a cell that reads 'a@x.com') far more often than a part of an address, and an
 * erased address left behind in quotes would be the worse mistake. */
const QUOTE_MARK = /['`]/;

/** The character right before `from` goes on in the same local part, so `from` is the tail of a
 * longer, different address (`banana@x.com`, `_a@x.com`, `x!a@x.com`, `=a@x.com`), unless that
 * character is a quote mark that opens the value. A mark that is not a local-part character at
 * all (a bracket, a double quote, a comma, a space) never continues it. */
function localPartContinuesBefore(text: string, from: number): boolean {
  const before = text.charAt(from - 1);
  if (!LOCAL_PART_CHARACTER.test(before)) return false;
  return !(QUOTE_MARK.test(before) && !LOCAL_PART_CHARACTER.test(text.charAt(from - 2)));
}

/** The domain goes on after `end`: another letter or digit, or a dot or a hyphen with one behind it
 * (`a@x.com.au`, `a@x.community`). A dot or a hyphen that ends a sentence or a word ("... for
 * a@x.com.") does not, and no other character can continue a domain. */
function domainContinuesAfter(text: string, end: number): boolean {
  const next = text.charAt(end);
  if (WORD_CHARACTER.test(next)) return true;
  return (next === "." || next === "-") && WORD_CHARACTER.test(text.charAt(end + 1));
}

/** True when `text` contains `email` as a whole address: not as the tail of a longer local part and
 * not as the start of a longer domain, so erasing `a@x.com` does not also match `banana@x.com`. */
export function containsAddress(text: string, email: string): boolean {
  for (let from = text.indexOf(email); from !== -1; from = text.indexOf(email, from + 1)) {
    if (!localPartContinuesBefore(text, from) && !domainContinuesAfter(text, from + email.length)) return true;
  }
  return false;
}

function mentionsAny(value: unknown, emails: readonly string[]): boolean {
  const text = JSON.stringify(value).toLowerCase();
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
 * address back. A job that is still running has no result yet, and cannot write one after the erasure: the
 * erasure that calls this has stopped it (stopOpenAttendeeJobs), or waited for it to finish and so sees its result.
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

  const rewrites: { id: string; result: JsonRecord }[] = [];
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

    if (changed) rewrites.push({ id: job.id, result });
  }
  // One connection runs the transaction's statements in the order they are issued, so the jobs
  // (already locked in id order above) are still written in that order.
  await Promise.all(
    rewrites.map((rewrite) =>
      tx.adminJob.update({ where: { id: rewrite.id }, data: { result_json: rewrite.result as Prisma.InputJsonValue } }),
    ),
  );
  return rewrites.length;
}
