import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@admitto/db";
import { z } from "zod";
import { recordSystemLog } from "@admitto/shared/system-log";
import { resolveConfiguredWalletProvider } from "@admitto/wallet";
import {
  deleteErasedWalletPasses,
  eraseAttendees,
  parseWalletFieldMapping,
  scrubImportJobResults,
  writeBulkActionLog,
  type EraseAttendeesResult,
} from "@admitto/tickets";
import { adminAuditFromContext, assertEventManageAccess, requireEventId } from "./admin-helpers.js";
import { assertWalletBulkSelectionWithinLimit, writeAttendeeLifecycleAuditLog } from "./attendees-api-routes.js";
import { BULK_SEND_LIMIT } from "./bulk-send-routes.js";
import { publishActivityChanged } from "./checkin-sse-publish.js";

/** An erasure touches a handful of tables per attendee; a large selection needs more than
 * Prisma's default 5 s transaction. */
const ERASE_TX_TIMEOUT_MS = 60_000;

/** How long the wallet follow-up may run: shorter than the reverse proxy's read timeout, so a slow
 * provider cannot turn a committed erasure into a gateway error. What it did not reach is reported
 * as pending, and repeating the request carries on. */
const WALLET_FOLLOW_UP_BUDGET_MS = 90_000;

/** One wallet follow-up per user and event at a time: a second click while the first still waits
 * for the provider would only run the same deletes again. */
const inFlightWalletFollowUps = new Set<string>();

const bulkEraseBodySchema = z
  .object({
    attendeeIds: z.array(z.string().max(128)).min(1).max(BULK_SEND_LIMIT),
  })
  .strict();

type EraseResponseBody = {
  /** Erased by this request. */
  erased: number;
  /** Already erased before: nothing was touched, but their wallet pass was tried again. */
  already_erased: number;
  /** Ids that match no attendee of this event. */
  not_found: number;
  /** Erased attendees of this request whose wallet pass is still not deleted at the provider. */
  wallet_pending: number;
};

/**
 * What an erasure writes besides the erasure itself, inside its transaction: the saved import
 * results lose the erased addresses, and the event's activity log and the central audit log get an
 * entry with ids and counts only (the person asked to be forgotten, so the record of who erased
 * whom must not name them).
 */
async function recordErasure(
  tx: Prisma.TransactionClient,
  c: Context,
  context: {
    eventId: string;
    event: { organization_id: string; title: string };
    audit: ReturnType<typeof adminAuditFromContext>;
    actionType: string;
    mode: "single" | "bulk";
    erased: EraseAttendeesResult;
  },
): Promise<void> {
  const { eventId, event, audit, actionType, mode, erased } = context;
  await scrubImportJobResults(tx, eventId, erased.previousEmails);
  const metadata =
    mode === "single"
      ? { attendee_id: erased.erasedIds[0], method: "erase" }
      : { attendee_ids: erased.erasedIds, count: erased.erasedIds.length, method: "erase" };
  await writeBulkActionLog(tx, {
    event_id: eventId,
    action_type: actionType,
    audit,
    metadata: { ...metadata, removed: erased.counts },
  });
  await writeAttendeeLifecycleAuditLog(tx, c, audit, event.organization_id, actionType, {
    event_id: eventId,
    event_title: event.title,
    ...metadata,
  });
}

/**
 * Erases the personal data of the given attendees (see eraseAttendees) and then deletes their
 * wallet passes at the provider. Repeating it for attendees that are already erased changes nothing
 * in the database and simply tries the pending wallet deletes again: that is the "try again" of a
 * failed one. Allowed on an archived event (privacy requests do not expire with the event).
 *
 * The audit trail records ids and counts only, never a name or address.
 */
async function runErasure(
  c: Context,
  db: PrismaClient,
  eventId: string,
  attendeeIds: string[],
  mode: "single" | "bulk",
): Promise<{ body: EraseResponseBody; result: EraseAttendeesResult } | null> {
  // Access to an event that does not exist is granted to a superadmin all the same, so the event
  // can be missing here: null, and the caller answers like it does for any event the user cannot see.
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
  if (!event) return null;

  const audit = adminAuditFromContext(c);
  const actionType = mode === "single" ? "attendee_erased" : "attendees_bulk_erased";
  const result = await db.$transaction(
    async (tx) => {
      const erased = await eraseAttendees(tx, { eventId, attendeeIds });
      if (erased.erasedIds.length > 0) {
        await recordErasure(tx, c, { eventId, event, audit, actionType, mode, erased });
      }
      return erased;
    },
    { timeout: ERASE_TX_TIMEOUT_MS },
  );

  // After the commit: a network call has no place inside the transaction. Credentials alone decide
  // whether a provider exists; the event's wallet switch only governs issuing new passes.
  const touchedIds = [...result.erasedIds, ...result.alreadyErasedIds];
  const provider = resolveConfiguredWalletProvider({
    walletTemplateId: event.wallet_template_id,
    walletApiKeyEnc: event.wallet_api_key_enc,
    walletFieldMapping: parseWalletFieldMapping(event.wallet_field_mapping),
  });
  const slotKey = `${c.get("auth").userId}:${eventId}`;
  if (provider && touchedIds.length > 0 && !inFlightWalletFollowUps.has(slotKey)) {
    inFlightWalletFollowUps.add(slotKey);
    try {
      const wallet = await deleteErasedWalletPasses(db, eventId, touchedIds, provider, {
        budgetMs: WALLET_FOLLOW_UP_BUDGET_MS,
      });
      for (const attendeeId of wallet.failedAttendeeIds) {
        recordSystemLog({
          level: "error",
          source: "admin",
          message: "wallet_pass_erasure_delete_failed",
          fields: { eventId, attendeeId, codes: wallet.failureCodes.join(",") },
        });
      }
    } catch (err) {
      console.error("wallet pass delete (erasure) failed:", err);
    } finally {
      inFlightWalletFollowUps.delete(slotKey);
    }
  }
  // Counted from the database rather than from the call above, so it is right whether the pass
  // could not be deleted, no provider is configured, or the call threw.
  const walletPending =
    touchedIds.length === 0
      ? 0
      : await db.walletPass.count({
          where: {
            attendee_id: { in: touchedIds },
            provider_pass_id: { not: null },
            provider_removed_at: null,
            attendee: { event_id: eventId, erased_at: { not: null } },
          },
        });

  if (result.erasedIds.length > 0) publishActivityChanged(eventId);
  c.header("Cache-Control", "no-store");
  return {
    result,
    body: {
      erased: result.erasedIds.length,
      already_erased: result.alreadyErasedIds.length,
      not_found: result.notFoundIds.length,
      wallet_pending: walletPending,
    },
  };
}

/** POST /api/admin/events/:eventId/attendees/:id/erase - erase one attendee's personal data. */
export async function handleEraseEventAttendee(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;
  const attendeeId = c.req.param("id")!;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const outcome = await runErasure(c, db, eventId, [attendeeId], "single");
  // An event that is not there, or not an attendee of this event: the same answer as every other
  // single-attendee route.
  if (!outcome || outcome.result.notFoundIds.length > 0) return c.json({ error: "forbidden" }, 403);
  return c.json(outcome.body);
}

/** POST /api/admin/events/:eventId/attendees/bulk-erase - erase the personal data of a selection. */
export async function handleBulkEraseEventAttendees(c: Context, db: PrismaClient): Promise<Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = bulkEraseBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  // One provider call per pass follows the commit: the same cap as the other bulk wallet actions.
  if (!(await assertWalletBulkSelectionWithinLimit(db, eventId, parsed.data.attendeeIds))) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const outcome = await runErasure(c, db, eventId, parsed.data.attendeeIds, "bulk");
  if (!outcome) return c.json({ error: "forbidden" }, 403);
  return c.json(outcome.body);
}
