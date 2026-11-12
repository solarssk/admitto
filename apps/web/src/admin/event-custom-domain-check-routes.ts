/**
 * `POST /api/admin/events/:eventId/registration/custom-domain/check` (D-C6, PR 120): "Check now" for the event's own address for
 * guests. SUPERADMIN ONLY, like the setting itself (an organisation admin and an operator get 403), because the check makes a request
 * to a host a superadmin chose and the first success turns the address on for every guest of the event.
 *
 * It asks the address for its proof (`GET https://<address>/.well-known/admitto-domain-check`, `checkEventDomain` in
 * `@admitto/mail-delivery`: the pinned client with the SSRF guard that every operator-chosen address is reached with), records what it
 * found and answers the state, the same shape as `GET` of the setting (./event-custom-domain-routes.ts). The first `ok` verifies the
 * address; a later failure never takes the verification back, it only shows (D-C6). The worker repeats the check once a day.
 *
 * - 404 `not_found`: no such event.
 * - 409 `custom_domain_not_set`: the event has no address to check.
 * - The answer holds one of six words and times, never the text of an error, a header or a body of the address' answer.
 * - A per-user limit (`admin:domain-check`, 5 a minute) bounds how often a request can be made to a host a person typed.
 * - Mounted behind the archived-event guard (403 `event_archived`: an archived event is read only) and the cross-site check.
 *
 * When the check ran, the memory of the events' own addresses of this process is cleared, so the routing sees the verification at once
 * (another process, and the worker, catch up when their entries expire, within 30 seconds).
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { checkEventDomain, type DomainCheckDeps } from "@admitto/mail-delivery";
import { requireEventId, requireSuperadmin } from "./admin-helpers.js";
import { stateOf } from "./event-custom-domain-routes.js";

export interface CustomDomainCheckDeps {
  /** The host name of the instance (lower case), or null while it has none: an event's address cannot be the instance's own. */
  instanceHostname: () => Promise<string | null>;
  /** Called after a check that was recorded, so the memory of the events' own addresses of this process does not hold the old answer. */
  onChecked: () => void;
  /** Test-only: the lookup and the pinned request. */
  probe?: Pick<DomainCheckDeps, "resolve" | "fetchPinned">;
}

/** POST /api/admin/events/:eventId/registration/custom-domain/check */
export async function handleCheckEventCustomDomain(c: Context, db: PrismaClient, deps: CustomDomainCheckDeps): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return c.json({ error: "not_found" }, 404);

  const { state, recorded } = await checkEventDomain(db, eventId, { ...deps.probe, instanceHostname: await deps.instanceHostname() });
  if (recorded === null) return c.json({ error: "custom_domain_not_set" }, 409);
  if (recorded.kind === "recorded") deps.onChecked();
  return c.json(stateOf(state));
}
