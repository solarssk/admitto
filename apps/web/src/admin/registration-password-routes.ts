/**
 * Staff API for the shared password of an event whose way in is the password (D-C3):
 *
 * - `PUT /api/admin/events/:eventId/registration/password` with `{ "password": "..." }` sets it, or changes it.
 * - `DELETE` of the same path switches it off: guests are turned away at the 404 until a new one is set.
 *
 * Both answer `204` with no body, always. The password goes in and is never read back: not the text, not the hash, not
 * its length, in an answer, in the audit entry or in a log. It is checked for its length only (REGISTRATION_PASSWORD_MIN
 * to REGISTRATION_PASSWORD_MAX characters) and is taken as typed, spaces included.
 *
 * Mounted behind the archived-event guard, which checks first that the caller manages the event (an organisation admin
 * or a superadmin, like the other event routes: an operator gets 403, so does an admin of another organisation) and
 * then that the event is not archived (403 `event_archived`). Setting a password needs no registration settings yet:
 * the row is made, with registration off, and the password waits for the way in to be chosen. A change or a switch-off
 * touches no registration and no confirmation link that is still valid.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { z } from "zod";
import { REGISTRATION_PASSWORD_MAX, REGISTRATION_PASSWORD_MIN, registrationPasswordLength } from "@admitto/shared";
import { clearEventPassword, setEventPassword } from "../registration/event-password.js";
import { requireAuditActor, requireEventId } from "./admin-helpers.js";

/** The body is a short JSON object: the longest password is 128 characters, a few bytes each at the most. */
export const MAX_REGISTRATION_PASSWORD_BODY_BYTES = 4_096;

const putBodySchema = z.object({ password: z.string() }).strict();

/** PUT /api/admin/events/:eventId/registration/password */
export async function handlePutRegistrationPassword(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = putBodySchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);
  // Before the hash is computed: a password the rule refuses costs nothing.
  const length = registrationPasswordLength(parsed.data.password);
  if (length < REGISTRATION_PASSWORD_MIN || length > REGISTRATION_PASSWORD_MAX) {
    return c.json({ error: "registration_password_length" }, 400);
  }

  const result = await setEventPassword(db, { eventId, password: parsed.data.password, actor });
  // A superadmin has access to an event that is not there; every other caller was refused before this.
  if (result === "not_found") return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
}

/** DELETE /api/admin/events/:eventId/registration/password */
export async function handleDeleteRegistrationPassword(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;

  const result = await clearEventPassword(db, { eventId, actor });
  if (result === "not_found") return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
}
