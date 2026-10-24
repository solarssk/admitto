/**
 * Staff API that deletes the guest registrations of one event: one, a selection, or everything a filter selects.
 * Reading them and deciding on them are other routes (registrations-api-routes.ts, which also holds the list filter this
 * one reuses).
 *
 * - `POST /api/admin/events/:eventId/registrations/delete` takes `ids` (one registration is a list of one, at most
 *   MAX_REGISTRATION_BULK_IDS).
 * - `POST /api/admin/events/:eventId/registrations/delete-by-filter` takes the filter of the list (`status`,
 *   `older_than`, `q`, at least one of them), `expected`, the number the staff member was shown for it (`total` of the
 *   list), and `selection_digest`, the name the list gave the registrations it showed. It deletes only when exactly those
 *   match under the registration queue (that many, with those ids), and not more than MAX_REGISTRATION_BULK_IDS: a
 *   deletion cannot be undone, so it never takes what the staff member did not see.
 *
 * Both are for the administrator of the event's organisation and a superadmin (an operator gets 403, and so does an
 * administrator of another organisation), and both work on an archived event, as erasing does: a request to delete
 * personal data does not expire with the event. A registration that is accepted is an attendee too, and deleting it
 * erases the attendee by the same path as "Erase personal data" (see deleteRegistrations in `@admitto/tickets`), so the
 * wallet pass is deleted at the provider afterwards and the same audit entries are written. Nothing is mailed.
 *
 * The answer lists each registration as `deleted` (with the erased attendee's id for an accepted one) or `gone`: not a
 * registration of this event, whoever it belongs to. Nothing in a request, an answer, a log line or an audit entry is a
 * name, an address or a search text.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import {
  ERASE_TRANSACTION_TIMEOUT_MS,
  MAX_REGISTRATION_BULK_IDS,
  deleteRegistrations,
  parseRegistrationFilter,
  type DeleteRegistrationsResult,
  type DeleteRegistrationsTarget,
  type StaffActor,
} from "@admitto/tickets";
import { assertEventManageAccess, requireAuditActor, requireEventId } from "./admin-helpers.js";
import { finishErasure, recordErasure, type ErasedEvent, type ErasureFollowUp } from "./attendee-erase-routes.js";
import { WALLET_BULK_SEND_LIMIT } from "./attendees-api-routes.js";
import { publishActivityChanged } from "./checkin-sse-publish.js";

const idsBodySchema = z
  .object({ ids: z.array(z.string().max(128)).min(1).max(MAX_REGISTRATION_BULK_IDS) })
  .strict();

/** The values are checked by parseRegistrationFilter (closed lists, a search text that can be searched for); here only their size. */
const filterBodySchema = z
  .object({
    status: z.string().max(64).optional(),
    older_than: z.string().max(64).optional(),
    q: z.string().max(1024).optional(),
    expected: z.number().int().min(0),
    selection_digest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

/** A staff request may wait for the locks of the event as long as the statement timeout lets it. */
const DELETION_TRANSACTION_OPTIONS = { timeout: ERASE_TRANSACTION_TIMEOUT_MS, maxWait: 10_000 } as const;

export type DeleteRegistrationResultDto =
  | { id: string; outcome: "deleted"; attendee_id?: string }
  | { id: string; outcome: "gone" };

export type DeleteRegistrationsDto = {
  /** One entry per registration, in the order asked for (a repeated id once), or by id for a filter. */
  results: DeleteRegistrationResultDto[];
  deleted: number;
  /** The accepted registrations among them: their attendees were erased. */
  attendees_erased: number;
  /** Erased attendees whose wallet pass is still to be deleted at the provider; the erase of the attendee tries it again. */
  wallet_pending: number;
};

type DeletionEvent = ErasedEvent & { organization_id: string; title: string };
type DeletionContext = { eventId: string; actor: StaffActor; event: DeletionEvent };
type Deleted = Extract<DeleteRegistrationsResult, { status: "done" }>;

/** The event, the staff member and the checked body of a request; or the answer to send. */
async function readRequest<T>(
  c: Context,
  db: PrismaClient,
  schema: z.ZodType<T>,
): Promise<(DeletionContext & { body: T }) | Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;
  // Not behind the archived-event guard: only who may manage the event is asked, so an archived event can be cleared too.
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const body = schema.safeParse(raw);
  if (!body.success) return c.json({ error: "validation_failed" }, 400);

  // A superadmin has access to an event that is not there; everyone else was refused above.
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
  if (!event) return c.json({ error: "not_found" }, 404);
  return { eventId, actor, event, body: body.data };
}

/** The answer to a deletion that was refused: nothing was deleted. */
function refusalResponse(c: Context, result: Exclude<DeleteRegistrationsResult, { status: "done" }>): Response {
  switch (result.status) {
    case "count_changed":
      return c.json({ error: "registration_count_changed", expected: result.expected, matched: result.matched }, 409);
    case "selection_changed":
      return c.json({ error: "registration_selection_changed", matched: result.matched }, 409);
    case "too_many_registrations":
      return c.json({ error: "too_many_registrations", matched: result.matched, limit: result.limit }, 422);
    case "too_many_accepted":
      return c.json({ error: "too_many_accepted", accepted: result.accepted, limit: result.limit }, 422);
    case "filter_required":
      return c.json({ error: "validation_failed", fields: ["status", "older_than", "q"] }, 400);
  }
}

function answerOf(target: DeleteRegistrationsTarget, result: Deleted, followUp: ErasureFollowUp | null): DeleteRegistrationsDto {
  const attendeeOf = new Map(result.deleted.map((row) => [row.id, row.attendeeId]));
  const gone = new Set(result.goneIds);
  const asked = target.kind === "ids" ? [...new Set(target.ids)] : result.deleted.map((row) => row.id);
  const results = asked.map((id): DeleteRegistrationResultDto => {
    if (gone.has(id)) return { id, outcome: "gone" };
    const attendeeId = attendeeOf.get(id);
    return attendeeId ? { id, outcome: "deleted", attendee_id: attendeeId } : { id, outcome: "deleted" };
  });
  return {
    results,
    deleted: result.deleted.length,
    attendees_erased: result.erased?.erasedIds.length ?? 0,
    wallet_pending: followUp?.pending ?? 0,
  };
}

/**
 * The deletion in one transaction, and what follows its commit. The transaction holds the deletion (and the erasure of
 * the attendees of the accepted registrations), and the audit entries of both: the registrations' (written by
 * deleteRegistrations) and the erasure's (recordErasure, the same entries "Erase personal data" writes, so the page of
 * an erased attendee says who erased them and a restore from a backup can repeat the erasure). After the commit: the
 * files that exports and imports left, and the wallet passes (finishErasure, the follow-up of an erasure).
 */
async function runDeletion(
  c: Context,
  db: PrismaClient,
  { eventId, actor, event }: DeletionContext,
  target: DeleteRegistrationsTarget,
): Promise<Response> {
  // The pass of each erased attendee is a call to the provider after the commit: with credentials, the cap of the other bulk wallet actions.
  const walletConfigured = Boolean(event.wallet_template_id && event.wallet_api_key_enc);
  const result = await db.$transaction(async (tx) => {
    const deletion = await deleteRegistrations(tx, {
      eventId,
      target,
      actor,
      ...(walletConfigured ? { maxAccepted: WALLET_BULK_SEND_LIMIT } : {}),
    });
    const erased = deletion.status === "done" ? deletion.erased : null;
    if (erased?.erasedIds.length) {
      const one = erased.erasedIds.length === 1;
      await recordErasure(tx, c, {
        eventId,
        event,
        audit: actor,
        actionType: one ? "attendee_erased" : "attendees_bulk_erased",
        mode: one ? "single" : "bulk",
        erased,
      });
    }
    return deletion;
  }, DELETION_TRANSACTION_OPTIONS);

  if (result.status !== "done") return refusalResponse(c, result);
  const followUp = result.erased ? await finishErasure(c, db, eventId, event, result.erased) : null;
  // The registrations list and the Overview of the event show one registration fewer, and the attendees list one person.
  if (result.deleted.length > 0) publishActivityChanged(eventId);
  return c.json(answerOf(target, result, followUp));
}

/**
 * POST /api/admin/events/:eventId/registrations/delete
 * Body: `{ ids }`. Deletes each registration that is one of this event, in whatever state, with its queued mail (an
 * accepted one erases its attendee: the ticket stops working and the place is free again, unless the person was
 * admitted or the event is archived). Repeating it answers `gone` for what is deleted already.
 */
export async function handleDeleteEventRegistrations(c: Context, db: PrismaClient): Promise<Response> {
  const request = await readRequest(c, db, idsBodySchema);
  if (request instanceof Response) return request;
  return runDeletion(c, db, request, { kind: "ids", ids: request.body.ids });
}

/**
 * POST /api/admin/events/:eventId/registrations/delete-by-filter
 * Body: `{ status?, older_than?, q?, expected, selection_digest }`: the parameters of the list, its `total`, and its
 * `selection_digest`. A value outside the lists of the filter answers 400 `validation_failed` with the names of the
 * parameters, and so does a filter that selects everything (none of the three). Under the registration queue the filter
 * is read again: another number than `expected` answers 409 `registration_count_changed` (`expected`, `matched`), the
 * same number of other registrations 409 `registration_selection_changed` (`matched`), more than a request may carry
 * 422 `too_many_registrations` (`matched`, `limit`), and more accepted registrations than the wallet provider can follow
 * in one request 422 `too_many_accepted` (`accepted`, `limit`). Nothing is deleted in any of those cases.
 */
export async function handleDeleteEventRegistrationsByFilter(c: Context, db: PrismaClient): Promise<Response> {
  const request = await readRequest(c, db, filterBodySchema);
  if (request instanceof Response) return request;
  const { body } = request;
  const filter = parseRegistrationFilter({ status: body.status, olderThan: body.older_than, q: body.q });
  if (!filter.ok) return c.json({ error: "validation_failed", fields: filter.invalid }, 400);
  return runDeletion(c, db, request, {
    kind: "filter",
    filter: filter.filter,
    expected: body.expected,
    digest: body.selection_digest,
  });
}
