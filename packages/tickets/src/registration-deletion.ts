import type { Prisma } from "@admitto/db";
import { writeAdminAuditLog } from "./admin-audit.js";
import { eraseAttendees, type EraseAttendeesResult } from "./erase-attendees.js";
import { writeBulkActionLog } from "./ops-audit.js";
import type { StaffActor } from "./registration-decisions.js";
import { MAX_REGISTRATION_BULK_IDS, registrationListWhere, type RegistrationListFilter } from "./registration-list.js";
import { lockRegistrationQueue, lockRegistrationsForUpdate, type LockedRegistration } from "./registration-lock.js";
import { lockOpenAttendeeJobs } from "./stop-open-jobs.js";

/**
 * What staff chose to delete: registrations by id (one is a list of one), or every registration that a filter selects.
 * A filter comes with the number of registrations the staff member was shown for it (`expected`), and is deleted only
 * if exactly that many still match.
 */
export type DeleteRegistrationsTarget =
  | { kind: "ids"; ids: readonly string[] }
  | { kind: "filter"; filter: RegistrationListFilter; expected: number; now?: Date };

export type DeleteRegistrationsParams = {
  eventId: string;
  target: DeleteRegistrationsTarget;
  /** The staff member: the entries of the activity log and of the central audit log name them, and nothing else. */
  actor: StaffActor;
  /** The most registrations a filter may select. The default is the cap of the other registration bulk routes. */
  maxRegistrations?: number;
  /**
   * The most accepted registrations one call may take, each of which erases an attendee. The default is the cap of the
   * other bulk routes; a caller whose erasure also deletes wallet passes at a provider passes less.
   */
  maxAccepted?: number;
};

/** One registration that was deleted; `attendeeId` is the attendee erased with it, for an accepted one. */
export type DeletedRegistration = { id: string; attendeeId: string | null };

/**
 * - `done`: what was deleted. `goneIds` are the ids asked for that are no registration of the event (deleted or erased
 *   already, or never there: whoever they belong to, the answer is the same). A filter has none. `erased` is the erasure
 *   of the attendees of the accepted ones, for the caller to record and to follow up (the passes at the wallet provider
 *   are deleted after the commit); null when none was accepted.
 * - `count_changed`: the filter now selects another number of registrations than the staff member was shown. Nothing was
 *   deleted: they look at the list again.
 * - `too_many_registrations`, `too_many_accepted`: the selection is over a cap (the registrations a filter selects, the
 *   accepted ones among the registrations selected), which keeps one request to a size that finishes in time. Nothing
 *   was deleted.
 * - `filter_required`: a filter that selects everything is not a filter. Nothing was deleted.
 */
export type DeleteRegistrationsResult =
  | { status: "done"; deleted: DeletedRegistration[]; goneIds: string[]; erased: EraseAttendeesResult | null }
  | { status: "count_changed"; expected: number; matched: number }
  | { status: "too_many_registrations"; matched: number; limit: number }
  | { status: "too_many_accepted"; accepted: number; limit: number }
  | { status: "filter_required" };

type FilterTarget = Extract<DeleteRegistrationsTarget, { kind: "filter" }>;
type Refusal = Extract<DeleteRegistrationsResult, { status: "count_changed" | "too_many_registrations" }>;
/** The registrations a request names, locked, and the ids it asked for (none for a filter). */
type Selection = { rows: LockedRegistration[]; asked: string[] };

const noFilter = (filter: RegistrationListFilter): boolean =>
  !filter.status && !filter.olderThan && (filter.words?.length ?? 0) === 0;

const attendeeIdsOf = (rows: readonly DeletedRegistration[]): string[] =>
  rows.flatMap((row) => (row.attendeeId === null ? [] : [row.attendeeId]));

/**
 * The ids of the registrations a filter selects, by the rule of the list (registrationListWhere), counted again here
 * under the registration queue. The count must be the one the staff member saw and must fit the cap: nothing is
 * deleted that they did not see, and not more than a request is meant to carry.
 */
async function idsOfFilter(
  tx: Prisma.TransactionClient,
  eventId: string,
  target: FilterTarget,
  limit: number,
): Promise<string[] | Refusal> {
  const where = registrationListWhere(eventId, target.filter, target.now ?? new Date());
  const matched = await tx.registration.count({ where });
  if (matched !== target.expected) return { status: "count_changed", expected: target.expected, matched };
  if (matched > limit) return { status: "too_many_registrations", matched, limit };
  const rows = await tx.registration.findMany({
    where,
    select: { id: true },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    take: limit,
  });
  return rows.map((row) => row.id);
}

/** What the audit entries say about the filter: the closed values, and whether a search was used, never its words (a name or an address). */
function describeFilter(filter: RegistrationListFilter): Record<string, string | boolean> {
  return {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.olderThan ? { older_than: filter.olderThan } : {}),
    ...((filter.words?.length ?? 0) > 0 ? { search: true } : {}),
  };
}

/**
 * The entry of the event's activity log and the one of the central audit log, in the transaction of the deletion:
 * ids and counts only, never a name, an address, a search text or an answer. The ids let the deletion be repeated
 * after a restore from a backup (docs/dev/attendee-erasure.md), the attendee ids the same for the erasure.
 */
async function recordDeletion(
  tx: Prisma.TransactionClient,
  { eventId, actor, target }: { eventId: string; actor: StaffActor; target: DeleteRegistrationsTarget },
  deleted: readonly DeletedRegistration[],
): Promise<void> {
  const attendeeIds = attendeeIdsOf(deleted);
  const metadata = {
    count: deleted.length,
    registration_ids: deleted.map((row) => row.id),
    ...(attendeeIds.length > 0 ? { attendee_ids: attendeeIds } : {}),
    reason: "staff",
    by: target.kind,
    ...(target.kind === "filter" ? { filter: describeFilter(target.filter) } : {}),
  };
  await writeBulkActionLog(tx, { event_id: eventId, action_type: "registrations_deleted", audit: actor, metadata });
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { organization_id: true, title: true } });
  await writeAdminAuditLog(tx, {
    organizationId: event.organization_id,
    actorUserId: actor.operator,
    sessionId: actor.sessionId,
    ip: actor.ip,
    timezone: actor.timezone,
    actionType: "registrations_deleted",
    metadata: { event_id: eventId, event_title: event.title, ...metadata },
  });
}

/** The registrations the request names, locked in id order: by id, or by what its filter selects once the counts agree. */
async function lockSelection(tx: Prisma.TransactionClient, params: DeleteRegistrationsParams): Promise<Selection | Refusal> {
  const { eventId, target } = params;
  if (target.kind === "ids") {
    const asked = [...new Set(target.ids)];
    return { rows: await lockRegistrationsForUpdate(tx, eventId, asked), asked };
  }
  const ids = await idsOfFilter(tx, eventId, target, params.maxRegistrations ?? MAX_REGISTRATION_BULK_IDS);
  if (!Array.isArray(ids)) return ids;
  return { rows: await lockRegistrationsForUpdate(tx, eventId, ids), asked: [] };
}

/**
 * Deletes guest registrations for staff (D-F4: a person asks an organiser to delete their data; D-F5: the organiser
 * clears out the rejected and the old ones by hand), in the caller's transaction, so that the deletion, the erasure it
 * may entail and the audit entries commit together or not at all. Allowed on an archived event, like an erasure: a
 * request to delete data does not expire with the event. Nothing is mailed.
 *
 * What happens to each registration, whatever its state:
 * - One without an attendee (waiting for the address, for a decision, on the waiting list, or rejected) is deleted with
 *   its queued mail. The guest can register again with the address then (D-B8), and the link they were mailed
 *   finds nothing.
 * - An accepted one is an attendee as well (D-B13): the attendee is erased with `eraseAttendees`, the one path of every
 *   erasure (name and address become placeholders, the ticket stops working, the place is free again unless the person
 *   was admitted or the event is archived), and that deletes the registration. Nothing else erases an attendee here.
 *
 * Locks, in the order of docs/dev/attendee-erasure.md: the jobs of the event (an erasure takes them first, so this takes
 * them first even when nothing turns out to be accepted: it cannot know before it holds the registration queue, and taking
 * the jobs after it could deadlock with an erasure), the registration queue, the registration rows in id order, and the
 * attendees (in `eraseAttendees`). No capacity lock: a deletion takes no seat, and a seat that it frees is freed under
 * the attendee's row, like in every erasure. The state of each row is read under the queue, so a decision (an
 * admission, a rejection) or an erasure that came first is seen: an admission that made an attendee has made this an
 * accepted registration, a deletion that came first is `gone`.
 *
 * A filter is counted again under the queue: it must select exactly `expected` registrations, and no more than
 * `maxRegistrations`, or nothing is deleted. A filter that selects everything is refused.
 */
export async function deleteRegistrations(
  tx: Prisma.TransactionClient,
  params: DeleteRegistrationsParams,
): Promise<DeleteRegistrationsResult> {
  const { eventId, target, actor } = params;
  if (target.kind === "filter" && noFilter(target.filter)) return { status: "filter_required" };

  await lockOpenAttendeeJobs(tx, eventId);
  await lockRegistrationQueue(tx, eventId);

  const selection = await lockSelection(tx, params);
  if ("status" in selection) return selection;
  const deleted = selection.rows.map((row): DeletedRegistration => ({ id: row.id, attendeeId: row.attendee_id }));
  const attendeeIds = attendeeIdsOf(deleted);
  const acceptedLimit = params.maxAccepted ?? MAX_REGISTRATION_BULK_IDS;
  if (attendeeIds.length > acceptedLimit) {
    return { status: "too_many_accepted", accepted: attendeeIds.length, limit: acceptedLimit };
  }

  // A registration that carries an attendee is deleted only by the erasure of that attendee (the condition makes
  // this statement unable to leave an attendee behind).
  const plain = deleted.filter((row) => row.attendeeId === null).map((row) => row.id);
  if (plain.length > 0) {
    await tx.registration.deleteMany({ where: { event_id: eventId, id: { in: plain }, attendee_id: null } });
  }
  const erased = attendeeIds.length > 0 ? await eraseAttendees(tx, { eventId, attendeeIds }) : null;

  if (deleted.length > 0) await recordDeletion(tx, { eventId, actor, target }, deleted);
  const found = new Set(deleted.map((row) => row.id));
  return { status: "done", deleted, goneIds: selection.asked.filter((id) => !found.has(id)), erased };
}
