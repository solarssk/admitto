import type { Context } from "hono";
import type { Prisma, PrismaClient } from "@admitto/db";
import { z } from "zod";
import {
  RegistrantInputError,
  removeAttendeeCompanion,
  writeActionLog,
  writeAttendeeCompanion,
  type AttendeeCompanionRemoveResult,
  type AttendeeCompanionWriteResult,
} from "@admitto/tickets";
import { adminAuditFromContext } from "./admin-helpers.js";
import {
  buildAttendeeDetailDto,
  requireManagedEventAttendee,
  writeAttendeeLifecycleAuditLog,
  type ManagedEventAttendee,
} from "./attendees-api-routes.js";
import { publishActivityChanged } from "./checkin-sse-publish.js";

/**
 * The staff routes of a guest's companion (D-E5: "the organiser may correct their data"): edit it, and remove it. Both are
 * mounted behind `guardArchivedEvent` (which checks that the caller manages the event, an administrator of its
 * organisation or a superadmin, and refuses an archived event) and behind the CSRF guard of every staff write. Both take
 * the data of a third party, so what they log is ids and counts, never the name or an answer, and neither adds a
 * companion: that takes a seat, and a seat is taken under the capacity lock, which only an admission does.
 *
 * Both answer with the attendee's detail as it is afterwards, the way every write on the attendee's page does.
 */

/** The statement timeout lets a write wait for a lock as long as an erasure that is open or a writer of registrations
 * holds it, so the transaction waits that long too. */
const COMPANION_TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;

/** The one companion of an attendee (MAX_COMPANION_SLOTS is 1): the slot of the audit entries. */
const COMPANION_SLOT = 1;

/**
 * The whole companion as the page sends it: the name, and the answers by the key of the question. Nothing else is taken.
 * What the name and the answers hold is judged by the boundary of a registrant that the registration form goes through
 * too (`writeAttendeeCompanion`): a name that is a link, an address or too long, an answer that is not text, a question
 * about the guest, an unknown key and `__proto__` are all refused or left out there, so the rules are not written twice.
 * Answers left out are cleared.
 */
const companionBodySchema = z.object({ name: z.string(), custom_data: z.unknown().optional() }).strict();

/** What a write that did not write answers with: the status and the code of the refusal. */
const REFUSALS = {
  // Erased, or removed between the route's read and the lock of the domain function.
  attendee_gone: [409, "attendee_erased"],
  // Removed by someone else meanwhile, or never there.
  no_companion: [404, "companion_not_found"],
  // The routes never name a slot, so this cannot happen; it is a refusal all the same, never a write.
  invalid_slot: [400, "validation_failed"],
} as const;

function refusal(c: Context, outcome: keyof typeof REFUSALS): Response {
  const [status, code] = REFUSALS[outcome];
  return c.json({ error: code }, status);
}

/** The entries of one change: the attendee's own activity log and the central audit log, ids and counts only. */
async function recordCompanionChange(
  tx: Prisma.TransactionClient,
  c: Context,
  context: { eventId: string; attendeeId: string; actionType: string; metadata: Record<string, unknown> },
): Promise<void> {
  const { eventId, attendeeId, actionType, metadata } = context;
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { organization_id: true, title: true } });
  const audit = adminAuditFromContext(c);
  await writeActionLog(tx, { event_id: eventId, attendee_id: attendeeId, action_type: actionType, audit, metadata });
  await writeAttendeeLifecycleAuditLog(tx, c, audit, event.organization_id, actionType, {
    event_id: eventId,
    event_title: event.title,
    attendee_id: attendeeId,
    ...metadata,
  });
}

async function readBody(c: Context): Promise<{ data: z.infer<typeof companionBodySchema> } | { response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { response: c.json({ error: "invalid json" }, 400) };
  }
  const parsed = companionBodySchema.safeParse(body);
  if (!parsed.success) return { response: c.json({ error: "validation_failed" }, 400) };
  return { data: parsed.data };
}

/** The attendee's detail after the change. The companion in it is read now; the attendee's own columns are what the route
 * read first, which a write to the companion does not touch. */
async function answerWithDetail(c: Context, db: PrismaClient, context: ManagedEventAttendee): Promise<Response> {
  return c.json(await buildAttendeeDetailDto(db, context.eventId, context.attendee));
}

/**
 * PATCH /api/admin/events/:eventId/attendees/:id/companion - corrects the name and the answers of the attendee's companion.
 * 404 `companion_not_found` for an attendee who has none (it never adds one), 409 `attendee_erased` for an erased one, 400
 * `validation_failed` for a body or a name or an answer that the boundary of a registrant refuses.
 */
export async function handlePatchAttendeeCompanion(c: Context, db: PrismaClient): Promise<Response> {
  const context = await requireManagedEventAttendee(c, db);
  if (context instanceof Response) return context;
  const { attendeeId, eventId } = context;

  const body = await readBody(c);
  if ("response" in body) return body.response;

  try {
    const outcome = await db.$transaction(async (tx): Promise<AttendeeCompanionWriteResult["outcome"]> => {
      const written = await writeAttendeeCompanion(tx, {
        eventId,
        attendeeId,
        name: body.data.name,
        customData: body.data.custom_data,
      });
      if (written.outcome !== "written") return written.outcome;
      await recordCompanionChange(tx, c, { eventId, attendeeId, actionType: "attendee_companion_updated", metadata: { slot: COMPANION_SLOT } });
      return "written";
    }, COMPANION_TRANSACTION_OPTIONS);
    if (outcome !== "written") return refusal(c, outcome);
  } catch (err) {
    // The code is fixed and says nothing of the input; the class is all that is looked at.
    if (err instanceof RegistrantInputError) return c.json({ error: "validation_failed" }, 400);
    throw err;
  }
  return answerWithDetail(c, db, context);
}

/**
 * DELETE /api/admin/events/:eventId/attendees/:id/companion - removes the attendee's companion: the guest comes alone after
 * all. A privacy action: the name and the answers go from the companion table and from the copy in the guest's registration,
 * the seat is free again, and the entries say that a companion was removed and that a seat was freed, never who. Takes no body.
 * 404 `companion_not_found` for an attendee who has none, 409 `attendee_erased` for an erased one.
 */
export async function handleDeleteAttendeeCompanion(c: Context, db: PrismaClient): Promise<Response> {
  const context = await requireManagedEventAttendee(c, db);
  if (context instanceof Response) return context;
  const { attendeeId, eventId } = context;

  const outcome = await db.$transaction(async (tx): Promise<AttendeeCompanionRemoveResult["outcome"]> => {
    const removed = await removeAttendeeCompanion(tx, { eventId, attendeeId, slot: COMPANION_SLOT });
    if (removed.outcome !== "removed") return removed.outcome;
    await recordCompanionChange(tx, c, {
      eventId,
      attendeeId,
      actionType: "attendee_companion_removed",
      metadata: { slot: COMPANION_SLOT, seats_freed: 1 },
    });
    return "removed";
  }, COMPANION_TRANSACTION_OPTIONS);
  if (outcome !== "removed") return refusal(c, outcome);

  // The seat is free: the Overview of the event and the screens that count seats read it again.
  publishActivityChanged(eventId);
  return answerWithDetail(c, db, context);
}
