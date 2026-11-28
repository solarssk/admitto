/**
 * Staff API that decides on the guest registrations of one event: accept them, turn them down, and send a
 * mail that failed again. The list and the detail it works from are in registrations-api-routes.ts; deleting a
 * registration is another route.
 *
 * Every route is a POST under `/api/admin/events/:eventId/registrations` that takes `ids`: one registration is a
 * list of one, and a selection is at most MAX_REGISTRATION_BULK_IDS (500). Each is mounted behind the archived-event
 * guard, which checks first that the caller manages the event (an organisation admin or a superadmin, like the other
 * event routes: an operator gets 403) and then that the event is not archived (403 `event_archived`: an archived
 * event is read-only). The decision itself lives in `@admitto/tickets`, where it runs in one transaction under the
 * event's locks; nothing here sends a mail (the worker does, from the queue the decision filled).
 *
 * The answer has one entry per id, in the order asked (a repeated id once), so that a double click, a second
 * organiser, an import or an erasure that came first is told apart from a decision that took effect. An id that is not
 * a registration of this event is `gone`, whoever it belongs to. Nothing in a request or an answer is a name or an
 * address.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import {
  MAX_REGISTRATION_BULK_IDS,
  admitRegistrations,
  rejectRegistrations,
  retryRegistrationMails,
  type AdmitOutcome,
  type RejectOutcome,
  type RetryMailOutcome,
  type StaffActor,
} from "@admitto/tickets";
import { requireAuditActor, requireEventId } from "./admin-helpers.js";
import { publishActivityChanged } from "./checkin-sse-publish.js";

const idsSchema = z.array(z.string().max(128)).min(1).max(MAX_REGISTRATION_BULK_IDS);
const idsBodySchema = z.object({ ids: idsSchema }).strict();
/** `notify`: mail the rejected guests that they were turned down. Left out, nobody is mailed (D-B8). */
const rejectBodySchema = z.object({ ids: idsSchema, notify: z.boolean().optional() }).strict();

/** What became of one registration of an acceptance (AdmitOutcome, less `closed`, which is the answer 403). */
export type AcceptRegistrationResultDto =
  | { id: string; outcome: "accepted"; attendee_id: string }
  | { id: string; outcome: "already_decided" | "awaiting_email" | "already_attendee" | "gone" };

export type AcceptRegistrationsDto = { results: AcceptRegistrationResultDto[] };

export type RejectRegistrationsDto = {
  results: { id: string; outcome: "rejected" | "already_decided" | "awaiting_email" | "gone" }[];
};

export type RetryRegistrationMailsDto = {
  results: { id: string; outcome: "retried" | "not_retryable" | "gone" }[];
};

type DecisionRequest<T> = { eventId: string; actor: StaffActor; body: T };

/** The event, the acting staff member and the checked body of a request; or the answer to send. */
async function readDecisionRequest<T>(
  c: Context,
  db: PrismaClient,
  schema: z.ZodType<T>,
): Promise<DecisionRequest<T> | Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  // A superadmin has access to an event that is not there; every other caller was refused before this.
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return c.json({ error: "not_found" }, 404);
  return { eventId, actor, body: parsed.data };
}

/**
 * The event was archived (or deleted) after the guard looked and before the transaction did: the decision changed
 * nothing, and every id says `closed`. The same answer as the guard's.
 */
function eventClosedResponse(c: Context): Response {
  return c.json({ code: "event_archived" }, 403);
}

/** The per-id results of an acceptance, or null when the event was closed under it. */
function acceptResults(outcomes: readonly AdmitOutcome[]): AcceptRegistrationResultDto[] | null {
  const results: AcceptRegistrationResultDto[] = [];
  for (const entry of outcomes) {
    if (entry.outcome === "closed") return null;
    results.push(
      entry.outcome === "accepted"
        ? { id: entry.id, outcome: "accepted", attendee_id: entry.attendeeId }
        : { id: entry.id, outcome: entry.outcome },
    );
  }
  return results;
}

/** The per-id results of a rejection, or null when the event was closed under it. */
function rejectResults(outcomes: readonly RejectOutcome[]): RejectRegistrationsDto["results"] | null {
  const results: RejectRegistrationsDto["results"] = [];
  for (const entry of outcomes) {
    if (entry.outcome === "closed") return null;
    results.push({ id: entry.id, outcome: entry.outcome });
  }
  return results;
}

/** The per-id results of a retry, or null when the event was closed under it. */
function retryResults(outcomes: readonly RetryMailOutcome[]): RetryRegistrationMailsDto["results"] | null {
  const results: RetryRegistrationMailsDto["results"] = [];
  for (const entry of outcomes) {
    if (entry.outcome === "closed") return null;
    results.push({ id: entry.id, outcome: entry.outcome });
  }
  return results;
}

/**
 * POST /api/admin/events/:eventId/registrations/accept
 * Body: `{ ids }`. Admits registrations that are `pending`, on the `waitlist` or `rejected` (D-B8): each becomes an
 * attendee, and its ticket mail is queued. Together the guests (each with a companion) must fit the seats that are
 * left (D-B4): when they do not, 409 `not_enough_seats` with `free` and `needed` (in seats), and nothing is changed,
 * not even for those that would have fitted. An event without a limit never refuses. A superadmin cannot force more
 * guests in than the limit: raise the limit first.
 */
export async function handleAcceptEventRegistrations(c: Context, db: PrismaClient): Promise<Response> {
  const request = await readDecisionRequest(c, db, idsBodySchema);
  if (request instanceof Response) return request;
  const { eventId, actor, body } = request;

  const result = await admitRegistrations(db, { eventId, ids: body.ids, actor });
  if (result.status === "not_enough_seats") {
    return c.json({ error: "not_enough_seats", free: result.free, needed: result.needed }, 409);
  }
  const results = acceptResults(result.outcomes);
  if (!results) return eventClosedResponse(c);
  // The attendees list and the Overview of the event show the new people.
  if (results.some((entry) => entry.outcome === "accepted")) publishActivityChanged(eventId);
  return c.json({ results } satisfies AcceptRegistrationsDto);
}

/**
 * POST /api/admin/events/:eventId/registrations/reject
 * Body: `{ ids, notify? }`. Turns down registrations that are `pending` or on the `waitlist` (D-B8). The guest is
 * mailed only when `notify` is true. The registration stays, `rejected`: the guest cannot register again with the
 * address until staff delete it, and staff can still accept it later. Takes no seat, so a full event can do it.
 */
export async function handleRejectEventRegistrations(c: Context, db: PrismaClient): Promise<Response> {
  const request = await readDecisionRequest(c, db, rejectBodySchema);
  if (request instanceof Response) return request;
  const { eventId, actor, body } = request;

  const result = await rejectRegistrations(db, { eventId, ids: body.ids, actor, notify: body.notify ?? false });
  const results = rejectResults(result.outcomes);
  if (!results) return eventClosedResponse(c);
  return c.json({ results } satisfies RejectRegistrationsDto);
}

/**
 * POST /api/admin/events/:eventId/registrations/retry-mail
 * Body: `{ ids }`. Sends again the last mail of each registration (the one the list shows) when it failed and the
 * worker is not trying it again by itself (D-B15; `can_retry` in the list). The registration keeps its state.
 */
export async function handleRetryEventRegistrationMails(c: Context, db: PrismaClient): Promise<Response> {
  const request = await readDecisionRequest(c, db, idsBodySchema);
  if (request instanceof Response) return request;
  const { eventId, actor, body } = request;

  const result = await retryRegistrationMails(db, { eventId, ids: body.ids, actor });
  const results = retryResults(result.outcomes);
  if (!results) return eventClosedResponse(c);
  return c.json({ results } satisfies RetryRegistrationMailsDto);
}
