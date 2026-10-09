import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import { ATTENDEE_REMOVAL_REASONS, type AttendeeRemovalReason } from "@admitto/shared";
import { recordSystemLog } from "@admitto/shared/system-log";
import {
  removeAttendees,
  scrubImportJobResults,
  writeBulkActionLog,
  type RemoveAttendeesResult,
} from "@admitto/tickets";
import { adminAuditFromContext, requireEventId } from "./admin-helpers.js";
import {
  assertWalletBulkSelectionWithinLimit,
  deleteProviderPassesBestEffort,
  deleteWalletPassesBestEffort,
  writeAttendeeLifecycleAuditLog,
} from "./attendees-api-routes.js";
import { BULK_SEND_LIMIT } from "./bulk-send-routes.js";
import { publishActivityChanged } from "./checkin-sse-publish.js";
import { purgeEventExportFilesBestEffort } from "./purge-export-files.js";

/** A removal deletes a handful of tables per attendee; a large selection needs more than Prisma's
 * default 5 s transaction. */
const REMOVE_TX_TIMEOUT_MS = 60_000;

const reasonSchema = z.enum(ATTENDEE_REMOVAL_REASONS);

const removeBodySchema = z.object({ reason: reasonSchema }).strict();

const bulkRemoveBodySchema = z
  .object({
    attendeeIds: z.array(z.string().max(128)).min(1).max(BULK_SEND_LIMIT),
    reason: reasonSchema,
  })
  .strict();

type RemoveResponseBody = {
  /** Deleted by this request. */
  removed: number;
  /** Ids that match no attendee of this event (or that a request running at the same moment deleted first). */
  not_found: number;
};

/**
 * Removes the given attendees from the event for good (see removeAttendees) and writes the audit
 * entries: the event's activity log and the central admin audit log, with the reason code, the ids
 * and the counts, never a name or an address (nor a note: the reason is a fixed list). Their wallet
 * passes are deleted at the provider first, best effort, because the local row is the only place
 * that knows the provider id. The ids of the passes the transaction then deleted are read under
 * the attendee locks, so a pass saved after that first delete (an Add to Wallet request that was
 * running) is deleted after the commit, and so is one the first delete could not delete. A pass
 * that is created at the provider after the commit finds the attendee gone and deletes itself (see
 * handleWalletRedirect).
 *
 * The audit entries reuse the action names of an erasure (`attendee_erased`,
 * `attendees_bulk_erased`) and tell the two apart with `metadata.method` (`"remove"` here,
 * `"erase"` for an erasure).
 */
async function runRemoval(
  c: Context,
  db: PrismaClient,
  eventId: string,
  attendeeIds: string[],
  reason: AttendeeRemovalReason,
  mode: "single" | "bulk",
): Promise<{ body: RemoveResponseBody; result: RemoveAttendeesResult } | null> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { organization_id: true, title: true } });
  if (!event) return null;

  const deletedBeforehand = await deleteWalletPassesBestEffort(db, eventId, attendeeIds);

  const audit = adminAuditFromContext(c);
  const actionType = mode === "single" ? "attendee_erased" : "attendees_bulk_erased";
  const result = await db.$transaction(
    async (tx) => {
      const removed = await removeAttendees(tx, { eventId, attendeeIds });
      // Only unknown ids: nothing was removed, so there is nothing to scrub and nothing to audit.
      if (removed.removedIds.length > 0) {
        await scrubImportJobResults(tx, eventId, removed.previousEmails);
        const metadata =
          mode === "single"
            ? { attendee_id: removed.removedIds[0], method: "remove", reason }
            : { attendee_ids: removed.removedIds, count: removed.removedIds.length, method: "remove", reason };
        await writeBulkActionLog(tx, {
          event_id: eventId,
          action_type: actionType,
          audit,
          metadata: { ...metadata, removed: removed.counts },
        });
        await writeAttendeeLifecycleAuditLog(tx, c, audit, event.organization_id, actionType, {
          event_id: eventId,
          event_title: event.title,
          ...metadata,
        });
      }
      return removed;
    },
    { timeout: REMOVE_TX_TIMEOUT_MS },
  );

  if (result.removedIds.length > 0) {
    // Export files written before the removal still hold the person: they go too.
    await purgeEventExportFilesBestEffort(db, eventId);
    publishActivityChanged(eventId);
  }

  // The removal is done, so nothing below may turn the answer into an error: a failure here only
  // leaves passes at the provider, and is logged like any other failed delete.
  const leftover = result.walletTargets.filter((target) => !deletedBeforehand.has(target.providerPassId));
  try {
    await deleteProviderPassesBestEffort(db, eventId, leftover);
  } catch (err) {
    console.error("wallet pass delete (removal, after commit) failed:", err);
    for (const target of leftover) {
      recordSystemLog({
        level: "error",
        source: "admin",
        message: "wallet_pass_erasure_delete_failed",
        fields: { eventId, attendeeId: target.attendeeId },
      });
    }
  }

  c.header("Cache-Control", "no-store");
  return { result, body: { removed: result.removedIds.length, not_found: result.notFoundIds.length } };
}

async function readBody<T>(c: Context, schema: z.ZodType<T>): Promise<{ data: T } | { response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { response: c.json({ error: "invalid json" }, 400) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { response: c.json({ error: "validation_failed" }, 400) };
  return { data: parsed.data };
}

/**
 * POST /api/admin/events/:eventId/attendees/:id/remove - remove one attendee from the event, with a
 * reason. Mounted behind the archived-event guard (it also checks the caller's access to the event):
 * the numbers of an archived event are final, so nobody is removed from it.
 */
export async function handleRemoveEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeId = c.req.param("id")!;

  const body = await readBody(c, removeBodySchema);
  if ("response" in body) return body.response;

  const outcome = await runRemoval(c, db, eventId, [attendeeId], body.data.reason, "single");
  // An event that is not there, or not an attendee of this event: the same answer as every other
  // single-attendee route.
  if (!outcome || outcome.result.notFoundIds.length > 0) return c.json({ error: "forbidden" }, 403);
  return c.json(outcome.body);
}

/** POST /api/admin/events/:eventId/attendees/bulk-remove - remove a selection from the event, with a reason. */
export async function handleBulkRemoveEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const body = await readBody(c, bulkRemoveBodySchema);
  if ("response" in body) return body.response;

  // One provider call per pass runs before the transaction: the same cap as the other bulk wallet actions.
  if (!(await assertWalletBulkSelectionWithinLimit(db, eventId, body.data.attendeeIds))) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const outcome = await runRemoval(c, db, eventId, body.data.attendeeIds, body.data.reason, "bulk");
  if (!outcome) return c.json({ error: "forbidden" }, 403);
  return c.json(outcome.body);
}
