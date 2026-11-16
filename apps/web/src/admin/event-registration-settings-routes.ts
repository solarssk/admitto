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
import { canManageInstance } from "@admitto/auth";
import { SSO_CLAIM_VALUES_MAX, ssoClaimNameProblem, ssoClaimValueProblem } from "@admitto/shared";
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
 * - `access_methods`: `[]` or exactly one of `"link"`, `"password"` and `"sso"` (the company sign-in);
 * - `waitlist_enabled`, `verify_email`, `ask_company`, `ask_department`, `styled_form_controls`: switches;
 * - `max_companions`: 0 to `MAX_COMPANION_SLOTS`;
 * - `consent_keys`: keys of the event's published extra consents (a key it has not published is a 422);
 * - `sso_claim_name` and `sso_claim_values` (D-C4): the restriction of the company sign-in to the people whose token holds one
 *   of the values in one claim, sent together. `null` and `[]` remove it. A restriction sent for an event whose way in is
 *   not the company sign-in is a 422 `sso_claim_needs_sso`; moving an event away from that way in removes the restriction.
 *   Only a superadmin may change it: from anyone else a change is a 403 `sso_claim_superadmin_only` (a restriction sent as it
 *   already is, and a move away from the company sign-in, are no change);
 * - `sso_provider_id` (D-C4): the identity provider guests of the event sign in with, an enabled OIDC provider (a provider that is
 *   not one, switched off or unknown is a 422 `sso_provider_not_available`; a provider already chosen may stay while it is off).
 *   Sent for an event whose way in is not the company sign-in it is a 422 `sso_provider_needs_sso`; `null` removes the choice, and
 *   moving an event away from that way in removes it. How guests open the form is technical: only a superadmin may change the way
 *   in (403 `access_method_superadmin_only`) or the provider (403 `sso_provider_superadmin_only`); a value sent as it already is,
 *   is no change. The other settings stay with the administrator of the event;
 * - `bot_protection_enabled`: the bot check (Turnstile) of the link and password forms of this event, on by default. It counts only while the
 *   organisation's own switch is on. Only a superadmin may change it (403 `bot_protection_superadmin_only`; a value sent as it already is,
 *   is no change). Turning it on is judged like a change of the access method when registration is on (the keys must be saved);
 * - `expected_sso_provider_id`: the provider the caller's screen showed (an id or `null`). When it differs from the one stored, once the
 *   save holds its locks, nothing is saved and the answer is a 409 `sso_provider_changed`. Left out, no check is made.
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
    bot_protection_enabled: z.boolean().optional(),
    consent_keys: z.array(z.string().regex(LEGAL_CONSENT_KEY_PATTERN)).max(MAX_CONSENT_DOCUMENTS_PER_EVENT).optional(),
    sso_claim_name: z.string().trim().min(1).refine((name) => ssoClaimNameProblem(name) === null).nullable().optional(),
    // The provider of the company sign-in, a cuid of an identity provider: its existence and state are judged by the save.
    sso_provider_id: z.string().trim().min(1).max(64).nullable().optional(),
    expected_sso_provider_id: z.string().trim().min(1).max(64).nullable().optional(),
    sso_claim_values: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .refine((value) => ssoClaimValueProblem(value) === null),
      )
      .max(SSO_CLAIM_VALUES_MAX)
      .optional(),
  })
  .strict()
  // The name and the values move together, and agree: a name needs a value to match, and values need a claim to be read from.
  .refine((body) => (body.sso_claim_name === undefined) === (body.sso_claim_values === undefined))
  .refine((body) => body.sso_claim_name === undefined || (body.sso_claim_name === null) === (body.sso_claim_values?.length === 0));

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

  // The restriction to one company is a superadmin's to change: checked here on the server, whatever the screen shows.
  const canChangeSsoClaim = await canManageInstance(db, c.get("auth").userId);
  const result = await updateEventRegistrationSettings(db, { eventId, patch: parsed.data, actor, canChangeSsoClaim });
  switch (result.kind) {
    case "saved":
      return c.json(result.settings);
    case "not_found":
      return c.json({ error: "not_found" }, 404);
    case "archived":
      return c.json({ code: "event_archived" }, 403);
    case "consent_not_published":
      return c.json({ error: "consent_not_published" }, 422);
    case "sso_claim_needs_sso":
      return c.json({ error: "sso_claim_needs_sso" }, 422);
    case "sso_claim_superadmin_only":
      return c.json({ error: "sso_claim_superadmin_only" }, 403);
    case "sso_provider_changed":
      return c.json({ error: "sso_provider_changed" }, 409);
    case "bot_protection_superadmin_only":
      return c.json({ error: "bot_protection_superadmin_only" }, 403);
    case "access_method_superadmin_only":
      return c.json({ error: "access_method_superadmin_only" }, 403);
    case "sso_provider_needs_sso":
      return c.json({ error: "sso_provider_needs_sso" }, 422);
    case "sso_provider_not_available":
      return c.json({ error: "sso_provider_not_available" }, 422);
    case "sso_provider_superadmin_only":
      return c.json({ error: "sso_provider_superadmin_only" }, 403);
    case "not_ready":
      // The keys of the checks that are not met, and nothing else: no text, no value, no name of anybody.
      return c.json({ error: "registration_not_ready", blockers: result.blockers }, 409);
  }
}
