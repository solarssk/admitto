import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { revealSensitiveAnswers, type RevealResult, type RevealSubject } from "@admitto/tickets";
import { assertEventManageAccess, requireAuditActor, requireEventId } from "./admin-helpers.js";
import { requireManagedEventAttendee } from "./attendees-api-routes.js";

/**
 * The administrator's deliberate "Show" of the answers to sensitive questions (D-E6): one person at a time, the guest and
 * their companion.
 *
 * - `POST /api/admin/events/:eventId/registrations/:id/reveal` for a guest's registration;
 * - `POST /api/admin/events/:eventId/attendees/:id/reveal-sensitive` for an attendee.
 *
 * Both take no body and answer `{ guest, companions }` (see `RevealedAnswers` in `@admitto/tickets`): the answers to the
 * questions that are sensitive now and have a value, by the key of the question, and nothing else. Both are for an
 * administrator of the event's organisation and a superadmin, checked here on the server (an operator gets 403, and so
 * does an administrator of another organisation), and both work on an archived event: reading is not a change. Each call
 * is an entry in the event's activity log and in the central audit log, written in the transaction that reads the answers
 * (a failed entry fails the call and returns no answer), and the two share one budget per user (`admin:sensitive-reveal`).
 *
 * The answers are in the response and nowhere else: no log line, no error text and no audit entry carries one. The
 * response is `Cache-Control: no-store` like every answer of the API.
 */

/** The answer to a call that came to nothing. */
function refusal(c: Context, outcome: Exclude<RevealResult["outcome"], "revealed">): Response {
  // Erased, removed, or not in the event, as for every other write on an attendee. A registration that is gone is a 404.
  if (outcome === "attendee_gone") return c.json({ error: "attendee_erased" }, 409);
  return c.json({ error: "not_found" }, 404);
}

async function reveal(c: Context, db: PrismaClient, eventId: string, subject: RevealSubject): Promise<Response> {
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;
  const result = await revealSensitiveAnswers(db, { eventId, subject, actor });
  return result.outcome === "revealed" ? c.json(result.answers) : refusal(c, result.outcome);
}

/** POST /api/admin/events/:eventId/registrations/:id/reveal. 404 `not_found` for a registration that is not in the event (or was deleted). */
export async function handleRevealRegistrationAnswers(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not_found" }, 404);
  return reveal(c, db, eventId, { kind: "registration", id });
}

/** POST /api/admin/events/:eventId/attendees/:id/reveal-sensitive. 409 `attendee_erased` for an attendee who was erased. */
export async function handleRevealAttendeeAnswers(c: Context, db: PrismaClient): Promise<Response> {
  const context = await requireManagedEventAttendee(c, db);
  if (context instanceof Response) return context;
  return reveal(c, db, context.eventId, { kind: "attendee", id: context.attendeeId });
}
