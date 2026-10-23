import type { Prisma, PrismaClient } from "@admitto/db";
import type { AttendeeActionType } from "@admitto/db/status";
import { writeAdminAuditLog } from "./admin-audit.js";
import { runEventCapacityTransaction } from "./event-capacity.js";
import { writeBulkActionLog, type OpsAuditContext } from "./ops-audit.js";
import {
  createAttendeeFromRegistration,
  findAttendeeAddresses,
  loadAdmissionFields,
  writeAcceptanceLog,
} from "./registration-attendee.js";
import { lockRegistrationQueue, lockRegistrationsForUpdate, type LockedRegistration } from "./registration-lock.js";
import { enqueueMailsForMoment } from "./registration-mail-queue.js";
import { readFreeSeats, seatsNeeded } from "./registration-seats.js";

/** A staff member who decides: the operator is who `decided_by` names. The rest is what the activity log records. */
export type StaffActor = OpsAuditContext & { operator: string };

/**
 * The entry of the central admin audit log for what a staff member did to registrations, in the transaction of the
 * change: the type of the entry the event's activity log has for it (written by the caller), the event's id and title,
 * and the ids and counts of `metadata`, never a name, an address or an answer.
 */
export async function writeStaffRegistrationAudit(
  tx: Prisma.TransactionClient,
  { eventId, actor, actionType, metadata }: { eventId: string; actor: StaffActor; actionType: AttendeeActionType; metadata: Record<string, unknown> },
): Promise<void> {
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { organization_id: true, title: true } });
  await writeAdminAuditLog(tx, {
    organizationId: event.organization_id,
    actorUserId: actor.operator,
    sessionId: actor.sessionId,
    ip: actor.ip,
    timezone: actor.timezone,
    actionType,
    metadata: { event_id: eventId, event_title: event.title, ...metadata },
  });
}

/** A request of staff may wait for a lock as long as the statement timeout lets it. */
const DECISION_TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;

const noPrepare = (): Promise<void> => Promise.resolve();

type EventState = { archived_at: Date | null; capacity: number | null };

function readEventState(tx: Prisma.TransactionClient, eventId: string): Promise<EventState | null> {
  return tx.event.findUnique({ where: { id: eventId }, select: { archived_at: true, capacity: true } });
}

export type AdmitRegistrationsParams = {
  eventId: string;
  /** The registrations to admit, at most as many as one request may carry (the route limits it). */
  ids: readonly string[];
  actor: StaffActor;
  /** The moment of the decision; tests set it. */
  now?: Date;
};

/**
 * What became of one registration of an admission:
 * - `accepted`: an attendee was created (`attendeeId`) and the ticket mail queued;
 * - `already_decided`: it is accepted already (a double click, another organiser), nothing changed;
 * - `awaiting_email`: the guest has not confirmed the address; there is nothing to decide yet;
 * - `already_attendee`: an attendee holds the address (an import or a manual add came first, D-B14): the registration
 *   was deleted instead, because kept with that attendee's address it could be deleted later together with them (D-B13);
 * - `gone`: no such registration in the event (deleted, erased, or never there);
 * - `closed`: the event is archived or gone, and nothing is decided in it.
 */
export type AdmitOutcome =
  | { id: string; outcome: "accepted"; attendeeId: string }
  | { id: string; outcome: "already_decided" | "awaiting_email" | "already_attendee" | "gone" | "closed" };

/**
 * `not_enough_seats`: the guests the request would admit need more seats than the event has left (D-B4); nothing
 * was changed, not even for those that would have fitted. `free` and `needed` are the numbers for the message
 * ("free: 2, you selected 10"). An event without a limit never refuses.
 */
export type AdmitRegistrationsResult =
  | { status: "done"; outcomes: AdmitOutcome[] }
  | { status: "not_enough_seats"; free: number; needed: number };

const admittableStatuses: ReadonlySet<string> = new Set(["pending", "waitlist", "rejected"]);

type Sorted = {
  outcomes: Map<string, AdmitOutcome>;
  /** The registrations that would take seats. */
  candidates: LockedRegistration[];
  /** The registrations whose address an attendee holds. */
  held: string[];
};

/** Sorts the requested ids: what is decided for good without a seat, and what asks for one. */
function sortRequested(ids: readonly string[], rows: Map<string, LockedRegistration>, heldAddresses: Set<string>): Sorted {
  const sorted: Sorted = { outcomes: new Map(), candidates: [], held: [] };
  for (const id of ids) {
    const row = rows.get(id);
    if (!row) {
      sorted.outcomes.set(id, { id, outcome: "gone" });
    } else if (row.status === "accepted") {
      sorted.outcomes.set(id, { id, outcome: "already_decided" });
    } else if (!admittableStatuses.has(row.status)) {
      // Waiting for the guest to confirm the address: there is nothing to decide yet.
      sorted.outcomes.set(id, { id, outcome: "awaiting_email" });
    } else if (heldAddresses.has(row.email)) {
      sorted.held.push(id);
      sorted.outcomes.set(id, { id, outcome: "already_attendee" });
    } else {
      sorted.candidates.push(row);
    }
  }
  return sorted;
}

/** Deletes registrations whose address an attendee holds (with their mail), and records it (ids and a count) in the event's log and in the central one. */
async function deleteHeldRegistrations(
  tx: Prisma.TransactionClient,
  eventId: string,
  ids: readonly string[],
  actor: StaffActor,
): Promise<void> {
  if (ids.length === 0) return;
  await tx.registration.deleteMany({ where: { event_id: eventId, id: { in: [...ids] } } });
  const metadata = { count: ids.length, registration_ids: [...ids], reason: "already_attendee" };
  await writeBulkActionLog(tx, { event_id: eventId, action_type: "registrations_deleted", audit: actor, metadata });
  await writeStaffRegistrationAudit(tx, { eventId, actor, actionType: "registrations_deleted", metadata });
}

/** Creates the attendees of the candidates and links their registrations; the ones whose address was taken meanwhile are `held`. */
async function acceptCandidates(
  tx: Prisma.TransactionClient,
  { eventId, actor, now }: { eventId: string; actor: StaffActor; now: Date },
  sorted: Sorted,
): Promise<{ registrationId: string; attendeeId: string }[]> {
  const fields = await loadAdmissionFields(tx, eventId);
  const created = await Promise.all(
    sorted.candidates.map(async (row) => ({
      registrationId: row.id,
      attendeeId: await createAttendeeFromRegistration(tx, eventId, row, fields),
    })),
  );
  const accepted: { registrationId: string; attendeeId: string }[] = [];
  for (const { registrationId, attendeeId } of created) {
    if (attendeeId === null) {
      // An attendee with this exact address appeared since the check (an edit of an address takes none of our locks).
      sorted.held.push(registrationId);
      sorted.outcomes.set(registrationId, { id: registrationId, outcome: "already_attendee" });
    } else {
      accepted.push({ registrationId, attendeeId });
      sorted.outcomes.set(registrationId, { id: registrationId, outcome: "accepted", attendeeId });
    }
  }
  await Promise.all(
    accepted.map(({ registrationId, attendeeId }) =>
      tx.registration.update({
        where: { id: registrationId },
        data: { status: "accepted", attendee_id: attendeeId, decided_at: now, decided_by: actor.operator },
      }),
    ),
  );
  await enqueueMailsForMoment(tx, eventId, accepted.map((row) => row.registrationId), { to: "accepted" });
  return accepted;
}

async function admitInTransaction(
  tx: Prisma.TransactionClient,
  { eventId, ids, actor, now }: { eventId: string; ids: readonly string[]; actor: StaffActor; now: Date },
): Promise<AdmitRegistrationsResult> {
  // The registration queue, the first thing the work does (step 5 of the order in lockRegistrationQueue), then the
  // rows in id order (step 6), and only then the attendees that are inserted.
  await lockRegistrationQueue(tx, eventId);
  const event = await readEventState(tx, eventId);
  if (event?.archived_at !== null) {
    return { status: "done", outcomes: ids.map((id) => ({ id, outcome: "closed" })) };
  }
  const rows = new Map((await lockRegistrationsForUpdate(tx, eventId, ids)).map((row) => [row.id, row]));
  const heldAddresses = await findAttendeeAddresses(tx, eventId, [...rows.values()].map((row) => row.email));
  const sorted = sortRequested(ids, rows, heldAddresses);
  const needed = sorted.candidates.reduce((sum, row) => sum + seatsNeeded(row.companions), 0);
  // Counted after the capacity lock and before anything is written: a request that does not fit changes nothing.
  const free = await readFreeSeats(tx, eventId, event.capacity);
  if (needed > free) return { status: "not_enough_seats", free, needed };
  const accepted = await acceptCandidates(tx, { eventId, actor, now }, sorted);
  if (accepted.length > 0) {
    await writeAcceptanceLog(tx, eventId, accepted, actor, false);
    await writeStaffRegistrationAudit(tx, {
      eventId,
      actor,
      actionType: "registration_accepted",
      metadata: {
        count: accepted.length,
        registration_ids: accepted.map((row) => row.registrationId),
        attendee_ids: accepted.map((row) => row.attendeeId),
      },
    });
  }
  await deleteHeldRegistrations(tx, eventId, sorted.held, actor);
  return { status: "done", outcomes: ids.flatMap((id) => sorted.outcomes.get(id) ?? []) };
}

/**
 * An organiser admits registrations that are `pending`, on the `waitlist` or `rejected` (D-B8): each becomes an
 * attendee (createAttendeeFromRegistration), its registration `accepted` and linked to it, with `decided_at` and
 * `decided_by`, and the ticket mail is queued in the same transaction (the worker turns the row into the usual
 * ticket send; nothing is mailed from here). Nothing is promoted automatically, ever (D-B5): this is the only way a
 * guest on the waiting list gets a seat.
 *
 * Locks, in the order of docs/dev/attendee-erasure.md: the capacity lock (runEventCapacityTransaction, which waits
 * for it: staff may wait), the registration queue at the start of the work, the registration rows in id order, then
 * the attendees that are inserted. State and seats are read again under them, so a double click, another
 * organiser, an import, an erasure or a deletion that came first is seen: a row that is gone is `gone`, one decided
 * meanwhile is `already_decided`, and the seats are counted as they are (countSeatsInUse). Together the guests of
 * the request must fit (D-B4): when they do not, `not_enough_seats` with the numbers and nothing is changed.
 *
 * An erasure that commits first deletes the registration of the person together with their address, so it is
 * `gone` here and nobody is created from it; one that comes after finds the attendee made here and erases them.
 */
export async function admitRegistrations(db: PrismaClient, params: AdmitRegistrationsParams): Promise<AdmitRegistrationsResult> {
  const ids = [...new Set(params.ids)];
  if (ids.length === 0) return { status: "done", outcomes: [] };
  const now = params.now ?? new Date();
  return runEventCapacityTransaction(db, params.eventId, noPrepare, (tx) =>
    admitInTransaction(tx, { eventId: params.eventId, ids, actor: params.actor, now }),
  );
}

export type RejectRegistrationsParams = {
  eventId: string;
  ids: readonly string[];
  actor: StaffActor;
  /** Mail the guest that they were turned down (`registration-rejected`). Off by default (D-B8). */
  notify?: boolean;
  now?: Date;
};

/** As AdmitOutcome: `rejected` here, and `already_decided` for one that is accepted or rejected already. */
export type RejectOutcome = {
  id: string;
  outcome: "rejected" | "already_decided" | "awaiting_email" | "gone" | "closed";
};

export type RejectRegistrationsResult = { outcomes: RejectOutcome[] };

const rejectableStatuses: ReadonlySet<string> = new Set(["pending", "waitlist"]);

function classifyForRejection(row: LockedRegistration | undefined): RejectOutcome["outcome"] {
  if (!row) return "gone";
  if (row.status === "awaiting_email") return "awaiting_email";
  return rejectableStatuses.has(row.status) ? "rejected" : "already_decided";
}

async function rejectInTransaction(
  tx: Prisma.TransactionClient,
  { eventId, ids, actor, notify, now }: { eventId: string; ids: readonly string[]; actor: StaffActor; notify: boolean; now: Date },
): Promise<RejectRegistrationsResult> {
  await lockRegistrationQueue(tx, eventId);
  const event = await readEventState(tx, eventId);
  if (event?.archived_at !== null) {
    return { outcomes: ids.map((id) => ({ id, outcome: "closed" })) };
  }
  const rows = new Map((await lockRegistrationsForUpdate(tx, eventId, ids)).map((row) => [row.id, row]));
  const outcomes = ids.map((id): RejectOutcome => ({ id, outcome: classifyForRejection(rows.get(id)) }));
  const rejected = outcomes.filter((row) => row.outcome === "rejected").map((row) => row.id);
  if (rejected.length === 0) return { outcomes };
  await tx.registration.updateMany({
    where: { id: { in: rejected }, event_id: eventId, status: { in: [...rejectableStatuses] } },
    data: { status: "rejected", decided_at: now, decided_by: actor.operator },
  });
  await enqueueMailsForMoment(tx, eventId, rejected, { to: "rejected", notify });
  const metadata = { count: rejected.length, registration_ids: rejected, notify };
  await writeBulkActionLog(tx, { event_id: eventId, action_type: "registration_rejected", audit: actor, metadata });
  await writeStaffRegistrationAudit(tx, { eventId, actor, actionType: "registration_rejected", metadata });
  return { outcomes };
}

/**
 * An organiser turns down registrations that are `pending` or on the `waitlist` (D-B8). The guest can be mailed
 * (`notify`, off by default), in the same transaction. The registration stays, `rejected`: the guest cannot
 * register again with the address until staff delete it, and staff can still admit it later.
 *
 * Takes the registration queue and the rows, not the capacity lock: nothing here takes or frees a seat.
 */
export async function rejectRegistrations(
  db: PrismaClient,
  params: RejectRegistrationsParams,
): Promise<RejectRegistrationsResult> {
  const ids = [...new Set(params.ids)];
  if (ids.length === 0) return { outcomes: [] };
  const now = params.now ?? new Date();
  return await db.$transaction(
    (tx) => rejectInTransaction(tx, { eventId: params.eventId, ids, actor: params.actor, notify: params.notify ?? false, now }),
    DECISION_TRANSACTION_OPTIONS,
  );
}
