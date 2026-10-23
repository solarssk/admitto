/**
 * The seats a companion takes (D-B3, D-E5) against a real, fully migrated database: the one count of the seats in use
 * with companions in it, pinned to the rule of "active" that the heads use; and what that does to a registration that
 * brings a companion when it is confirmed or admitted: it needs two seats, it is given both or none, and the attendee
 * it becomes has the companion.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "@admitto/db";
import { ATTENDEE_STATUS } from "@admitto/db/status";
import { readRegistrationCompanions } from "../src/attendee-companion.js";
import { activeAttendeeWhere, countActiveAttendees, countSeatsInUse, countSeatsOfAttendee } from "../src/event-seats.js";
import { admitRegistrations } from "../src/registration-decisions.js";
import { confirmRegistrationAddress } from "../src/registration-placement.js";
import { readFreeSeats, seatsNeeded } from "../src/registration-seats.js";
import { createMigratedDb, fixtures, replacing, wrapTransactions, type EventOptions, type MigratedDb } from "./registration-fixtures.js";

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
const admit = (eventId: string, ids: string[]) => admitRegistrations(db, { eventId, ids, actor });
const plusOne = (name = "Companion Example", customData: Record<string, string> | null = {}) => ({ name, custom_data: customData });
const seats = (eventId: string) => countSeatsInUse(db, eventId);

/** A client whose transactions count the reads of the custom-field registry (one per `loadEventCustomDataFields`). */
function fieldReads() {
  let count = 0;
  const client = wrapTransactions(db, (tx) =>
    replacing(
      tx,
      "eventCustomField",
      new Proxy(tx.eventCustomField, {
        get(delegate, method, delegateReceiver) {
          if (method !== "findMany") return Reflect.get(delegate, method, delegateReceiver) as unknown;
          return (args: Prisma.EventCustomFieldFindManyArgs) => {
            count += 1;
            return delegate.findMany(args);
          };
        },
      }),
    ),
  );
  return { client, reads: () => count };
}

describe("countSeatsInUse", () => {
  it("is the head count while no attendee has a companion, whatever the statuses", async () => {
    const eventId = await make.event();
    for (const status of ATTENDEE_STATUS) await make.attendee(eventId, { status });
    const heads = await countActiveAttendees(db, eventId);
    expect(heads).toBe(2);
    expect(await seats(eventId)).toBe(heads);
    expect(await seats(eventId)).toBe(await db.attendee.count({ where: activeAttendeeWhere(eventId) }));
    expect(await seats(await make.event())).toBe(0);
  });

  it("counts a companion with its attendee: two seats for one head", async () => {
    const eventId = await make.event();
    const guest = await make.attendee(eventId);
    await make.attendee(eventId);
    await make.companion(guest.id);
    expect(await countActiveAttendees(db, eventId)).toBe(2);
    expect(await seats(eventId)).toBe(3);
  });

  it("counts an attendee once, and each of several companions, which the table allows although the application allows one today", async () => {
    const eventId = await make.event();
    const guest = await make.attendee(eventId);
    await make.companion(guest.id, { slot: 1 });
    await make.companion(guest.id, { slot: 2 });
    await make.attendee(eventId);
    expect(await countActiveAttendees(db, eventId)).toBe(2);
    expect(await seats(eventId)).toBe(4);
  });

  it("counts a companion exactly when its attendee is active: the rule of activeAttendeeWhere, for every status", async () => {
    const eventId = await make.event();
    for (const status of ATTENDEE_STATUS) await make.companion((await make.attendee(eventId, { status })).id);
    // The rule of "active" as Prisma states it for the heads, laid over the companions through their attendee.
    const expected =
      (await db.attendee.count({ where: activeAttendeeWhere(eventId) })) +
      (await db.attendeeCompanion.count({ where: { attendee: activeAttendeeWhere(eventId) } }));
    expect(expected).toBe(4);
    expect(await seats(eventId)).toBe(expected);
  });

  it("takes the attendee and the companion out of the count together, and puts both back", async () => {
    const eventId = await make.event();
    const guest = await make.attendee(eventId);
    await make.companion(guest.id);
    expect(await seats(eventId)).toBe(2);
    for (const status of ["revoked", "cancelled"]) {
      await db.attendee.update({ where: { id: guest.id }, data: { status } });
      expect(await seats(eventId)).toBe(0);
    }
    await db.attendee.update({ where: { id: guest.id }, data: { status: "registered" } });
    expect(await seats(eventId)).toBe(2);
  });

  it("counts each event on its own", async () => {
    const [one, other] = [await make.event(), await make.event()];
    await make.companion((await make.attendee(one)).id);
    await make.attendee(other);
    expect(await seats(one)).toBe(2);
    expect(await seats(other)).toBe(1);
  });

  it("reads the heads and the companions in one statement, so both come from one snapshot", async () => {
    const eventId = await make.event();
    await make.companion((await make.attendee(eventId)).id);
    const calls = { raw: 0, delegates: 0 };
    const counting = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "$queryRaw") {
          return (...args: unknown[]) => {
            calls.raw += 1;
            return Reflect.apply(target.$queryRaw, target, args) as unknown;
          };
        }
        if (key === "attendee" || key === "attendeeCompanion") calls.delegates += 1;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expect(await countSeatsInUse(counting, eventId)).toBe(2);
    expect(calls).toEqual({ raw: 1, delegates: 0 });
  });

  it("counts the same inside a transaction", async () => {
    const eventId = await make.event();
    await make.companion((await make.attendee(eventId)).id);
    expect(await db.$transaction((tx) => countSeatsInUse(tx, eventId))).toBe(2);
  });

  it("leaves the event fewer free seats for a companion, and none over the limit", async () => {
    const eventId = await make.event({ capacity: 3 });
    await make.companion((await make.attendee(eventId)).id);
    expect(await db.$transaction((tx) => readFreeSeats(tx, eventId, 3))).toBe(1);
    await make.attendee(eventId);
    expect(await db.$transaction((tx) => readFreeSeats(tx, eventId, 3))).toBe(0);
    expect(await db.$transaction((tx) => readFreeSeats(tx, eventId, 2))).toBe(0);
    expect(await db.$transaction((tx) => readFreeSeats(tx, eventId, null))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("countSeatsOfAttendee", () => {
  it("is the attendee, and a seat more for each companion", async () => {
    const guest = await make.attendee(await make.event());
    expect(await countSeatsOfAttendee(db, guest.id)).toBe(1);
    await make.companion(guest.id);
    expect(await countSeatsOfAttendee(db, guest.id)).toBe(2);
    await make.companion(guest.id, { slot: 2 });
    expect(await countSeatsOfAttendee(db, guest.id)).toBe(3);
  });

  it("counts a revoked attendee's companions too: what restoring them needs", async () => {
    const guest = await make.attendee(await make.event(), { status: "revoked" });
    await make.companion(guest.id);
    expect(await countSeatsOfAttendee(db, guest.id)).toBe(2);
  });
});

/** An event with approval and a limit, and `taken` attendees without a companion in it. */
async function eventWith(taken: number, options: EventOptions = {}) {
  const eventId = await make.event({ mode: "approval", capacity: 10, ...options });
  await make.attendees(eventId, taken);
  return eventId;
}

describe("admitting a registration that brings a companion", () => {
  it("makes the attendee and the companion, two seats, and keeps the answers of each where they belong", async () => {
    const eventId = await eventWith(0);
    await db.eventCustomField.createMany({
      data: [
        { event_id: eventId, source_field: "shirt", label: "Shirt", type: "text" },
        { event_id: eventId, source_field: "diet", label: "Diet", type: "select", options: ["vegan", "none"], applies_to: "companion" },
        { event_id: eventId, source_field: "plate", label: "Plate", type: "text", applies_to: "companion" },
      ],
    });
    const registration = await make.registration(eventId, {
      status: "pending",
      // The guest's own answers: one to a guest question, one whose key is a question about the companion.
      customData: { shirt: "XL", diet: "none" },
      companions: [plusOne("Companion Example", { diet: "vegan", shirt: "L", plate: "WA 1", removed_question: "x" })],
    });

    const result = await admit(eventId, [registration.id]);

    const attendee = await db.attendee.findFirstOrThrow({ where: { event_id: eventId }, include: { companions: true } });
    expect(result).toEqual({ status: "done", outcomes: [{ id: registration.id, outcome: "accepted", attendeeId: attendee.id }] });
    expect(attendee.custom_data).toEqual({ shirt: "XL" });
    expect(attendee.companions).toHaveLength(1);
    expect(attendee.companions[0]).toMatchObject({
      attendee_id: attendee.id,
      slot: 1,
      name: "Companion Example",
      // The answers to the companion's questions only, and only to those the event has now.
      custom_data: { diet: "vegan", plate: "WA 1" },
    });
    expect(await seats(eventId)).toBe(2);
    expect(await countActiveAttendees(db, eventId)).toBe(1);
  });

  it("gives a companion who answered nothing no answers, and a name as the registration has it", async () => {
    const eventId = await eventWith(0);
    const registration = await make.registration(eventId, { status: "pending", companions: [{ name: "  Padded Companion  " }] });
    await admit(eventId, [registration.id]);
    expect(await db.attendeeCompanion.findFirstOrThrow({ where: { attendee: { event_id: eventId } } })).toMatchObject({
      name: "Padded Companion",
      custom_data: null,
    });
  });

  it("needs two seats: with one free it refuses the whole request, and writes no attendee and no companion", async () => {
    const eventId = await eventWith(8, { capacity: 9 });
    const registration = await make.registration(eventId, { status: "pending", companions: [plusOne()] });

    expect(await admit(eventId, [registration.id])).toEqual({ status: "not_enough_seats", free: 1, needed: 2 });

    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(8);
    expect(await db.attendeeCompanion.count({ where: { attendee: { event_id: eventId } } })).toBe(0);
    expect((await db.registration.findUniqueOrThrow({ where: { id: registration.id } })).status).toBe("pending");
  });

  it("is admitted with exactly two seats free, and the event is then full", async () => {
    const eventId = await eventWith(8);
    const registration = await make.registration(eventId, { status: "pending", companions: [plusOne()] });
    expect(await admit(eventId, [registration.id])).toMatchObject({ status: "done" });
    expect(await seats(eventId)).toBe(10);
    expect(await db.$transaction((tx) => readFreeSeats(tx, eventId, 10))).toBe(0);
  });

  it("sums the seats of a request that has guests with and without a companion", async () => {
    const eventId = await eventWith(6);
    const alone = await make.registration(eventId, { status: "pending" });
    const withCompanion = await make.registration(eventId, { status: "pending", companions: [plusOne()] });
    // 6 taken, 10 in all: the two need 3 seats, so they fit; one more guest with a companion would not.
    expect(await admit(eventId, [alone.id, withCompanion.id])).toMatchObject({ status: "done" });
    expect(await seats(eventId)).toBe(9);
    const another = await make.registration(eventId, { status: "pending", companions: [plusOne()] });
    expect(await admit(eventId, [another.id])).toEqual({ status: "not_enough_seats", free: 1, needed: 2 });
  });

  it("does not check an event without a limit, and still writes the companion", async () => {
    const eventId = await eventWith(0, { capacity: null });
    const registration = await make.registration(eventId, { status: "pending", companions: [plusOne()] });
    expect(await admit(eventId, [registration.id])).toMatchObject({ status: "done" });
    expect(await db.attendeeCompanion.count({ where: { attendee: { event_id: eventId } } })).toBe(1);
  });

  it("writes as many companions as the seats it was given, whatever the column holds", async () => {
    const eventId = await eventWith(0, { capacity: 10 });
    const stored = [5, { name: "" }, plusOne("First Companion"), plusOne("Second Companion"), plusOne("Third Companion")];
    const registration = await make.registration(eventId, { status: "pending", companions: stored });
    const needed = seatsNeeded(registration.companions);
    expect(needed).toBe(1 + readRegistrationCompanions(registration.companions).length);

    await admit(eventId, [registration.id]);

    expect(await seats(eventId)).toBe(needed);
    expect((await db.attendeeCompanion.findMany({ where: { attendee: { event_id: eventId } } })).map((row) => row.name)).toEqual(
      readRegistrationCompanions(registration.companions).map((companion) => companion.name),
    );
  });

  it("reads the questions about a companion once for the batch, and only when a guest of it brings one", async () => {
    const eventId = await eventWith(0);
    await db.eventCustomField.create({
      data: { event_id: eventId, source_field: "diet", label: "Diet", type: "text", applies_to: "companion" },
    });
    const names = ["First Companion", "Second Companion"];
    const withCompanions = await Promise.all(
      names.map((name) => make.registration(eventId, { status: "pending", companions: [plusOne(name, { diet: `${name} diet` })] })),
    );
    const alone = [await make.registration(eventId, { status: "pending" }), await make.registration(eventId, { status: "pending" })];

    const noCompanions = fieldReads();
    await admitRegistrations(noCompanions.client, { eventId, ids: alone.map((row) => row.id), actor });
    // The guests' questions, and no more: nobody brought a companion.
    expect(noCompanions.reads()).toBe(1);

    const companions = fieldReads();
    const result = await admitRegistrations(companions.client, { eventId, ids: withCompanions.map((row) => row.id), actor });
    expect(result).toMatchObject({ status: "done" });
    // The guests' questions and the companions', each read once for the two guests.
    expect(companions.reads()).toBe(2);
    const rows = await db.attendeeCompanion.findMany({ where: { attendee: { event_id: eventId } }, orderBy: { name: "asc" } });
    expect(rows.filter((row) => names.includes(row.name)).map((row) => row.custom_data)).toEqual([
      { diet: "First Companion diet" },
      { diet: "Second Companion diet" },
    ]);
  });
});

describe("confirming the address of a registration that brings a companion", () => {
  const awaiting = (eventId: string) => make.registration(eventId, { status: "awaiting_email", companions: [plusOne()] });
  const confirm = (eventId: string, registrationId: string) => confirmRegistrationAddress(db, { eventId, registrationId });

  it("accepts the guest into two seats of an automatic event, and the companion is theirs", async () => {
    const eventId = await eventWith(0, { mode: "automatic", capacity: 2 });
    const registration = await awaiting(eventId);

    expect(await confirm(eventId, registration.id)).toEqual({ outcome: "placed", status: "accepted" });

    expect(await seats(eventId)).toBe(2);
    expect(await db.attendeeCompanion.count({ where: { attendee: { event_id: eventId } } })).toBe(1);
  });

  it("sends the guest to the waiting list when only one seat is free, and writes neither attendee nor companion", async () => {
    const eventId = await eventWith(1, { mode: "automatic", capacity: 2 });
    const registration = await awaiting(eventId);

    expect(await confirm(eventId, registration.id)).toEqual({ outcome: "placed", status: "waitlist" });

    expect(await seats(eventId)).toBe(1);
    expect(await db.attendeeCompanion.count({ where: { attendee: { event_id: eventId } } })).toBe(0);
    expect(await db.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ status: "waitlist", attendee_id: null });
  });

  it("refuses the guest of an automatic event with no waiting list when only one seat is free, and keeps the registration", async () => {
    const eventId = await eventWith(1, { mode: "automatic", capacity: 2, waitlist: false });
    const registration = await awaiting(eventId);

    expect(await confirm(eventId, registration.id)).toEqual({ outcome: "full" });

    expect((await db.registration.findUniqueOrThrow({ where: { id: registration.id } })).status).toBe("awaiting_email");
    expect(await seats(eventId)).toBe(1);
  });

  it("holds the guest of an event with approval for the organiser only when both seats are free", async () => {
    const roomy = await eventWith(0, { capacity: 2 });
    const tight = await eventWith(1, { capacity: 2 });
    expect(await confirm(roomy, (await awaiting(roomy)).id)).toEqual({ outcome: "placed", status: "pending" });
    expect(await confirm(tight, (await awaiting(tight)).id)).toEqual({ outcome: "placed", status: "waitlist" });
  });
});
