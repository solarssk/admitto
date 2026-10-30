/**
 * Staff API for the registration settings of one event (PR 99a), under `/api/admin/events/:eventId/registration/settings`:
 *
 * - `GET` reads them with the readiness of the event: which checks are met (fixed keys), whether a password is set (a
 *   yes or a no: never the hash, never its length), the address of the form and the questions a guest will see.
 * - `PUT` changes some of them (see {@link putBodySchema}) and answers like the `GET`. Turning registration on, and
 *   changing the way in or the consents of an event that has it on, is refused with `409 registration_not_ready` and the
 *   keys of the checks that are not met (and nothing else) until the event is ready. Turning it off is never refused.
 *
 * Both check on the server that the caller manages the event (an organisation admin or a superadmin, like the other
 * event routes: an operator gets 403, and so does an admin of another organisation). The `PUT` is mounted behind the
 * archived-event guard as well (403 `event_archived`: an archived event is read only) and checks the archive again in
 * its transaction. The password is set and switched off by its own routes (`.../registration/password`); this one takes no
 * password and cannot hand one back.
 */
import type { Context } from "hono";
import { z } from "zod";
import { REGISTRATION_MODE, type PrismaClient } from "@admitto/db";
import { MAX_COMPANION_SLOTS } from "@admitto/tickets";
import { LEGAL_CONSENT_KEY_PATTERN, MAX_CONSENT_DOCUMENTS_PER_EVENT } from "../legal/legal-documents.js";
import { SELECTABLE_ACCESS_METHODS } from "../registration/access-methods.js";
import { assertEventManageAccess, requireAuditActor, requireEventId } from "./admin-helpers.js";
import { getEventRegistrationSettings, updateEventRegistrationSettings } from "./event-registration-settings.js";

/** The body is a handful of switches and at most ten short keys. */
export const MAX_REGISTRATION_SETTINGS_BODY_BYTES = 4_096;

/**
 * What a `PUT` may carry; every key is optional and an unknown one is a 400, so a key that is not a setting (a password,
 * a hash, `sso`) cannot be sent by mistake or by design:
 *
 * - `mode`: `null` (off), `"automatic"` or `"approval"`;
 * - `access_methods`: `[]` or exactly one of `"link"` and `"password"` (the company sign-in comes with PR 118);
 * - `waitlist_enabled`, `verify_email`, `ask_company`, `ask_department`, `styled_form_controls`: switches;
 * - `max_companions`: 0 to `MAX_COMPANION_SLOTS`;
 * - `consent_keys`: keys of the event's published extra consents (a key it has not published is a 422).
 */
const putBodySchema = z
  .object({
    mode: z.enum(REGISTRATION_MODE).nullable().optional(),
    access_methods: z.array(z.enum(SELECTABLE_ACCESS_METHODS)).max(1).optional(),
    waitlist_enabled: z.boolean().optional(),
    verify_email: z.boolean().optional(),
    max_companions: z.number().int().min(0).max(MAX_COMPANION_SLOTS).optional(),
    ask_company: z.boolean().optional(),
    ask_department: z.boolean().optional(),
    styled_form_controls: z.boolean().optional(),
    consent_keys: z.array(z.string().regex(LEGAL_CONSENT_KEY_PATTERN)).max(MAX_CONSENT_DOCUMENTS_PER_EVENT).optional(),
  })
  .strict();

/** GET /api/admin/events/:eventId/registration/settings */
export async function handleGetEventRegistrationSettings(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const settings = await getEventRegistrationSettings(db, eventId);
  // A superadmin has access to an event that is not there; every other caller was refused before this.
  if (!settings) return c.json({ error: "not_found" }, 404);
  return c.json(settings);
}

/** PUT /api/admin/events/:eventId/registration/settings */
export async function handlePutEventRegistrationSettings(c: Context, db: PrismaClient): Promise<Response> {
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;
  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = putBodySchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation_failed" }, 400);

  const result = await updateEventRegistrationSettings(db, { eventId, patch: parsed.data, actor });
  switch (result.kind) {
    case "saved":
      return c.json(result.settings);
    case "not_found":
      return c.json({ error: "not_found" }, 404);
    case "archived":
      return c.json({ code: "event_archived" }, 403);
    case "consent_not_published":
      return c.json({ error: "consent_not_published" }, 422);
    case "not_ready":
      // The keys of the checks that are not met, and nothing else: no text, no value, no name of anybody.
      return c.json({ error: "registration_not_ready", blockers: result.blockers }, 409);
  }
}
