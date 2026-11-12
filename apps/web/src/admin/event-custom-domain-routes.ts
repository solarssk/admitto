/**
 * Staff API for the event's own address for guests (D-C6, PR 119a), under `/api/admin/events/:eventId/registration/custom-domain`.
 * SUPERADMIN ONLY, checked on the server on both routes (an organisation admin and an operator get 403): a wrong host, or a host
 * that an organiser's hijacked account typed, would be where the ticket tokens of every guest of the event are sent.
 *
 * - `GET` answers `{ custom_domain, custom_domain_status, custom_domain_verified_at, custom_domain_checked_at }`.
 * - `PUT` with `{ "custom_domain": "<host>" | null }` sets the address or, with `null`, removes it. The address is judged by
 *   `parseCustomDomain` (`@admitto/shared`: a bare host name, lower case, punycode, no scheme, port, path, IP address or reserved
 *   name; a refusal is `422 custom_domain_invalid` with `problem`, a fixed word and never the value). The server adds two rules that
 *   need the data: it is not the address of the instance itself (`problem: "instance_host"`: the panel would be taken for a guest's
 *   page), and it is not the address of another event (`409 custom_domain_taken`: one address, one event).
 *
 * Any change of the address, to another or to none, resets what was found about it: status `unchecked`, no verification and no
 * check time. An address is used for guests' links and for routing only once it is VERIFIED (by the check of PR 120, which is the
 * only writer of the other three columns), and the verification of the old address says nothing about the new one. Saving the
 * address an event has already changes and records nothing.
 *
 * Every change is one entry of the central audit log (`registration_custom_domain_updated`: the event, the address before and
 * after; an address is not personal data), written in the transaction of the change. Mounted behind the archived-event guard on the
 * `PUT` (403 `event_archived`: an archived event is read only) and a small body cap.
 */
import type { Context } from "hono";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@admitto/db";
import { parseCustomDomain, type CustomDomainProblem, type CustomDomainStatus } from "@admitto/shared";
import { writeAdminAuditLog, type StaffActor } from "@admitto/tickets";
import { InstanceUrlRequiredError } from "../instance-base-url.js";
import { requireAuditActor, requireEventId, requireSuperadmin } from "./admin-helpers.js";

/** The body is one short host name. */
export const MAX_CUSTOM_DOMAIN_BODY_BYTES = 1_024;

const putBodySchema = z.object({ custom_domain: z.string().trim().nullable() }).strict();

/** The address of the instance (its host is not an event's own address), or a rejection while the instance has none. */
export type CustomDomainInstanceUrl = () => Promise<string>;

/** What a refusal can say about the address: the words of `parseCustomDomain` and the one that needs the instance's address. */
type RefusalProblem = CustomDomainProblem | "instance_host";

export interface CustomDomainState {
  custom_domain: string | null;
  custom_domain_status: CustomDomainStatus;
  custom_domain_verified_at: string | null;
  custom_domain_checked_at: string | null;
}

const NO_DOMAIN: CustomDomainState = {
  custom_domain: null,
  custom_domain_status: "unchecked",
  custom_domain_verified_at: null,
  custom_domain_checked_at: null,
};

const STATE_SELECT = {
  custom_domain: true,
  custom_domain_status: true,
  custom_domain_verified_at: true,
  custom_domain_checked_at: true,
} as const satisfies Prisma.EventRegistrationSettingsSelect;

type StateRow = Prisma.EventRegistrationSettingsGetPayload<{ select: typeof STATE_SELECT }>;

function stateOf(row: StateRow | null): CustomDomainState {
  if (row === null) return NO_DOMAIN;
  return {
    custom_domain: row.custom_domain,
    // The table's CHECK keeps it to the three words; this keeps the type honest.
    custom_domain_status: row.custom_domain_status === "ok" || row.custom_domain_status === "failing" ? row.custom_domain_status : "unchecked",
    custom_domain_verified_at: row.custom_domain_verified_at?.toISOString() ?? null,
    custom_domain_checked_at: row.custom_domain_checked_at?.toISOString() ?? null,
  };
}

/** Whether `domain` is the host of the instance. An instance with no address has no host to take, so nothing is refused for it. */
async function isInstanceHost(domain: string, instanceUrl: CustomDomainInstanceUrl): Promise<boolean> {
  let base: string;
  try {
    base = await instanceUrl();
  } catch (err) {
    // Only an instance with no address is let through; any other failure of the lookup fails the request rather than saving the value unchecked.
    if (err instanceof InstanceUrlRequiredError) return false;
    throw err;
  }
  return new URL(base).hostname.toLowerCase() === domain;
}

/** The address as a value to store, or the reason it cannot be: `null` is no address, a string is judged. */
export async function judgeCustomDomain(
  value: string | null,
  instanceUrl: CustomDomainInstanceUrl,
): Promise<{ ok: true; domain: string | null } | { ok: false; problem: RefusalProblem }> {
  if (value === null) return { ok: true, domain: null };
  const parsed = parseCustomDomain(value);
  if (!parsed.ok) return parsed;
  return (await isInstanceHost(parsed.domain, instanceUrl)) ? { ok: false, problem: "instance_host" } : { ok: true, domain: parsed.domain };
}

type EventForAudit = { organization_id: string; title: string };

async function writeDomainAudit(
  tx: Prisma.TransactionClient,
  event: EventForAudit,
  { eventId, actor, before, after }: { eventId: string; actor: StaffActor; before: string | null; after: string | null },
): Promise<void> {
  await writeAdminAuditLog(tx, {
    organizationId: event.organization_id,
    actorUserId: actor.operator,
    sessionId: actor.sessionId,
    ip: actor.ip,
    timezone: actor.timezone,
    actionType: "registration_custom_domain_updated",
    metadata: { event_id: eventId, event_title: event.title, custom_domain: after, previous_custom_domain: before },
  });
}

/** What a change to an address leaves behind it: nothing that was found about the old one. */
const RESET = { custom_domain_status: "unchecked", custom_domain_verified_at: null, custom_domain_checked_at: null } as const;

type Change = { kind: "saved"; state: CustomDomainState } | { kind: "not_found" };

async function saveDomain(tx: Prisma.TransactionClient, eventId: string, actor: StaffActor, domain: string | null): Promise<Change> {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { organization_id: true, title: true } });
  if (!event) return { kind: "not_found" };
  const current = await tx.eventRegistrationSettings.findUnique({ where: { event_id: eventId }, select: STATE_SELECT });
  const before = current?.custom_domain ?? null;
  if (before === domain) return { kind: "saved", state: stateOf(current) };
  const row = await tx.eventRegistrationSettings.upsert({
    where: { event_id: eventId },
    create: { event_id: eventId, custom_domain: domain },
    update: { custom_domain: domain, ...RESET },
    select: STATE_SELECT,
  });
  await writeDomainAudit(tx, event, { eventId, actor, before, after: domain });
  return { kind: "saved", state: stateOf(row) };
}

/** GET /api/admin/events/:eventId/registration/custom-domain */
export async function handleGetEventCustomDomain(c: Context, db: PrismaClient): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;

  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return c.json({ error: "not_found" }, 404);
  return c.json(stateOf(await db.eventRegistrationSettings.findUnique({ where: { event_id: eventId }, select: STATE_SELECT })));
}

/** The address the body carries (`null`: none), or the answer that refuses the body. */
async function readPutBody(c: Context): Promise<{ value: string | null } | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = putBodySchema.safeParse(raw);
  return parsed.success ? { value: parsed.data.custom_domain } : c.json({ error: "validation_failed" }, 400);
}

/** The change in its transaction, or the answer that says why it was not made. */
async function storeDomain(c: Context, db: PrismaClient, eventId: string, actor: StaffActor, domain: string | null): Promise<Response> {
  let change: Change;
  try {
    change = await db.$transaction((tx) => saveDomain(tx, eventId, actor, domain));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Another event holds the address (the unique index, so two saves at once cannot both win), or this event was deleted meanwhile.
      if (error.code === "P2002") return c.json({ error: "custom_domain_taken" }, 409);
      if (error.code === "P2003") return c.json({ error: "not_found" }, 404);
    }
    throw error;
  }
  // A superadmin can reach an event that is not there.
  return change.kind === "saved" ? c.json(change.state) : c.json({ error: "not_found" }, 404);
}

/** PUT /api/admin/events/:eventId/registration/custom-domain */
export async function handlePutEventCustomDomain(
  c: Context,
  db: PrismaClient,
  instanceUrl: CustomDomainInstanceUrl,
  /** Called after a change that was stored, so the memory of the events' own addresses of this process does not hold the old answer. */
  onChanged: () => void,
): Promise<Response> {
  const denied = await requireSuperadmin(c, db);
  if (denied) return denied;
  const eventId = requireEventId(c);
  if (eventId instanceof Response) return eventId;
  const actor = requireAuditActor(c);
  if (actor instanceof Response) return actor;

  const body = await readPutBody(c);
  if (body instanceof Response) return body;
  const judged = await judgeCustomDomain(body.value, instanceUrl);
  // The word that says what is wrong, and never the value that was sent.
  if (!judged.ok) return c.json({ error: "custom_domain_invalid", problem: judged.problem }, 422);
  const answer = await storeDomain(c, db, eventId, actor, judged.domain);
  if (answer.ok) onChanged();
  return answer;
}
