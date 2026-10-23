/**
 * deleteRegistrations against a real, fully migrated database (family C of the plan): what staff delete, one
 * registration, a selection or what a filter selects, in every state; that an accepted registration erases its
 * attendee through the one erasure (the ticket stops working, the place is free, an admitted guest keeps theirs) and
 * that an archived event allows it; that a filter takes exactly what the staff member was shown, and no more than a
 * request may carry; the audit entries (ids and counts, never a name, an address or a search text); and the deletion
 * racing a decision, an erasure, a writer that holds the capacity lock, a guest, and another deletion.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { Prisma } from "@admitto/db/client";
import { acquireEventCapacityLock } from "../src/event-capacity.js";
import { countSeatsInUse } from "../src/event-seats.js";
import { eraseAttendees } from "../src/erase-attendees.js";
import { admitRegistrations } from "../src/registration-decisions.js";
import {
  deleteRegistrations,
  type DeleteRegistrationsParams,
  type DeleteRegistrationsResult,
  type DeleteRegistrationsTarget,
} from "../src/registration-deletion.js";
import { registrationListWhere, type RegistrationListFilter } from "../src/registration-list.js";
import { confirmRegistrationAddress, placeRegistration } from "../src/registration-placement.js";
import {
  createMigratedDb,
  failingAfterWork,
  fixtures,
  holdTransaction,
  pauseAfterSeatCount,
  waitUntilWaitingForAdvisoryLock,
  waitUntilWaitingForRegistrationQueue,
  type EventOptions,
  type MigratedDb,
} from "./registration-fixtures.js";

// Tests that make transactions wait for each other are bound by waits, not by work: a slow machine needs more than 5 s.
vi.setConfig({ testTimeout: 30_000 });

let migrated: MigratedDb;
let db: PrismaClient;
let make: ReturnType<typeof fixtures>;

beforeAll(() => {
  migrated = createMigratedDb();
  db = migrated.db;
  make = fixtures(db);
}, 60_000);
afterAll(async () => {
  await migrated?.drop();
});

const actor = { operator: "staff-user-1", sessionId: "session-1", timezone: "Europe/Warsaw", ip: "203.0.113.7" };
type Done = Extract<DeleteRegistrationsResult, { status: "done" }>;

const removeIn = (
  client: PrismaClient,
  eventId: string,
  target: DeleteRegistrationsTarget,
  extra: Partial<DeleteRegistrationsParams> = {},
) => client.$transaction((tx) => deleteRegistrations(tx, { eventId, target, actor, ...extra }), { timeout: 30_000 });
const remove = (eventId: string, ids: string[], extra: Partial<DeleteRegistrationsParams> = {}) =>
  removeIn(db, eventId, { kind: "ids", ids }, extra);
const removeByFilter = (
  eventId: string,
  filter: RegistrationListFilter,
  expected: number,
  extra: Partial<DeleteRegistrationsParams> = {},
  now?: Date,
) => removeIn(db, eventId, { kind: "filter", filter, expected, ...(now ? { now } : {}) }, extra);

const done = (result: DeleteRegistrationsResult): Done => {
  expect(result.status).toBe("done");
  return result as Done;
};

/** A registration of the state, with one mail queued for it (the one the state would have queued). */
async function queued(eventId: string, status: string, options: { email?: string; createdAt?: Date } = {}) {
  const attendee = status === "accepted" ? await make.attendee(eventId) : null;
  const row = await make.registration(eventId, { status, attendeeId: attendee?.id, ...options });
  await db.registrationMail.create({
    data: { registration_id: row.id, event_id: eventId, template_name: status === "accepted" ? "ticket" : "registration-received" },
  });
  return { ...row, attendeeId: attendee?.id ?? null };
}

const registrationExists = async (id: string) => (await db.registration.count({ where: { id } })) === 1;
const auditOf = (eventId: string) => db.attendeeActionLog.findMany({ where: { event_id: eventId, action_type: "registrations_deleted" } });
const centralAuditOf = (eventId: string) =>
  db.adminAuditLog.findMany({ where: { action_type: "registrations_deleted", metadata: { path: ["event_id"], equals: eventId } } });

describe("deleteRegistrations: a registration that has no attendee", () => {
  it.each(["awaiting_email", "pending", "waitlist", "rejected"])(
    "deletes the %s one with its queued mail and nothing else of the event",
    async (status) => {
      const eventId = await make.event({ mode: "approval" });
      const target = await queued(eventId, status);
      const others = await Promise.all(["pending", "rejected"].map((other) => queued(eventId, other === status ? "waitlist" : other)));
      const otherEvent = await make.event({ mode: "approval" });
      const elsewhere = await queued(otherEvent, status);
      const before = await make.counts(eventId);

      const result = done(await remove(eventId, [target.id]));

      expect(result.deleted).toEqual([{ id: target.id, attendeeId: null }]);
      expect(result.goneIds).toEqual([]);
      expect(result.erased).toBeNull();
      expect(await registrationExists(target.id)).toBe(false);
      expect(await db.registrationMail.count({ where: { registration_id: target.id } })).toBe(0);
      for (const kept of [...others, elsewhere]) expect(await registrationExists(kept.id)).toBe(true);
      const after = await make.counts(eventId);
      expect(after.registrations).toBe(before.registrations - 1);
      expect(after.mails).toBe(before.mails - 1);
      expect(after.attendees).toBe(before.attendees);
      expect(await db.registrationMail.count({ where: { event_id: otherEvent } })).toBe(1);
    },
  );

  it("deletes a selection of every state in one request, and names the ids that are no registration of the event", async () => {
    const eventId = await make.event({ mode: "approval" });
    const rows = await Promise.all(["awaiting_email", "pending", "waitlist", "rejected"].map((status) => queued(eventId, status)));
    const otherEvent = await make.event({ mode: "approval" });
    const foreign = await queued(otherEvent, "pending");

    const result = done(await remove(eventId, [...rows.map((row) => row.id), foreign.id, "does-not-exist", rows[0]!.id, "does-not-exist"]));

    expect(result.deleted.map((row) => row.id).sort()).toEqual(rows.map((row) => row.id).sort());
    // Whoever the id belongs to, the answer is the same, and a repeated id is asked for once.
    expect([...result.goneIds].sort()).toEqual([foreign.id, "does-not-exist"].sort());
    expect(await registrationExists(foreign.id)).toBe(true);
    expect((await make.counts(eventId)).registrations).toBe(0);
  });

  it("changes nothing for an empty selection and for ids that are not there, and writes no audit entry", async () => {
    const eventId = await make.event({ mode: "approval" });
    const kept = await queued(eventId, "pending");

    expect(done(await remove(eventId, []))).toEqual({ status: "done", deleted: [], goneIds: [], erased: null });
    expect(done(await remove(eventId, ["nobody"]))).toEqual({ status: "done", deleted: [], goneIds: ["nobody"], erased: null });

    expect(await registrationExists(kept.id)).toBe(true);
    expect(await auditOf(eventId)).toEqual([]);
    expect(await centralAuditOf(eventId)).toEqual([]);
  });

  it("answers gone for what a deletion has deleted already", async () => {
    const eventId = await make.event({ mode: "approval" });
    const row = await queued(eventId, "pending");

    expect(done(await remove(eventId, [row.id])).deleted).toHaveLength(1);
    expect(done(await remove(eventId, [row.id]))).toMatchObject({ deleted: [], goneIds: [row.id] });
    expect(await auditOf(eventId)).toHaveLength(1);
  });

  it("lets the guest register again with the address of a rejected registration that staff deleted (D-B8)", async () => {
    const eventId = await make.event({ mode: "approval", verify: false });
    const guest = make.registrant();
    const rejected = await make.registration(eventId, { status: "rejected", email: guest.email });
    expect(await placeRegistration(db, { eventId, method: "link", registrant: guest })).toEqual({ outcome: "received" });
    expect((await make.registrationByEmail(eventId, guest.email))?.id).toBe(rejected.id);

    await remove(eventId, [rejected.id]);

    expect(await placeRegistration(db, { eventId, method: "link", registrant: guest })).toEqual({ outcome: "received" });
    const again = await make.registrationByEmail(eventId, guest.email);
    expect(again).toMatchObject({ status: "pending" });
    expect(again?.id).not.toBe(rejected.id);
  });

  it("makes the link of a guest who has not confirmed the address find nothing", async () => {
    const eventId = await make.event({ verify: true });
    const waiting = await queued(eventId, "awaiting_email");

    await remove(eventId, [waiting.id]);

    expect(await confirmRegistrationAddress(db, { eventId, registrationId: waiting.id })).toEqual({ outcome: "gone" });
  });

  it("deletes a registration whose companion and answers it holds, whole (no column is left behind)", async () => {
    const eventId = await make.event({ mode: "approval" });
    const row = await make.registration(eventId, {
      status: "pending",
      companions: [{ name: "Companion Example", custom_data: { diet: "vegan" } }],
      customData: { diet: "vegan" },
      company: "Example Corp",
    });

    await remove(eventId, [row.id]);

    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);
  });
});

describe("deleteRegistrations: an accepted registration is an attendee", () => {
  /** An accepted guest, as an admission makes them, with a ticket that works. */
  async function acceptedGuest(options: EventOptions = {}, attendee: { admitted?: boolean } = {}) {
    const eventId = await make.event({ mode: "approval", capacity: 5, ...options });
    const person = await make.attendee(eventId, { email: make.address("accepted") });
    await db.attendee.update({
      where: { id: person.id },
      data: {
        token_hash: `token-hash-${person.id}`,
        token_enc: `token-enc-${person.id}`,
        qr_payload: `qr-${person.id}`,
        ...(attendee.admitted ? { admitted_at: new Date() } : {}),
      },
    });
    const row = await make.registration(eventId, { status: "accepted", attendeeId: person.id, email: person.email });
    await db.registrationMail.create({ data: { registration_id: row.id, event_id: eventId, template_name: "ticket" } });
    return { eventId, person, row };
  }

  it("erases the attendee with the one erasure: the ticket stops working and the place is free", async () => {
    const { eventId, person, row } = await acceptedGuest();
    expect(await countSeatsInUse(db, eventId)).toBe(1);

    const result = done(await remove(eventId, [row.id]));

    expect(result.deleted).toEqual([{ id: row.id, attendeeId: person.id }]);
    expect(result.erased).toMatchObject({ erasedIds: [person.id], alreadyErasedIds: [], notFoundIds: [] });
    expect(result.erased?.counts.registrations).toBe(1);
    expect(await registrationExists(row.id)).toBe(false);
    expect(await db.registrationMail.count({ where: { registration_id: row.id } })).toBe(0);
    const erased = await db.attendee.findUniqueOrThrow({ where: { id: person.id } });
    expect(erased).toMatchObject({
      name: "Erased attendee",
      email: `erased-${person.id}@erased.invalid`,
      status: "cancelled",
      token_hash: null,
      token_enc: null,
      qr_payload: null,
    });
    expect(erased.erased_at).not.toBeNull();
    expect(await countSeatsInUse(db, eventId)).toBe(0);
  });

  it("frees the place for the next guest of a full event", async () => {
    const { eventId, row } = await acceptedGuest({ capacity: 1 });
    const waiting = await make.registration(eventId, { status: "waitlist" });
    expect(await admitRegistrations(db, { eventId, ids: [waiting.id], actor })).toEqual({ status: "not_enough_seats", free: 0, needed: 1 });

    await remove(eventId, [row.id]);

    expect(await admitRegistrations(db, { eventId, ids: [waiting.id], actor })).toMatchObject({ status: "done" });
    expect(await countSeatsInUse(db, eventId)).toBe(1);
  });

  it("leaves a guest who was admitted at the door where they were, and erases their data (the place is theirs)", async () => {
    const { eventId, person, row } = await acceptedGuest({}, { admitted: true });

    await remove(eventId, [row.id]);

    const erased = await db.attendee.findUniqueOrThrow({ where: { id: person.id } });
    expect(erased).toMatchObject({ name: "Erased attendee", status: "registered", token_hash: null });
    expect(erased.admitted_at).not.toBeNull();
    expect(await registrationExists(row.id)).toBe(false);
    expect(await countSeatsInUse(db, eventId)).toBe(1);
  });

  it("works on an archived event: the data goes, the numbers of the event stay as they were", async () => {
    const { eventId, person, row } = await acceptedGuest({ archived: true });
    const pending = await queued(eventId, "pending");

    const result = done(await remove(eventId, [row.id, pending.id]));

    expect(result.deleted).toHaveLength(2);
    const erased = await db.attendee.findUniqueOrThrow({ where: { id: person.id } });
    expect(erased).toMatchObject({ name: "Erased attendee", status: "registered", token_hash: null });
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(await countSeatsInUse(db, eventId)).toBe(1);
  });

  it("erases the attendees and deletes the others when a selection holds both, and audits both", async () => {
    const { eventId, person, row } = await acceptedGuest();
    const pending = await queued(eventId, "pending");
    const rejected = await queued(eventId, "rejected");

    const result = done(await remove(eventId, [pending.id, row.id, rejected.id]));

    expect(result.deleted.map((entry) => entry.id).sort()).toEqual([pending.id, row.id, rejected.id].sort());
    expect(result.erased?.erasedIds).toEqual([person.id]);
    const [entry] = await auditOf(eventId);
    expect(entry?.metadata).toEqual({
      count: 3,
      registration_ids: result.deleted.map((deleted) => deleted.id),
      attendee_ids: [person.id],
      reason: "staff",
      by: "ids",
    });
  });

  it("erases only the attendee of the registration it deletes", async () => {
    const { eventId, person, row } = await acceptedGuest();
    const other = await make.attendee(eventId);
    const otherRegistration = await make.registration(eventId, { status: "accepted", attendeeId: other.id, email: other.email });

    await remove(eventId, [row.id]);

    expect((await db.attendee.findUniqueOrThrow({ where: { id: person.id } })).erased_at).not.toBeNull();
    expect((await db.attendee.findUniqueOrThrow({ where: { id: other.id } })).erased_at).toBeNull();
    expect(await registrationExists(otherRegistration.id)).toBe(true);
  });

  it("stops an export or an import that is waiting or running, as every erasure does", async () => {
    const { eventId, row } = await acceptedGuest();
    const event = await db.event.findUniqueOrThrow({ where: { id: eventId } });
    const job = await db.adminJob.create({ data: { type: "export", organization_id: event.organization_id, event_id: eventId, status: "pending" } });

    await remove(eventId, [row.id]);

    expect((await db.adminJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("failed");
  });

  it("keeps the jobs of the event as they were when only registrations without an attendee are deleted", async () => {
    const eventId = await make.event({ mode: "approval" });
    const row = await make.registration(eventId, { status: "pending" });
    const event = await db.event.findUniqueOrThrow({ where: { id: eventId } });
    const job = await db.adminJob.create({ data: { type: "export", organization_id: event.organization_id, event_id: eventId, status: "pending" } });

    await remove(eventId, [row.id]);

    expect((await db.adminJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("pending");
  });
});

describe("deleteRegistrations: a filter takes exactly what the staff member was shown", () => {
  const HOUR_MS = 3_600_000;
  const NOW = new Date("2026-10-23T12:00:00Z");

  /** The registrations the list would show for the filter (the rule the deletion reuses). */
  const listed = async (eventId: string, filter: RegistrationListFilter) =>
    (await db.registration.findMany({ where: registrationListWhere(eventId, filter, NOW), select: { id: true } })).map((row) => row.id).sort();

  async function mixedEvent() {
    const eventId = await make.event({ mode: "approval" });
    const old = new Date(NOW.getTime() - 40 * 24 * HOUR_MS);
    const fresh = new Date(NOW.getTime() - 2 * HOUR_MS);
    const rows = {
      oldRejected: await queued(eventId, "rejected", { createdAt: old, email: make.address("annabel.old") }),
      oldRejected2: await queued(eventId, "rejected", { createdAt: old, email: make.address("bob.old") }),
      freshRejected: await queued(eventId, "rejected", { createdAt: fresh, email: make.address("annabel.fresh") }),
      oldPending: await queued(eventId, "pending", { createdAt: old }),
      oldWaiting: await queued(eventId, "awaiting_email", { createdAt: old }),
    };
    return { eventId, rows };
  }

  it("deletes the ones a status and an age select, as the list shows them, and no others", async () => {
    const { eventId, rows } = await mixedEvent();
    const filter: RegistrationListFilter = { status: "rejected", olderThan: "30d" };
    const shown = await listed(eventId, filter);
    expect(shown).toEqual([rows.oldRejected.id, rows.oldRejected2.id].sort());

    const result = done(await removeByFilter(eventId, filter, 2, {}, NOW));

    expect(result.deleted.map((row) => row.id).sort()).toEqual(shown);
    for (const kept of [rows.freshRejected, rows.oldPending, rows.oldWaiting]) expect(await registrationExists(kept.id)).toBe(true);
  });

  it("deletes the ones a search selects, whichever of the name and the address it matches", async () => {
    const { eventId, rows } = await mixedEvent();
    const filter: RegistrationListFilter = { words: ["annabel"] };
    expect(await listed(eventId, filter)).toEqual([rows.oldRejected.id, rows.freshRejected.id].sort());

    const result = done(await removeByFilter(eventId, filter, 2, {}, NOW));

    expect(result.deleted).toHaveLength(2);
    expect(await registrationExists(rows.oldRejected2.id)).toBe(true);
    // The audit entry says that a search was used, and not what it looked for.
    const [entry] = await auditOf(eventId);
    expect(entry?.metadata).toMatchObject({ by: "filter", filter: { search: true } });
    expect(JSON.stringify(entry)).not.toContain("annabel");
  });

  it("is limited to its event", async () => {
    const { eventId, rows } = await mixedEvent();
    const other = await mixedEvent();

    await removeByFilter(eventId, { status: "rejected" }, 3, {}, NOW);

    for (const kept of Object.values(other.rows)) expect(await registrationExists(kept.id)).toBe(true);
    expect(await registrationExists(rows.oldPending.id)).toBe(true);
  });

  it("deletes nothing when the filter selects another number than the staff member was shown, and says both numbers", async () => {
    const { eventId, rows } = await mixedEvent();
    const before = await make.counts(eventId);

    expect(await removeByFilter(eventId, { status: "rejected" }, 2, {}, NOW)).toEqual({ status: "count_changed", expected: 2, matched: 3 });
    expect(await removeByFilter(eventId, { status: "rejected" }, 4, {}, NOW)).toEqual({ status: "count_changed", expected: 4, matched: 3 });
    expect(await removeByFilter(eventId, { status: "rejected" }, 0, {}, NOW)).toEqual({ status: "count_changed", expected: 0, matched: 3 });

    expect(await make.counts(eventId)).toEqual(before);
    expect(await registrationExists(rows.oldRejected.id)).toBe(true);
  });

  it("notices a registration that joined the filter by growing old since the list was read", async () => {
    const eventId = await make.event({ mode: "approval" });
    const created = new Date("2026-10-20T10:00:00Z");
    const edge = await queued(eventId, "pending", { createdAt: created });
    // Older than 24 h means created before (now minus 24 h): at the time of the list the registration was 23 h old, two hours later 25 h.
    const whenListed = new Date(created.getTime() + 23 * HOUR_MS);
    const whenDeleted = new Date(created.getTime() + 25 * HOUR_MS);

    expect(await removeByFilter(eventId, { olderThan: "24h" }, 0, {}, whenListed)).toMatchObject({ status: "done", deleted: [] });
    expect(await removeByFilter(eventId, { olderThan: "24h" }, 0, {}, whenDeleted)).toEqual({ status: "count_changed", expected: 0, matched: 1 });
    expect(await registrationExists(edge.id)).toBe(true);
  });

  it("refuses a selection over the cap, with the number it matched, and deletes nothing", async () => {
    const { eventId } = await mixedEvent();
    const before = await make.counts(eventId);

    expect(await removeByFilter(eventId, { status: "rejected" }, 3, { maxRegistrations: 2 }, NOW)).toEqual({
      status: "too_many_registrations",
      matched: 3,
      limit: 2,
    });
    // The number is the one that was shown: the cap speaks only once the staff member saw what the filter selects.
    expect(await removeByFilter(eventId, { status: "rejected" }, 2, { maxRegistrations: 2 }, NOW)).toMatchObject({ status: "count_changed" });
    expect(await make.counts(eventId)).toEqual(before);
  });

  it("takes as many as the cap allows", async () => {
    const { eventId } = await mixedEvent();

    expect(done(await removeByFilter(eventId, { status: "rejected" }, 3, { maxRegistrations: 3 }, NOW)).deleted).toHaveLength(3);
  });

  it("refuses a filter that selects everything, even when the number is the one of the whole list", async () => {
    const { eventId } = await mixedEvent();
    const before = await make.counts(eventId);

    expect(await removeByFilter(eventId, {}, 5, {}, NOW)).toEqual({ status: "filter_required" });
    expect(await removeByFilter(eventId, { words: [] }, 5, {}, NOW)).toEqual({ status: "filter_required" });

    expect(await make.counts(eventId)).toEqual(before);
  });

  it("deletes nothing, and says so, when the filter selects nothing and none was expected", async () => {
    const eventId = await make.event({ mode: "approval" });
    await queued(eventId, "pending");

    expect(await removeByFilter(eventId, { status: "waitlist" }, 0, {}, NOW)).toEqual({ status: "done", deleted: [], goneIds: [], erased: null });
    expect(await auditOf(eventId)).toEqual([]);
  });

  /** Three accepted registrations and a pending one, all made a few minutes before NOW. */
  async function acceptedAndPending() {
    const eventId = await make.event({ mode: "approval", capacity: 10 });
    const recently = { createdAt: new Date(NOW.getTime() - 5 * 60_000) };
    const accepted = await Promise.all([queued(eventId, "accepted", recently), queued(eventId, "accepted", recently), queued(eventId, "accepted", recently)]);
    const pending = await queued(eventId, "pending", recently);
    return { eventId, accepted, pending };
  }
  /** Every registration of these tests has "Guest" as its first name, so this selects them all. */
  const wide: RegistrationListFilter = { words: ["guest"] };

  it("refuses more accepted registrations than the cap allows, and deletes and erases nothing", async () => {
    const { eventId } = await acceptedAndPending();
    const before = await make.counts(eventId);

    expect(await removeByFilter(eventId, wide, 4, { maxAccepted: 2 }, NOW)).toEqual({ status: "too_many_accepted", accepted: 3, limit: 2 });

    expect(await make.counts(eventId)).toEqual(before);
    expect(await db.attendee.count({ where: { event_id: eventId, erased_at: { not: null } } })).toBe(0);
  });

  it("takes as many accepted registrations as the cap allows, and erases their attendees", async () => {
    const { eventId, accepted, pending } = await acceptedAndPending();

    const result = done(await removeByFilter(eventId, wide, 4, { maxAccepted: 3 }, NOW));

    expect(result.erased?.erasedIds.sort()).toEqual(accepted.map((row) => row.attendeeId!).sort());
    expect(await registrationExists(pending.id)).toBe(false);
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(await countSeatsInUse(db, eventId)).toBe(0);
  });

  it("says in the audit entry which filter it used, in closed values", async () => {
    const { eventId } = await mixedEvent();

    await removeByFilter(eventId, { status: "rejected", olderThan: "30d" }, 2, {}, NOW);

    const [entry] = await auditOf(eventId);
    expect(entry?.metadata).toMatchObject({ by: "filter", reason: "staff", count: 2, filter: { status: "rejected", older_than: "30d" } });
  });
});

describe("deleteRegistrations: the audit entries", () => {
  it("writes one entry to the activity log of the event and one to the central log, with ids and counts only", async () => {
    const eventId = await make.event({ mode: "approval" });
    const person = await make.attendee(eventId, { email: make.address("person"), name: "Person Example" });
    const accepted = await make.registration(eventId, { status: "accepted", attendeeId: person.id, email: person.email });
    const pending = await make.registration(eventId, { status: "pending", email: make.address("pending") });

    await remove(eventId, [accepted.id, pending.id]);

    const [entry] = await auditOf(eventId);
    expect(await auditOf(eventId)).toHaveLength(1);
    expect(entry).toMatchObject({
      attendee_id: null,
      actor_user_id: actor.operator,
      session_id: actor.sessionId,
      client_timezone: actor.timezone,
      ip: actor.ip,
    });
    const [central] = await centralAuditOf(eventId);
    expect(await centralAuditOf(eventId)).toHaveLength(1);
    expect(central).toMatchObject({ actor_user_id: actor.operator, session_id: actor.sessionId, ip: actor.ip, actor_timezone: actor.timezone });
    const event = await db.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(central?.organization_id).toBe(event.organization_id);
    expect(central?.metadata).toMatchObject({ event_id: eventId, event_title: event.title, count: 2, attendee_ids: [person.id], reason: "staff", by: "ids" });
    for (const written of [entry, central]) {
      const text = JSON.stringify(written);
      for (const personal of [accepted.email, pending.email, accepted.first_name, accepted.last_name, "Person Example"]) {
        expect(text).not.toContain(personal);
      }
    }
  });

  it("writes none when the request deleted nothing", async () => {
    const eventId = await make.event({ mode: "approval" });
    const row = await make.registration(eventId, { status: "pending" });
    await remove(eventId, [row.id]);

    await remove(eventId, [row.id]);

    expect(await auditOf(eventId)).toHaveLength(1);
    expect(await centralAuditOf(eventId)).toHaveLength(1);
  });

  it("commits the deletion, the erasure and the audit together, or none of them", async () => {
    const eventId = await make.event({ mode: "approval" });
    const person = await make.attendee(eventId);
    const accepted = await make.registration(eventId, { status: "accepted", attendeeId: person.id, email: person.email });
    const pending = await queued(eventId, "pending");
    const before = await make.counts(eventId);

    await expect(removeIn(failingAfterWork(db), eventId, { kind: "ids", ids: [accepted.id, pending.id] })).rejects.toThrow("Synthetic rollback");

    expect(await make.counts(eventId)).toEqual(before);
    expect((await db.attendee.findUniqueOrThrow({ where: { id: person.id } })).erased_at).toBeNull();
    expect(await auditOf(eventId)).toEqual([]);
    expect(await centralAuditOf(eventId)).toEqual([]);
  });
});

describe("deleteRegistrations racing a decision, an erasure and the rest (family C)", () => {
  const nobodyIsLeft = async (eventId: string, attendeeId: string) => {
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(await db.registrationMail.count({ where: { event_id: eventId } })).toBe(0);
    expect((await db.attendee.findUniqueOrThrow({ where: { id: attendeeId } })).erased_at).not.toBeNull();
  };

  it("erases the attendee that an admission made, when the admission came first", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 5 });
    const row = await make.registration(eventId, { status: "pending" });
    const paused = pauseAfterSeatCount(migrated.connection(), eventId);
    const admitting = admitRegistrations(paused.client, { eventId, ids: [row.id], actor });
    await paused.reached;

    const deleting = remove(eventId, [row.id]);
    await waitUntilWaitingForRegistrationQueue(db, eventId);
    // The admission has not committed: the registration is still pending for a plain read.
    expect((await db.registration.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("pending");
    paused.release();

    expect(await admitting).toMatchObject({ status: "done", outcomes: [{ id: row.id, outcome: "accepted" }] });
    const result = done(await deleting);
    expect(result.deleted).toEqual([{ id: row.id, attendeeId: expect.any(String) }]);
    expect(result.erased?.erasedIds).toHaveLength(1);
    await nobodyIsLeft(eventId, result.deleted[0]!.attendeeId!);
    expect(await countSeatsInUse(db, eventId)).toBe(0);
  });

  it("makes an admission that comes after the deletion find the registration gone, and create nobody", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 5 });
    const row = await make.registration(eventId, { status: "pending" });
    const deleting = holdTransaction(migrated.connection(), (tx) =>
      deleteRegistrations(tx, { eventId, target: { kind: "ids", ids: [row.id] }, actor }),
    );
    await deleting.started;

    const admitting = admitRegistrations(db, { eventId, ids: [row.id], actor });
    await waitUntilWaitingForRegistrationQueue(db, eventId);
    await deleting.commit();

    expect(await admitting).toEqual({ status: "done", outcomes: [{ id: row.id, outcome: "gone" }] });
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(0);
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);
  });

  it("makes a deletion that comes after an erasure of the attendee find the registration gone", async () => {
    const eventId = await make.event({ mode: "approval" });
    const person = await make.attendee(eventId);
    const row = await make.registration(eventId, { status: "accepted", attendeeId: person.id, email: person.email });
    const erasing = holdTransaction(migrated.connection(), (tx) => eraseAttendees(tx, { eventId, attendeeIds: [person.id] }));
    await erasing.started;

    const deleting = remove(eventId, [row.id]);
    // The deletion takes the jobs of the event first, as the erasure did: it waits there, before any row.
    await waitUntilWaitingForAdvisoryLock(db, Prisma.sql`hashtext(${`attendee-job-queue:${eventId}`})`);
    await erasing.commit();

    expect(await deleting).toEqual({ status: "done", deleted: [], goneIds: [row.id], erased: null });
    await nobodyIsLeft(eventId, person.id);
  });

  it("makes an erasure that comes after the deletion find the attendee erased already, and erase nobody twice", async () => {
    const eventId = await make.event({ mode: "approval" });
    const person = await make.attendee(eventId);
    const row = await make.registration(eventId, { status: "accepted", attendeeId: person.id, email: person.email });
    const deleting = holdTransaction(migrated.connection(), (tx) =>
      deleteRegistrations(tx, { eventId, target: { kind: "ids", ids: [row.id] }, actor }),
    );
    await deleting.started;

    const erasing = db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [person.id] }));
    await waitUntilWaitingForAdvisoryLock(db, Prisma.sql`hashtext(${`attendee-job-queue:${eventId}`})`);
    await deleting.commit();

    expect(await erasing).toMatchObject({ erasedIds: [], alreadyErasedIds: [person.id] });
    await nobodyIsLeft(eventId, person.id);
  });

  it("does not wait for the capacity lock, as no erasure does: a writer that holds it, as an import does, does not stop it", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 5 });
    const person = await make.attendee(eventId);
    const row = await make.registration(eventId, { status: "accepted", attendeeId: person.id, email: person.email });
    const writer = holdTransaction(migrated.connection(), (tx) => acquireEventCapacityLock(tx, eventId));
    await writer.started;

    const result = done(await remove(eventId, [row.id]));
    await writer.commit();

    expect(result.deleted).toHaveLength(1);
    await nobodyIsLeft(eventId, person.id);
    expect(await countSeatsInUse(db, eventId)).toBe(0);
  });

  it("deletes once when two requests delete the same registrations at the same time, and the other finds them gone", async () => {
    const eventId = await make.event({ mode: "approval" });
    const person = await make.attendee(eventId);
    const accepted = await make.registration(eventId, { status: "accepted", attendeeId: person.id, email: person.email });
    const pending = await make.registration(eventId, { status: "pending" });
    const ids = [accepted.id, pending.id];

    const results = (await Promise.all([remove(eventId, ids), remove(eventId, [...ids].reverse())])).map((result) => done(result));

    expect(results.map((result) => result.deleted.length).sort()).toEqual([0, 2]);
    expect(results.map((result) => result.goneIds.length).sort()).toEqual([0, 2]);
    await nobodyIsLeft(eventId, person.id);
    expect(await auditOf(eventId)).toHaveLength(1);
  });

  it("holds the registration queue: a guest's request waits for it, answers busy, and writes nothing meanwhile", async () => {
    const eventId = await make.event({ verify: true });
    const target = await make.registration(eventId, { status: "pending" });
    const waiting = await make.registration(eventId, { status: "awaiting_email" });
    const deleting = holdTransaction(migrated.connection(), (tx) =>
      deleteRegistrations(tx, { eventId, target: { kind: "ids", ids: [target.id] }, actor }),
    );
    await deleting.started;

    const confirming = await confirmRegistrationAddress(db, { eventId, registrationId: waiting.id }, { retryMs: 250, pauseMs: [20, 40] });

    expect(confirming).toEqual({ outcome: "busy" });
    expect((await db.registration.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("awaiting_email");
    await deleting.commit();
    expect(await confirmRegistrationAddress(db, { eventId, registrationId: waiting.id })).toMatchObject({ outcome: "placed" });
  });

  it("neither deadlocks nor leaves a half-erased person when deletions, admissions and erasures of one event overlap", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 50 });
    const accepted = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const person = await make.attendee(eventId);
        return { person, row: await make.registration(eventId, { status: "accepted", attendeeId: person.id, email: person.email }) };
      }),
    );
    const pending = await Promise.all(Array.from({ length: 4 }, () => make.registration(eventId, { status: "pending" })));
    const allIds = [...accepted.map((entry) => entry.row.id), ...pending.map((row) => row.id)];

    const outcomes = await Promise.allSettled([
      remove(eventId, allIds),
      remove(eventId, [...allIds].reverse()),
      remove(eventId, allIds.slice(2, 6)),
      admitRegistrations(db, { eventId, ids: pending.map((row) => row.id), actor }),
      admitRegistrations(db, { eventId, ids: pending.slice(0, 2).map((row) => row.id), actor }),
      db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: accepted.slice(0, 2).map((entry) => entry.person.id) })),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(outcomes.map(() => "fulfilled"));
    // Whatever order they ran in, nothing of the registrations is left, and every person who was accepted at some
    // point is erased: no registration points at a live attendee, and no live attendee has lost their registration.
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(await db.registrationMail.count({ where: { event_id: eventId } })).toBe(0);
    expect(await db.attendee.count({ where: { event_id: eventId, erased_at: null } })).toBe(0);
  });
});
