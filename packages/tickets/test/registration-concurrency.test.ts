/**
 * The registration writers racing each other, an import-like writer that holds the capacity lock, and an erasure of the
 * same address, against a real database (family C of the plan). What is claimed: seats are never counted twice, one
 * decision wins and the other sees it, an erasure and an admission of one address never deadlock and never bring
 * the erased person back, and a guest's request neither waits for a long lock with a pooled connection nor
 * leaves the panel without one.
 */
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import type { Prisma } from "@admitto/db/client";
import { acquireEventCapacityLock, EventLockBusyError, runEventCapacityTransaction, tryAcquireEventCapacityLock } from "../src/event-capacity.js";
import { countSeatsInUse } from "../src/event-seats.js";
import { eraseAttendees } from "../src/erase-attendees.js";
import { type PublicWriteOptions } from "../src/public-write-gate.js";
import { admitRegistrations, rejectRegistrations } from "../src/registration-decisions.js";
import { lockRegistrationQueue } from "../src/registration-lock.js";
import {
  CONFIRMATION_RESEND_COOLDOWN_MS,
  confirmRegistrationAddress,
  placeRegistration,
  type PlacementOptions,
  type RegistrantSubmission,
} from "../src/registration-placement.js";
import {
  createMigratedDb,
  fixtures,
  holdTransaction,
  lockWaiters,
  pauseAfterSeatCount,
  waitUntilWaitingForCapacityLock,
  waitUntilWaitingForRegistrationQueue,
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

const RECEIVED = { outcome: "received" };
const actor = { operator: "staff-user-1" };
const admit = (eventId: string, ids: string[], client = db) => admitRegistrations(client, { eventId, ids, actor });
/** A guest's write that may wait as long as a test needs, unless the test is about how long it waits. */
const patient: PublicWriteOptions = { retryMs: 20_000, permitWaitMs: 20_000 };
const place = (eventId: string, registrant: RegistrantSubmission, options: PlacementOptions = patient, client = db) =>
  placeRegistration(client, { eventId, method: "link", registrant }, options);
const noPrepare = () => Promise.resolve();

/** What an import or a manual add does under the capacity lock: counts the seats, and takes one when there is one. */
async function takeASeat(tx: Prisma.TransactionClient, eventId: string, capacity: number) {
  if ((await countSeatsInUse(tx, eventId)) >= capacity) return "event_full";
  await tx.attendee.create({ data: { event_id: eventId, email: make.address("seat"), name: "Seat taker" } });
  return "created";
}

describe("the writers of registrations race for seats", () => {
  it("gives the last seat to one of two guests, and the waiting list to the other (D-B16)", async () => {
    const eventId = await make.event({ capacity: 1, verify: false });
    const guests = [make.registrant(), make.registrant()];

    const answers = await Promise.all(guests.map((guest) => place(eventId, guest)));

    expect(answers).toEqual([RECEIVED, RECEIVED]);
    const statuses = (await Promise.all(guests.map((guest) => make.registrationByEmail(eventId, guest.email)))).map((row) => row?.status);
    expect([...statuses].sort()).toEqual(["accepted", "waitlist"]);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("tells the second of two guests for the last seat that the event is full when there is no waiting list (D-B6)", async () => {
    const eventId = await make.event({ capacity: 1, verify: false, waitlist: false });

    const answers = await Promise.all([place(eventId, make.registrant()), place(eventId, make.registrant())]);

    expect(answers).toContainEqual(RECEIVED);
    expect(answers).toContainEqual({ outcome: "full" });
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("counts every seat once when many guests come at once", async () => {
    const eventId = await make.event({ capacity: 6, verify: false });
    const guests = Array.from({ length: 16 }, () => make.registrant());

    const answers = await Promise.all(guests.map((guest) => place(eventId, guest)));

    expect(answers.every((answer) => answer.outcome === "received")).toBe(true);
    expect(await db.registration.count({ where: { event_id: eventId, status: "accepted" } })).toBe(6);
    expect(await db.registration.count({ where: { event_id: eventId, status: "waitlist" } })).toBe(10);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(6);
    expect(await db.registrationMail.count({ where: { event_id: eventId, template_name: "ticket" } })).toBe(6);
    expect(await db.registrationMail.count({ where: { event_id: eventId, template_name: "registration-waitlist" } })).toBe(10);
  });

  it("stores one registration and queues its mail once when the same address is submitted at the same time", async () => {
    for (const verify of [true, false]) {
      const eventId = await make.event({ capacity: 5, verify });
      const guest = make.registrant();

      const answers = await Promise.all([place(eventId, guest), place(eventId, guest), place(eventId, guest)]);

      expect(answers).toEqual([RECEIVED, RECEIVED, RECEIVED]);
      expect(await db.registration.count({ where: { event_id: eventId } })).toBe(1);
      expect(await db.registrationMail.count({ where: { event_id: eventId } })).toBe(1);
      expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(verify ? 0 : 1);
    }
  });

  it("admits one registration once when two organisers click at the same time", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 5 });
    const row = await make.registration(eventId, { status: "pending" });

    const results = await Promise.all([admit(eventId, [row.id]), admit(eventId, [row.id])]);

    const outcomes = results.map((result) => (result.status === "done" ? result.outcomes[0]?.outcome : result.status)).sort();
    expect(outcomes).toEqual(["accepted", "already_decided"]);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
    expect(await make.templatesOf(row.id)).toEqual(["ticket"]);
    expect(await db.attendeeActionLog.count({ where: { event_id: eventId, action_type: "registration_accepted" } })).toBe(1);
  });

  it("lets only one of two registrations take the last seat", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 1 });
    const [a, b] = [await make.registration(eventId, { status: "pending" }), await make.registration(eventId, { status: "waitlist" })];

    const results = await Promise.all([admit(eventId, [a.id]), admit(eventId, [b.id])]);

    expect(results.map((result) => result.status).sort()).toEqual(["done", "not_enough_seats"]);
    expect(results.find((result) => result.status === "not_enough_seats")).toEqual({ status: "not_enough_seats", free: 0, needed: 1 });
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("lets only one of three overlapping admissions that each need all the seats take them", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 10 });
    const ids = [];
    for (let i = 0; i < 20; i += 1) ids.push((await make.registration(eventId, { status: "pending" })).id);

    const results = await Promise.all([
      admit(eventId, ids.slice(0, 10)),
      admit(eventId, ids.slice(10)),
      admit(eventId, ids.slice(5, 15)),
    ]);

    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(10);
    expect(results.filter((result) => result.status === "done")).toHaveLength(1);
    expect(await db.registration.count({ where: { event_id: eventId, status: "accepted" } })).toBe(10);
  });
});

describe("a writer that holds the capacity lock, as an import does", () => {
  const capacityHolder = (client: PrismaClient, eventId: string, capacity: number) =>
    holdTransaction(client, async (tx) => {
      await acquireEventCapacityLock(tx, eventId);
      return takeASeat(tx, eventId, capacity);
    });

  it("makes an admission wait for it, and then find the seat gone", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 1 });
    const row = await make.registration(eventId, { status: "pending" });
    const writer = capacityHolder(migrated.connection(), eventId, 1);
    expect(await writer.started).toBe("created");

    const admitting = admit(eventId, [row.id]);
    await waitUntilWaitingForCapacityLock(db, eventId);
    await writer.commit();

    expect(await admitting).toEqual({ status: "not_enough_seats", free: 0, needed: 1 });
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("makes a writer that comes after an admission wait for it, and then find the event full", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 1 });
    const row = await make.registration(eventId, { status: "pending" });
    const paused = pauseAfterSeatCount(migrated.connection(), eventId);
    const admitting = admit(eventId, [row.id], paused.client);
    await paused.reached;

    const writing = runEventCapacityTransaction(migrated.connection(), eventId, noPrepare, (tx) => takeASeat(tx, eventId, 1));
    await waitUntilWaitingForCapacityLock(db, eventId);
    paused.release();

    expect(await admitting).toMatchObject({ status: "done" });
    expect(await writing).toBe("event_full");
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("makes a guest's submission answer busy, whichever way it is sent, with nothing written, and succeed once the lock is free", async () => {
    for (const verify of [true, false]) {
      const eventId = await make.event({ capacity: 5, verify });
      const writer = capacityHolder(migrated.connection(), eventId, 5);
      await writer.started;
      const before = await make.counts(eventId);

      const answer = await place(eventId, make.registrant(), { retryMs: 250, pauseMs: [20, 40] });

      expect(answer).toEqual({ outcome: "busy" });
      expect(await make.counts(eventId)).toEqual(before);
      await writer.commit();
      expect(await place(eventId, make.registrant())).toEqual(RECEIVED);
    }
  });

  it("keeps trying for a guest while the writer works, and gives the seat the writer left, or not", async () => {
    const eventId = await make.event({ capacity: 1, verify: false });
    const writer = capacityHolder(migrated.connection(), eventId, 1);
    await writer.started;
    const guest = make.registrant();

    const placing = place(eventId, guest);
    await delay(150);
    await writer.commit();

    expect(await placing).toEqual(RECEIVED);
    expect((await make.registrationByEmail(eventId, guest.email))?.status).toBe("waitlist");
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("holds none of the pool for twenty guests at once: no connection waits for a lock, and the panel answers", async () => {
    const eventId = await make.event({ capacity: 50, verify: false });
    const writer = capacityHolder(migrated.connection(), eventId, 50);
    await writer.started;
    const monitor = migrated.connection();
    const guests = Array.from({ length: 20 }, () => make.registrant());

    // The default gate and the default pause, as the app has them; only the time to try is shortened.
    const placing = guests.map((guest) => place(eventId, guest, { retryMs: 1_200 }));
    const waiters: number[] = [];
    const panel: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      waiters.push(await lockWaiters(monitor));
      const started = performance.now();
      await db.event.count();
      panel.push(performance.now() - started);
      await delay(50);
    }
    const answers = await Promise.all(placing);

    expect(answers).toEqual(guests.map(() => ({ outcome: "busy" })));
    expect(Math.max(...waiters)).toBe(0);
    // No limit on how fast; only that the panel is never left waiting for a connection that a guest holds.
    expect(Math.max(...panel)).toBeLessThan(5_000);
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);

    await writer.commit();
    expect(await place(eventId, guests[0]!)).toEqual(RECEIVED);
  });

  it("shows what the try is for: a transaction that waits for the lock holds a connection while it waits", async () => {
    const eventId = await make.event({ capacity: 5 });
    const writer = capacityHolder(migrated.connection(), eventId, 5);
    await writer.started;
    const monitor = migrated.connection();

    const waiting = runEventCapacityTransaction(db, eventId, noPrepare, () => Promise.resolve("done"));
    await waitUntilWaitingForCapacityLock(db, eventId);
    expect(await lockWaiters(monitor)).toBeGreaterThan(0);
    await writer.commit();
    expect(await waiting).toBe("done");
  });
});

describe("runEventCapacityTransaction with tryLock, and the try of the lock", () => {
  it("takes the lock when it is free, runs the work and returns its result", async () => {
    const eventId = await make.event();
    const result = await runEventCapacityTransaction(
      db,
      eventId,
      noPrepare,
      async (tx) => (await tryAcquireEventCapacityLock(tx, eventId)) === true,
      undefined,
      { tryLock: true },
    );
    // The lock is already held by this transaction when the work asks again: Postgres counts the holds of one transaction.
    expect(result).toBe(true);
  });

  it("judges whether the event is over by the clock at the time it holds the locks, not at the time the call began", async () => {
    // Without hours, the event ends at midnight (UTC) after its day: open when the call begins, over when the lock is let go.
    const eventId = await make.event({ date: new Date("2027-03-10T12:00:00Z") });
    const holder = holdTransaction(migrated.connection(), (tx) => acquireEventCapacityLock(tx, eventId));
    await holder.started;
    // Only the date is faked: the pauses and the waits of the call run on the real timers.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-03-10T10:00:00Z") });
    try {
      const placing = placeRegistration(db, { eventId, method: "link", registrant: make.registrant() });
      await delay(300);
      vi.setSystemTime(new Date("2027-03-11T10:00:00Z"));
      await holder.commit();

      expect(await placing).toEqual({ outcome: "closed" });
    } finally {
      vi.useRealTimers();
    }
    expect(await make.counts(eventId)).toMatchObject({ registrations: 0, mails: 0 });
  });

  it("judges the link of an address by the clock at the time the confirmation holds the locks: a link that runs out while it waits is expired", async () => {
    const eventId = await make.event({ date: new Date("2027-06-01T12:00:00Z"), verify: true });
    // The link runs out one minute after the call began.
    const waiting = await make.registration(eventId, { status: "awaiting_email", expiresAt: new Date("2027-03-10T10:01:00Z") });
    const holder = holdTransaction(migrated.connection(), (tx) => acquireEventCapacityLock(tx, eventId));
    await holder.started;
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-03-10T10:00:00Z") });
    try {
      const confirming = confirmRegistrationAddress(db, { eventId, registrationId: waiting.id });
      await delay(300);
      vi.setSystemTime(new Date("2027-03-10T10:02:00Z"));
      await holder.commit();

      expect(await confirming).toEqual({ outcome: "expired" });
    } finally {
      vi.useRealTimers();
    }
    expect(await make.counts(eventId)).toMatchObject({ attendees: 0, mails: 0 });
    expect((await db.registration.findUnique({ where: { id: waiting.id } }))?.status).toBe("awaiting_email");
  });

  it("judges whether the event is over for a confirmation by the clock at the time it holds the locks", async () => {
    const eventId = await make.event({ date: new Date("2027-03-10T12:00:00Z"), verify: true });
    const waiting = await make.registration(eventId, { status: "awaiting_email", expiresAt: new Date("2027-03-20T10:00:00Z") });
    const holder = holdTransaction(migrated.connection(), (tx) => acquireEventCapacityLock(tx, eventId));
    await holder.started;
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-03-10T10:00:00Z") });
    try {
      const confirming = confirmRegistrationAddress(db, { eventId, registrationId: waiting.id });
      await delay(300);
      vi.setSystemTime(new Date("2027-03-11T10:00:00Z"));
      await holder.commit();

      expect(await confirming).toEqual({ outcome: "closed" });
    } finally {
      vi.useRealTimers();
    }
    expect(await make.counts(eventId)).toMatchObject({ attendees: 0, mails: 0 });
  });

  it("throws EventLockBusyError at once when the lock is held, runs no work and keeps nothing: the connection is free again", async () => {
    const eventId = await make.event();
    const holder = holdTransaction(migrated.connection(), (tx) => acquireEventCapacityLock(tx, eventId));
    await holder.started;
    let worked = false;
    let prepared = 0;

    await expect(
      runEventCapacityTransaction(
        db,
        eventId,
        () => {
          prepared += 1;
          return Promise.resolve();
        },
        () => {
          worked = true;
          return Promise.resolve("never");
        },
        undefined,
        { tryLock: true },
      ),
    ).rejects.toBeInstanceOf(EventLockBusyError);

    // Not replayed: a try that fails is the caller's to repeat, after a pause.
    expect(prepared).toBe(1);
    expect(worked).toBe(false);
    expect(await lockWaiters(db)).toBe(0);
    await holder.commit();
    expect(await db.$queryRaw`SELECT 1 AS "ok"`).toEqual([{ ok: 1 }]);
  });

  it("is the lock the waiting acquisition takes: a waiter waits for a transaction that took it by trying", async () => {
    const eventId = await make.event();
    const trying = holdTransaction(migrated.connection(), (tx) => tryAcquireEventCapacityLock(tx, eventId));
    expect(await trying.started).toBe(true);

    const second = migrated.connection().$transaction((tx) => tryAcquireEventCapacityLock(tx, eventId));
    expect(await second).toBe(false);
    const waiting = migrated.connection().$transaction((tx) => acquireEventCapacityLock(tx, eventId));
    await waitUntilWaitingForCapacityLock(db, eventId);
    await trying.commit();
    await waiting;
    expect(await migrated.connection().$transaction((tx) => tryAcquireEventCapacityLock(tx, eventId))).toBe(true);
  });
});

describe("a guest's request and the registration queue", () => {
  it("answers busy while an erasure holds the queue, and then finds the registration of the person gone", async () => {
    const eventId = await make.event({ verify: true });
    const person = await make.attendee(eventId, { email: make.address("person") });
    const guest = make.registrant({ email: person.email });
    // The same address has a registration that waits for its address; the person's erasure will delete it.
    const waiting = await make.registration(eventId, { status: "awaiting_email", email: guest.email });
    const erasing = holdTransaction(migrated.connection(), (tx) => eraseAttendees(tx, { eventId, attendeeIds: [person.id] }));
    await erasing.started;
    const patientForAMoment = { retryMs: 250, pauseMs: [20, 40] } as const;

    expect(await confirmRegistrationAddress(db, { eventId, registrationId: waiting.id }, patientForAMoment)).toEqual({ outcome: "busy" });
    expect(await place(eventId, make.registrant(), patientForAMoment)).toEqual({ outcome: "busy" });
    // Nothing of the guest's requests is written, and the registration is still there: the erasure has not committed.
    expect((await db.registration.findUnique({ where: { id: waiting.id } }))?.status).toBe("awaiting_email");

    await erasing.commit();
    expect(await confirmRegistrationAddress(db, { eventId, registrationId: waiting.id })).toEqual({ outcome: "gone" });
  });

  it("waits for a request that holds the queue only as long as that request runs", async () => {
    const eventId = await make.event({ verify: true });
    const holder = holdTransaction(migrated.connection(), (tx) => lockRegistrationQueue(tx, eventId));
    await holder.started;

    const placing = place(eventId, make.registrant());
    await delay(120);
    await holder.commit();

    expect(await placing).toEqual(RECEIVED);
  });
});

describe("an admission and an erasure of the same address, each first (ERA-04)", () => {
  /** A person with an attendee row, and a registration of an address they hold that waits for an organiser. */
  async function personWithARegistration() {
    const eventId = await make.event({ mode: "approval", capacity: 10 });
    const person = await make.attendee(eventId, { email: make.address("person") });
    const registration = await make.registration(eventId, { status: "pending", email: person.email });
    return { eventId, person, registration };
  }
  const nobodyIsLeftWithTheAddress = async (eventId: string, email: string) => {
    expect(await db.attendee.count({ where: { event_id: eventId, email, erased_at: null } })).toBe(0);
    expect(await db.registration.count({ where: { event_id: eventId, email } })).toBe(0);
    expect(await db.registrationMail.count({ where: { event_id: eventId } })).toBe(0);
  };

  it("finds the registration gone when the erasure committed first, and creates nobody from it", async () => {
    const { eventId, person, registration } = await personWithARegistration();
    const erasing = holdTransaction(migrated.connection(), (tx) => eraseAttendees(tx, { eventId, attendeeIds: [person.id] }));
    await erasing.started;

    const admitting = admit(eventId, [registration.id]);
    await waitUntilWaitingForRegistrationQueue(db, eventId);
    // The registration is still there for a plain read: the erasure has not committed.
    expect(await db.registration.count({ where: { id: registration.id } })).toBe(1);
    await erasing.commit();

    expect(await admitting).toEqual({ status: "done", outcomes: [{ id: registration.id, outcome: "gone" }] });
    await nobodyIsLeftWithTheAddress(eventId, person.email);
    expect((await db.attendee.findUniqueOrThrow({ where: { id: person.id } })).erased_at).not.toBeNull();
  });

  it("deletes the registration as one of an attendee when the admission came first, and the erasure then erases the attendee", async () => {
    const { eventId, person, registration } = await personWithARegistration();
    const paused = pauseAfterSeatCount(migrated.connection(), eventId);
    const admitting = admit(eventId, [registration.id], paused.client);
    await paused.reached;

    const erasing = db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [person.id] }));
    await waitUntilWaitingForRegistrationQueue(db, eventId);
    paused.release();

    expect(await admitting).toEqual({ status: "done", outcomes: [{ id: registration.id, outcome: "already_attendee" }] });
    const erased = await erasing;
    expect(erased.erasedIds).toEqual([person.id]);
    await nobodyIsLeftWithTheAddress(eventId, person.email);
    expect((await db.attendee.findUniqueOrThrow({ where: { id: person.id } })).erased_at).not.toBeNull();
  });

  it("does not deadlock with an admission that inserts an attendee while the erasure waits for the queue", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 10 });
    const person = await make.attendee(eventId, { email: make.address("person") });
    const other = await make.registration(eventId, { status: "pending" });
    const paused = pauseAfterSeatCount(migrated.connection(), eventId);
    const admitting = admit(eventId, [other.id], paused.client);
    await paused.reached;

    const erasing = db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [person.id] }));
    await waitUntilWaitingForRegistrationQueue(db, eventId);
    paused.release();

    expect(await admitting).toMatchObject({ status: "done" });
    expect((await erasing).erasedIds).toEqual([person.id]);
    expect(await db.attendee.count({ where: { event_id: eventId, email: other.email } })).toBe(1);
  });
});

describe("the confirmation of an address and the re-send of its link, racing (D-C5)", () => {
  /** A registration that waits for its address, made the way a submission makes it. */
  async function awaiting(options: Parameters<typeof make.event>[0] = {}) {
    const eventId = await make.event(options);
    const registrant = make.registrant();
    await place(eventId, registrant);
    const row = (await make.registrationByEmail(eventId, registrant.email))!;
    return { eventId, registrant, row };
  }
  const confirm = (eventId: string, registrationId: string, options: PlacementOptions = patient, client = db) =>
    confirmRegistrationAddress(client, { eventId, registrationId }, options);
  /** The mail was sent long ago: a second submission may mail the link again. */
  const sentLongAgo = (registrationId: string) =>
    db.registrationMail.updateMany({
      where: { registration_id: registrationId },
      data: { status: "sent", attempts: 1, queued_at: new Date(Date.now() - 2 * CONFIRMATION_RESEND_COOLDOWN_MS) },
    });
  const queuedAt = async (registrationId: string) =>
    (await db.registrationMail.findFirstOrThrow({ where: { registration_id: registrationId, template_name: "registration-confirm" } })).queued_at.getTime();

  it("places the guest once when the link is followed several times at the same time (the double click)", async () => {
    const { eventId, row } = await awaiting({ capacity: 5 });

    const answers = await Promise.all(Array.from({ length: 5 }, () => confirm(eventId, row.id)));

    expect(answers.filter((answer) => answer.outcome === "placed")).toEqual([{ outcome: "placed", status: "accepted" }]);
    expect(answers.filter((answer) => answer.outcome === "already_placed")).toEqual(
      Array.from({ length: 4 }, () => ({ outcome: "already_placed", status: "accepted" })),
    );
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
    expect(await make.templatesOf(row.id)).toEqual(["registration-confirm", "ticket"]);
    expect(await db.attendeeActionLog.count({ where: { event_id: eventId, action_type: "registration_accepted" } })).toBe(1);
  });

  it("answers busy while an import holds the capacity lock, writes nothing and keeps the link valid", async () => {
    const { eventId, row } = await awaiting();
    const importing = holdTransaction(migrated.connection(), (tx) => acquireEventCapacityLock(tx, eventId));
    await importing.started;
    const before = { row: await db.registration.findUnique({ where: { id: row.id } }), counts: await make.counts(eventId) };

    expect(await confirm(eventId, row.id, { retryMs: 250, pauseMs: [20, 40] })).toEqual({ outcome: "busy" });

    expect(await lockWaiters(db)).toBe(0);
    expect(await db.registration.findUnique({ where: { id: row.id } })).toEqual(before.row);
    expect(await make.counts(eventId)).toEqual(before.counts);
    await importing.commit();
    expect(await confirm(eventId, row.id)).toEqual({ outcome: "placed", status: "accepted" });
  });

  it("puts the guest on the waiting list when the import that held the lock took the last seat meanwhile", async () => {
    const { eventId, row } = await awaiting({ capacity: 1 });
    const importing = holdTransaction(migrated.connection(), async (tx) => {
      await acquireEventCapacityLock(tx, eventId);
      return takeASeat(tx, eventId, 1);
    });
    expect(await importing.started).toBe("created");

    const confirming = confirm(eventId, row.id);
    await delay(150);
    await importing.commit();

    expect(await confirming).toEqual({ outcome: "placed", status: "waitlist" });
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("finds the registration of a person gone when their erasure committed first, and creates nobody", async () => {
    const eventId = await make.event({ verify: true });
    const person = await make.attendee(eventId, { email: make.address("person") });
    const waiting = await make.registration(eventId, { status: "awaiting_email", email: person.email });
    const erasing = holdTransaction(migrated.connection(), (tx) => eraseAttendees(tx, { eventId, attendeeIds: [person.id] }));
    await erasing.started;

    const confirming = confirm(eventId, waiting.id);
    await delay(150);
    await erasing.commit();

    expect(await confirming).toEqual({ outcome: "gone" });
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(await db.attendee.count({ where: { event_id: eventId, erased_at: null } })).toBe(0);
    expect(await db.registrationMail.count({ where: { event_id: eventId } })).toBe(0);
  });

  it("mails the link again once when the same address is submitted several times at the same time, after the cooldown", async () => {
    const { eventId, registrant, row } = await awaiting();
    await sentLongAgo(row.id);
    const before = await queuedAt(row.id);
    const asked = vi.fn(async () => true);

    const answers = await Promise.all(
      Array.from({ length: 4 }, () => place(eventId, registrant, { ...patient, mail: { addressAllowed: asked } })),
    );

    expect(answers).toEqual(Array.from({ length: 4 }, () => RECEIVED));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(await queuedAt(row.id)).toBeGreaterThan(before);
    expect(await db.registrationMail.count({ where: { registration_id: row.id } })).toBe(1);
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("puts the link back in the queue before a confirmation that waits for it, which then places the guest", async () => {
    const { eventId, registrant, row } = await awaiting({ mode: "approval" });
    await sentLongAgo(row.id);
    const before = await queuedAt(row.id);
    const paused = pauseAfterSeatCount(migrated.connection(), eventId);
    const resending = place(eventId, registrant, patient, paused.client);
    await paused.reached;

    const confirming = confirm(eventId, row.id);
    // A guest's write tries for the locks and pauses between tries, so no transaction waits for the lock to be seen.
    await delay(150);
    paused.release();

    expect(await resending).toEqual(RECEIVED);
    expect(await confirming).toEqual({ outcome: "placed", status: "pending" });
    // The mail of the re-send is still in the queue, and the worker cancels it: the registration no longer waits.
    expect(await queuedAt(row.id)).toBeGreaterThan(before);
    expect(await make.templatesOf(row.id)).toEqual(["registration-confirm"]);
  });

  it("sends no mail again to a guest who confirmed first: the registration no longer waits", async () => {
    const { eventId, registrant, row } = await awaiting({ mode: "approval" });
    await sentLongAgo(row.id);
    const before = await queuedAt(row.id);
    const paused = pauseAfterSeatCount(migrated.connection(), eventId);
    const confirming = confirm(eventId, row.id, patient, paused.client);
    await paused.reached;

    const resending = place(eventId, registrant, patient);
    await delay(150);
    paused.release();

    expect(await confirming).toEqual({ outcome: "placed", status: "pending" });
    expect(await resending).toEqual(RECEIVED);
    expect(await queuedAt(row.id)).toBe(before);
  });

  it("lets a rejection that waits for a confirmation see the guest it placed, and a rejection that came first change nothing", async () => {
    const { eventId, row } = await awaiting({ mode: "approval" });
    // A decision on a registration that waits for its address changes nothing.
    expect(await rejectRegistrations(db, { eventId, ids: [row.id], actor })).toEqual({ outcomes: [{ id: row.id, outcome: "awaiting_email" }] });
    expect(await confirm(eventId, row.id)).toEqual({ outcome: "placed", status: "pending" });

    const second = await awaiting({ mode: "approval" });
    const paused = pauseAfterSeatCount(migrated.connection(), second.eventId);
    const confirming = confirm(second.eventId, second.row.id, patient, paused.client);
    await paused.reached;
    const rejecting = rejectRegistrations(db, { eventId: second.eventId, ids: [second.row.id], actor });
    await waitUntilWaitingForRegistrationQueue(db, second.eventId);
    paused.release();

    expect(await confirming).toEqual({ outcome: "placed", status: "pending" });
    expect(await rejecting).toEqual({ outcomes: [{ id: second.row.id, outcome: "rejected" }] });
    expect((await db.registration.findUniqueOrThrow({ where: { id: second.row.id } })).status).toBe("rejected");
  });
});
