import type { Prisma, PrismaClient } from "@admitto/db";
import { getDefaultStorage, purgeEventJobFiles } from "@admitto/storage";
import {
  deleteErasedWalletPasses,
  eraseAttendees,
  scrubImportJobResults,
  writeAdminAuditLog,
  writeBulkActionLog,
  type EraseAttendeesResult,
} from "@admitto/tickets";
import { CliError, arg, hasFlag } from "../lib/args.js";
import { requireOperatorUserId } from "../lib/audit.js";
import { confirmYes } from "../lib/confirm.js";
import {
  passToDelete,
  resolveEventWalletProvider,
  type EventWalletCredentials,
} from "../lib/retention-erased-wallet-passes.js";

/** The same cap as the bulk erase API: one transaction, and one provider call per pass after it. */
const MAX_ATTENDEES = 500;
const MAX_ID_LENGTH = 128;
/** An erasure touches a handful of tables per attendee; a large selection needs more than Prisma's default 5 s. */
const ERASE_TX_TIMEOUT_MS = 60_000;
/** Nothing waits for this command but the operator, so the provider gets longer than the API's 90 s. */
const WALLET_BUDGET_MS = 10 * 60_000;

const USAGE =
  "Usage: admitto attendees erase --event <id> --attendee-ids <id[,id...]> --operator-email <email> [--dry-run] [--yes]";

/** What the command needs from outside, so a test can stand in for the prompt, the storage and the provider. */
export type AttendeesEraseDeps = {
  confirm: (prompt: string) => Promise<boolean>;
  purgeJobFiles: (db: PrismaClient, eventId: string, jobIds: readonly string[]) => Promise<{ deleted: number; failed: number }>;
  resolveProvider: typeof resolveEventWalletProvider;
  deletePasses: typeof deleteErasedWalletPasses;
};

const realDeps: AttendeesEraseDeps = {
  confirm: confirmYes,
  purgeJobFiles: (db, eventId, jobIds) => purgeEventJobFiles(db, getDefaultStorage(), eventId, jobIds),
  resolveProvider: resolveEventWalletProvider,
  deletePasses: deleteErasedWalletPasses,
};

export function parseAttendeesEraseArgs(argv: string[] = process.argv): {
  eventId: string;
  attendeeIds: string[];
  dryRun: boolean;
  yes: boolean;
} {
  const eventId = arg("event", argv);
  const raw = arg("attendee-ids", argv);
  if (!eventId || !raw) throw new CliError(USAGE);
  const attendeeIds = [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
  if (attendeeIds.length === 0) throw new CliError(USAGE);
  if (attendeeIds.length > MAX_ATTENDEES) throw new CliError(`At most ${MAX_ATTENDEES} attendees at a time.`);
  if (attendeeIds.some((id) => id.length > MAX_ID_LENGTH)) throw new CliError("An attendee id is too long.");
  return { eventId, attendeeIds, dryRun: hasFlag("dry-run", argv), yes: hasFlag("yes", argv) };
}

type EventToErase = EventWalletCredentials & { organization_id: string; title: string };

/**
 * What an erasure writes besides the erasure itself, inside its transaction: the saved import results lose the
 * erased addresses, and the event's activity log and the central audit log get an entry with ids and counts only
 * (the person asked to be forgotten, so the record of who erased whom must not name them). The same entries the
 * erase API writes, with `source: "cli"`.
 */
async function recordErasure(
  tx: Prisma.TransactionClient,
  context: {
    eventId: string;
    event: EventToErase;
    operatorUserId: string;
    bulk: boolean;
    erased: EraseAttendeesResult;
  },
): Promise<void> {
  const { eventId, event, operatorUserId, bulk, erased } = context;
  await scrubImportJobResults(tx, eventId, erased.previousEmails);
  const actionType = bulk ? "attendees_bulk_erased" : "attendee_erased";
  const metadata = bulk
    ? { attendee_ids: erased.erasedIds, count: erased.erasedIds.length, method: "erase", source: "cli" }
    : { attendee_id: erased.erasedIds[0], method: "erase", source: "cli" };
  await writeBulkActionLog(tx, {
    event_id: eventId,
    action_type: actionType,
    audit: { operator: operatorUserId, ip: "127.0.0.1" },
    metadata: { ...metadata, removed: erased.counts },
  });
  await writeAdminAuditLog(tx, {
    organizationId: event.organization_id,
    actorUserId: operatorUserId,
    ip: "127.0.0.1",
    actionType,
    metadata: { event_id: eventId, event_title: event.title, ...metadata },
  });
}

/** Deletes the files the event's exports and imports left in storage (those of the jobs the erasure saw), best effort: the erasure has committed, so a failure here must not hide that. */
async function purgeJobFilesBestEffort(
  db: PrismaClient,
  eventId: string,
  jobIds: readonly string[],
  deps: AttendeesEraseDeps,
): Promise<{ deleted: number; failed: number }> {
  try {
    return await deps.purgeJobFiles(db, eventId, jobIds);
  } catch (err) {
    console.error(`Export and import files could not be deleted (${err instanceof Error ? err.message : String(err)}); the retention run will try again.`);
    return { deleted: 0, failed: 0 };
  }
}

/** Erased attendees among `attendeeIds` whose pass is still to be deleted at the provider. */
async function passesStillToDelete(db: PrismaClient, eventId: string, attendeeIds: string[]): Promise<string[]> {
  const passes = await db.walletPass.findMany({
    where: passToDelete(eventId, attendeeIds),
    select: { attendee_id: true },
  });
  return passes.map((pass) => pass.attendee_id);
}

/** Deletes the passes of `attendeeIds` at the provider, best effort. Returns how many are deleted and how many are left. */
async function deletePassesAtProvider(
  db: PrismaClient,
  eventId: string,
  event: EventToErase,
  attendeeIds: string[],
  deps: AttendeesEraseDeps,
): Promise<{ deleted: number; left: number }> {
  const before = await passesStillToDelete(db, eventId, attendeeIds);
  const provider = deps.resolveProvider(event);
  if (!provider && before.length > 0) {
    console.error("The event has no usable wallet credentials, so its passes cannot be deleted at the provider.");
  }
  if (provider && before.length > 0) {
    try {
      const run = await deps.deletePasses(db, eventId, attendeeIds, provider, { budgetMs: WALLET_BUDGET_MS });
      for (const attendeeId of run.failedAttendeeIds) {
        console.error(`Wallet pass of attendee ${attendeeId} could not be deleted (${run.failureCodes.join(",")}).`);
      }
    } catch (err) {
      console.error(`Wallet pass deletion failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Read from the database rather than taken from the call above, so it is right whether the pass could not be
  // deleted, no provider is configured, or the call threw.
  const after = new Set(await passesStillToDelete(db, eventId, attendeeIds));
  return { deleted: before.filter((id) => !after.has(id)).length, left: after.size };
}

/**
 * `admitto attendees erase`: the break-glass way to erase attendees' personal data when the admin UI or API is not
 * reachable (a privacy request does not wait for it). It does what the erase API does: anonymises the attendees in
 * place (see eraseAttendees), blanks their addresses in saved import results, writes the audit entries (ids and counts
 * only, `source: "cli"`), then deletes the files the event's exports and imports left in storage and the attendees' wallet passes at the provider.
 * Running it again for people who are already erased changes nothing in the database and tries their passes again.
 */
export async function runAttendeesErase(
  db: PrismaClient,
  deps: AttendeesEraseDeps = realDeps,
  argv: string[] = process.argv,
): Promise<void> {
  const { eventId, attendeeIds, dryRun, yes } = parseAttendeesEraseArgs(argv);
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      organization_id: true,
      title: true,
      wallet_template_id: true,
      wallet_api_key_enc: true,
      wallet_field_mapping: true,
    },
  });
  if (!event) throw new CliError("Event not found.");

  const found = await db.attendee.findMany({
    where: { event_id: eventId, id: { in: attendeeIds } },
    select: { id: true, erased_at: true },
  });
  const alreadyErased = found.filter((attendee) => attendee.erased_at !== null).length;
  const toErase = found.length - alreadyErased;
  const notFound = attendeeIds.length - found.length;
  console.log(`Event "${event.title}": ${toErase} to erase, ${alreadyErased} already erased, ${notFound} not found.`);
  if (found.length === 0) throw new CliError("None of the given ids is an attendee of this event.");
  if (dryRun) {
    console.log("Dry run: nothing was changed.");
    return;
  }

  const operatorUserId = await requireOperatorUserId(db, argv);
  if (toErase > 0 && !yes) {
    const prompt = `Erase the personal data of ${toErase} attendee(s)? This cannot be undone. Type "yes" to continue: `;
    if (!(await deps.confirm(prompt))) throw new CliError("Aborted: nothing was changed.");
  }

  const erased = await db.$transaction(
    async (tx) => {
      const result = await eraseAttendees(tx, { eventId, attendeeIds });
      if (result.erasedIds.length > 0) {
        await recordErasure(tx, { eventId, event, operatorUserId, bulk: attendeeIds.length > 1, erased: result });
      }
      return result;
    },
    { timeout: ERASE_TX_TIMEOUT_MS },
  );

  // Files written before the erasure still hold the person: they go too (nothing for an erasure that erased nobody new).
  const files = erased.erasedIds.length > 0 ? await purgeJobFilesBestEffort(db, eventId, erased.jobIdsWithFiles, deps) : { deleted: 0, failed: 0 };
  const wallet = await deletePassesAtProvider(db, eventId, event, [...erased.erasedIds, ...erased.alreadyErasedIds], deps);

  const failedFilesNote = files.failed > 0 ? ` (${files.failed} could not be deleted; the retention run will try again)` : "";
  console.log(
    `Erased ${erased.erasedIds.length}, already erased ${erased.alreadyErasedIds.length}, not found ${erased.notFoundIds.length}. ` +
      `Export and import files deleted: ${files.deleted}${failedFilesNote}. ` +
      `Wallet passes deleted at the provider: ${wallet.deleted}.`,
  );
  if (wallet.left > 0) {
    throw new CliError(
      `${wallet.left} wallet pass(es) are still at the provider. Run the same command again to try them again.`,
      2,
    );
  }
}
