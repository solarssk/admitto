/**
 * A guest's companions (D-E5) at the moment of the submission, against a real, fully migrated database: what is stored,
 * the seats the guest and each companion take for every mode and seat situation, the refusal of more companions than the
 * event takes (judged under the locks, whatever the caller checked), and the races for the last seats (family C).
 */
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import type { RegistrationAccessMethod } from "@admitto/db/status";
import { acquireEventCapacityLock } from "../src/event-capacity.js";
import { countSeatsInUse } from "../src/event-seats.js";
import { confirmRegistrationAddress, placeRegistration, type PlacementOptions, type RegistrantSubmission } from "../src/registration-placement.js";
import { createMigratedDb, fixtures, holdTransaction, type EventOptions, type MigratedDb } from "./registration-fixtures.js";

// A test that makes a transaction wait for another is bound by waits, not by work: a slow machine needs more than 5 s.
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
const companion = (name = "Piotr Companion", customData: Record<string, string> | null = null) => ({ name, custom_data: customData });
const place = (
  eventId: string,
  registrant: RegistrantSubmission,
  method: RegistrationAccessMethod = "link",
  client: PrismaClient = db,
  options: PlacementOptions = {},
) => placeRegistration(client, { eventId, method, registrant }, options);
/** An event that takes a companion, and whose guests need no confirmation of their address unless a test says so. */
const eventFor = (options: EventOptions = {}) => make.event({ maxCompanions: 1, verify: false, ...options });
const seatsOf = (eventId: string) => countSeatsInUse(db, eventId);

describe("the companions a submission stores", () => {
  it.each<[string, EventOptions, string]>([
    ["waits for the address", { verify: true }, "awaiting_email"],
    ["is accepted, with a seat", { mode: "automatic" }, "accepted"],
    ["waits for the organisers", { mode: "approval" }, "pending"],
    ["goes on the waiting list", { capacity: 1 }, "waitlist"],
  ])("keeps them in the registration of a guest who %s", async (_label, options, status) => {
    const eventId = await eventFor(options);
    if (status === "waitlist") await make.attendees(eventId, 1);
    const registrant = make.registrant({ companions: [companion("Piotr Companion", { badge: "P" })] });

    expect(await place(eventId, registrant)).toEqual(RECEIVED);

    const row = await make.registrationByEmail(eventId, registrant.email);
    expect(row?.status).toBe(status);
    expect(row?.companions).toEqual([{ name: "Piotr Companion", custom_data: { badge: "P" } }]);
  });

  it("keeps an empty list for a guest who brings none, as every registration did before", async () => {
    const eventId = await eventFor();
    const registrant = make.registrant();
    await place(eventId, registrant);
    expect((await make.registrationByEmail(eventId, registrant.email))?.companions).toEqual([]);
  });

  it("makes the companion of an accepted guest a companion of the attendee, with the answers that still fit the event's questions", async () => {
    const eventId = await eventFor();
    await db.eventCustomField.create({ data: { event_id: eventId, source_field: "badge", label: "Badge", type: "text", show_on_form: true, applies_to: "companion" } });
    const registrant = make.registrant({ companions: [companion("Piotr Companion", { badge: "P", gone: "deleted question" })] });

    await place(eventId, registrant);

    const attendee = await db.attendee.findFirstOrThrow({ where: { event_id: eventId, email: registrant.email }, include: { companions: true } });
    expect(attendee.companions.map((row) => [row.slot, row.name, row.custom_data])).toEqual([[1, "Piotr Companion", { badge: "P" }]]);
    expect(await seatsOf(eventId)).toBe(2);
  });

  it("stores what the seats were counted for: an entry that is not a companion is neither stored nor a seat", async () => {
    const eventId = await eventFor();
    const registrant = make.registrant({ companions: [{ name: "   ", custom_data: null }] });

    expect(await place(eventId, registrant)).toEqual(RECEIVED);

    expect((await make.registrationByEmail(eventId, registrant.email))?.companions).toEqual([]);
    expect(await db.attendeeCompanion.count({ where: { attendee: { event_id: eventId } } })).toBe(0);
    expect(await seatsOf(eventId)).toBe(1);
  });

  it("changes nothing of a registration that exists, whatever companion a new submission for its address brings", async () => {
    const eventId = await eventFor({ verify: true });
    const first = make.registrant({ companions: [companion("First Companion")] });
    await place(eventId, first);

    expect(await place(eventId, { ...first, companions: [companion("Other Companion")] })).toEqual(RECEIVED);
    expect(await place(eventId, { ...first, companions: [] })).toEqual(RECEIVED);

    expect((await make.registrationByEmail(eventId, first.email))?.companions).toEqual([{ name: "First Companion", custom_data: null }]);
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("writes the name of the companion nowhere but the registration: not in the activity log of the acceptance", async () => {
    const eventId = await eventFor();
    const registrant = make.registrant({ companions: [companion("Zygmunt Marker")] });
    await place(eventId, registrant);

    const logs = await db.attendeeActionLog.findMany({ where: { event_id: eventId } });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain("Marker");
    expect(JSON.stringify(await db.registrationMail.findMany({ where: { event_id: eventId } }))).not.toContain("Marker");
  });
});

describe("the seats of a guest with a companion: two (D-B3, D-E5)", () => {
  const couple = () => make.registrant({ companions: [companion()] });

  it.each<[string, EventOptions, number, string, number]>([
    ["automatic, two free", { capacity: 2 }, 0, "accepted", 2],
    ["automatic, three free, one taken", { capacity: 4 }, 1, "accepted", 3],
    ["automatic, no limit", { capacity: null }, 30, "accepted", 32],
    ["automatic, one free: not enough for two", { capacity: 3 }, 2, "waitlist", 2],
    ["automatic, full", { capacity: 1 }, 1, "waitlist", 1],
    ["approval, two free: waits for the organisers, takes no seat yet", { capacity: 2, mode: "approval" }, 0, "pending", 0],
    ["approval, one free: not enough for two", { capacity: 3, mode: "approval" }, 2, "waitlist", 2],
  ])("%s", async (_label, options, taken, status, seats) => {
    const eventId = await eventFor(options);
    await make.attendees(eventId, taken);
    const registrant = couple();

    expect(await place(eventId, registrant)).toEqual(RECEIVED);

    const row = await make.registrationByEmail(eventId, registrant.email);
    expect(row?.status).toBe(status);
    expect(await seatsOf(eventId)).toBe(seats);
    expect(await make.templatesOf(row!.id)).toEqual([status === "accepted" ? "ticket" : status === "pending" ? "registration-received" : "registration-waitlist"]);
  });

  it("takes one seat, as it did, from the same guest when they come alone: the same event with one seat free", async () => {
    const eventId = await eventFor({ capacity: 3 });
    await make.attendees(eventId, 2);
    const alone = make.registrant();

    expect(await place(eventId, alone)).toEqual(RECEIVED);

    expect((await make.registrationByEmail(eventId, alone.email))?.status).toBe("accepted");
    expect(await seatsOf(eventId)).toBe(3);
  });

  it("stores nothing, and says the event is full, when the guest and the companion do not fit and there is no waiting list; a guest who comes alone is taken", async () => {
    const eventId = await eventFor({ capacity: 2, waitlist: false });
    await make.attendees(eventId, 1);
    const before = await make.counts(eventId);

    expect(await place(eventId, couple())).toEqual({ outcome: "full" });
    expect(await make.counts(eventId)).toEqual(before);
    expect(await place(eventId, make.registrant())).toEqual(RECEIVED);
  });

  it("says full the same to an address that has a registration, an attendee's address and a new one: it is decided before the address is looked at", async () => {
    const eventId = await eventFor({ capacity: 2, waitlist: false, verify: true });
    const known = make.registrant();
    await place(eventId, known);
    const holder = await make.attendee(eventId);
    expect(await seatsOf(eventId)).toBe(1);

    for (const email of [known.email, holder.email, make.address()]) {
      expect(await place(eventId, { ...couple(), email })).toEqual({ outcome: "full" });
    }
  });

  it("counts the seats of the confirmation as well: an address confirmed later takes two seats or goes on the waiting list", async () => {
    const eventId = await eventFor({ capacity: 3, verify: true });
    await make.attendees(eventId, 1);
    const registrant = couple();
    await place(eventId, registrant);
    const row = (await make.registrationByEmail(eventId, registrant.email))!;
    expect(row.status).toBe("awaiting_email");

    expect(await confirmRegistrationAddress(db, { eventId, registrationId: row.id })).toEqual({ outcome: "placed", status: "accepted" });
    expect(await seatsOf(eventId)).toBe(3);

    const second = couple();
    await place(eventId, second);
    const secondRow = (await make.registrationByEmail(eventId, second.email))!;
    expect(await confirmRegistrationAddress(db, { eventId, registrationId: secondRow.id })).toEqual({ outcome: "placed", status: "waitlist" });
    expect(await seatsOf(eventId)).toBe(3);
  });
});

describe("more companions than the event takes", () => {
  const brings = (count: number) => make.registrant({ companions: Array.from({ length: count }, (_, i) => companion(`Companion ${i}`)) });

  it.each<[string, number, number]>([
    ["takes none: one is too many", 0, 1],
    ["takes one: two are too many", 1, 2],
    ["is set to five in the database, which the application never allows: two are too many", 5, 2],
  ])("an event that %s: refused, and nothing is stored", async (_label, setting, count) => {
    for (const verify of [true, false]) {
      const eventId = await make.event({ maxCompanions: setting, verify });
      const before = await make.counts(eventId);

      expect(await place(eventId, brings(count))).toEqual({ outcome: "too_many_companions" });
      expect(await make.counts(eventId)).toEqual(before);
    }
  });

  it("takes the one companion that an event set to five takes", async () => {
    const eventId = await make.event({ maxCompanions: 5, verify: false });
    const registrant = brings(1);
    expect(await place(eventId, registrant)).toEqual(RECEIVED);
    expect(await seatsOf(eventId)).toBe(2);
  });

  it("refuses them before it asks whether the event is full, and the same to every address", async () => {
    const eventId = await eventFor({ capacity: 1, waitlist: false, verify: true });
    await make.attendees(eventId, 1);
    const known = make.registrant();
    for (const email of [known.email, make.address()]) {
      expect(await place(eventId, { ...brings(2), email })).toEqual({ outcome: "too_many_companions" });
    }
  });

  it("answers closed, as before, for an event that is not open: the refusal is for an event that takes guests", async () => {
    const eventId = await make.event({ maxCompanions: 0, archived: true });
    expect(await place(eventId, brings(1))).toEqual({ outcome: "closed" });
  });

  it("judges the number by the setting at the time it holds the locks, not at the time the call began", async () => {
    const eventId = await eventFor();
    const holder = holdTransaction(migrated.connection(), (tx) => acquireEventCapacityLock(tx, eventId));
    await holder.started;
    const placing = place(eventId, brings(1), "link", db, { retryMs: 20_000, permitWaitMs: 20_000 });
    await delay(300);
    await db.eventRegistrationSettings.update({ where: { event_id: eventId }, data: { max_companions: 0 } });
    await holder.commit();

    expect(await placing).toEqual({ outcome: "too_many_companions" });
    expect(await make.counts(eventId)).toMatchObject({ registrations: 0, mails: 0 });
  });
});

describe("guests with companions racing for the last seats", () => {
  const patient: PlacementOptions = { retryMs: 20_000, permitWaitMs: 20_000 };
  const couple = () => make.registrant({ companions: [companion()] });

  it("takes only one of two couples for three seats, and the other goes on the waiting list", async () => {
    for (let round = 0; round < 3; round += 1) {
      const eventId = await eventFor({ capacity: 3 });
      const [first, second] = [couple(), couple()];

      const results = await Promise.all([
        place(eventId, first, "link", migrated.connection(), patient),
        place(eventId, second, "link", migrated.connection(), patient),
      ]);

      expect(results).toEqual([RECEIVED, RECEIVED]);
      const statuses = (await db.registration.findMany({ where: { event_id: eventId } })).map((row) => row.status).sort();
      expect(statuses).toEqual(["accepted", "waitlist"]);
      expect(await seatsOf(eventId)).toBe(2);
    }
  });

  it("never takes more seats than the event has, whatever mix of guests alone and couples arrives at once", async () => {
    const eventId = await eventFor({ capacity: 5 });
    const arrivals = [couple(), make.registrant(), couple(), make.registrant(), couple(), couple()];

    await Promise.all(arrivals.map((registrant) => place(eventId, registrant, "link", migrated.connection(), patient)));

    expect(await seatsOf(eventId)).toBeLessThanOrEqual(5);
    const accepted = await db.registration.findMany({ where: { event_id: eventId, status: "accepted" } });
    const seats = accepted.reduce((sum, row) => sum + 1 + (Array.isArray(row.companions) ? row.companions.length : 0), 0);
    expect(seats).toBe(await seatsOf(eventId));
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(arrivals.length);
  });
});
