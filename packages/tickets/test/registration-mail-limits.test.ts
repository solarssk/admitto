/**
 * The limits a caller can put on the mail a guest's submission queues (MN-05), against a real, fully migrated
 * database. A limit never stops the registration and never changes the answer: only the mail is withheld. What is
 * claimed: the address budget and the event's budget each withhold it, the address's is asked only for a registration
 * that is stored and mailed (so a guest who is told to try again does not use it up), the event's count is exact under
 * concurrency (it is read under the registration queue), it counts every template of every registration of the event
 * and only those inside the window, and a known address is read and answered the same way.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { acquireEventCapacityLock } from "../src/event-capacity.js";
import {
  EVENT_MAIL_CAP_PER_SEAT,
  eventMailCap,
  placeRegistration,
  type PlacementOptions,
  type RegistrantSubmission,
} from "../src/registration-placement.js";
import { createMigratedDb, fixtures, holdTransaction, lockWaiters, type EventOptions, type MigratedDb } from "./registration-fixtures.js";

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
const DAY_MS = 86_400_000;
/** A guest's write that may wait as long as a test needs: these tests are not about the lock. */
const patient = { retryMs: 20_000, permitWaitMs: 20_000 };

const place = (eventId: string, registrant: RegistrantSubmission, options: PlacementOptions = {}) =>
  placeRegistration(db, { eventId, method: "link", registrant }, { ...patient, ...options });

const mailsOf = (eventId: string) => db.registrationMail.count({ where: { event_id: eventId } });

describe("eventMailCap", () => {
  it("is the base for an event without a limit and for a small one", () => {
    expect(eventMailCap(1000, null)).toBe(1000);
    expect(eventMailCap(1000, 0)).toBe(1000);
    expect(eventMailCap(1000, 100)).toBe(1000);
  });

  it("is three per seat once that is more than the base, so a big event is not cut short", () => {
    expect(EVENT_MAIL_CAP_PER_SEAT).toBe(3);
    expect(eventMailCap(1000, 334)).toBe(1002);
    expect(eventMailCap(1000, 5000)).toBe(15000);
  });
});

describe("placeRegistration: the budget of an address", () => {
  const states: { name: string; event: EventOptions; status: string }[] = [
    { name: "a guest who has to confirm the address", event: { verify: true }, status: "awaiting_email" },
    { name: "a guest accepted at once", event: { verify: false }, status: "accepted" },
    { name: "a guest who waits for an organiser", event: { verify: false, mode: "approval" }, status: "pending" },
    { name: "a guest on the waiting list", event: { verify: false, capacity: 1 }, status: "waitlist" },
  ];
  const allow = (answer: boolean) => ({ mail: { addressAllowed: vi.fn(async () => answer) } });

  it.each(states)("stores $name and queues no mail when the address has spent its budget", async ({ event, status }) => {
    const eventId = await make.event(event);
    if (status === "waitlist") await make.attendees(eventId, 1);
    const withheld = make.registrant();
    const allowed = make.registrant();

    expect(await place(eventId, withheld, allow(false))).toEqual(RECEIVED);
    expect(await place(eventId, allowed, allow(true))).toEqual(RECEIVED);

    const stored = (await make.registrationByEmail(eventId, withheld.email))!;
    const compared = (await make.registrationByEmail(eventId, allowed.email))!;
    // The same registration, in the same state, whether the mail goes or not.
    expect(stored.status).toBe(status);
    expect(compared.status).toBe(status);
    expect(await make.templatesOf(stored.id)).toEqual([]);
    expect(await make.templatesOf(compared.id)).toHaveLength(1);
    if (status === "accepted") {
      expect(stored.attendee_id).not.toBeNull();
      // An organiser can still send the ticket by hand ("Send unsent tickets"): the attendee is there.
      expect(await db.attendee.count({ where: { id: stored.attendee_id! } })).toBe(1);
    }
  });

  it.each(states)("asks the budget once for $name, before the registration is committed", async ({ event }) => {
    const eventId = await make.event(event);
    const guest = make.registrant();
    const outsider = migrated.connection();
    let visibleFromOutside = -1;
    const addressAllowed = vi.fn(async () => {
      // Another connection does not see the registration yet: the question is asked inside the transaction that writes it.
      visibleFromOutside = await outsider.registration.count({ where: { event_id: eventId, email: guest.email } });
      return true;
    });

    expect(await place(eventId, guest, { mail: { addressAllowed } })).toEqual(RECEIVED);

    expect(addressAllowed).toHaveBeenCalledTimes(1);
    expect(visibleFromOutside).toBe(0);
    expect(await make.templatesOf((await make.registrationByEmail(eventId, guest.email))!.id)).toHaveLength(1);
  });

  it("queues the mail when nothing is said about the address, as before", async () => {
    const eventId = await make.event({ verify: true });

    expect(await place(eventId, make.registrant())).toEqual(RECEIVED);
    expect(await place(eventId, make.registrant(), { mail: {} })).toEqual(RECEIVED);

    expect(await mailsOf(eventId)).toBe(2);
  });

  it("does not ask for an address that has a place already: a registration of any state, or an attendee", async () => {
    const eventId = await make.event({ verify: true });
    const known = await make.registration(eventId, { status: "pending" });
    const held = await make.attendee(eventId);
    const before = await make.counts(eventId);
    const options = allow(false);

    expect(await place(eventId, make.registrant({ email: known.email }), options)).toEqual(RECEIVED);
    expect(await place(eventId, make.registrant({ email: held.email }), options)).toEqual(RECEIVED);

    expect(options.mail.addressAllowed).not.toHaveBeenCalled();
    expect(await make.counts(eventId)).toEqual(before);
  });

  it("does not ask for a full event without a waiting list, nor for an event that is closed", async () => {
    const full = await make.event({ capacity: 1, waitlist: false });
    await make.attendees(full, 1);
    const archived = await make.event({ archived: true });
    const options = allow(true);

    expect(await place(full, make.registrant(), options)).toEqual({ outcome: "full" });
    expect(await place(archived, make.registrant(), options)).toEqual({ outcome: "closed" });

    expect(options.mail.addressAllowed).not.toHaveBeenCalled();
  });

  it("does not ask while a lock is held and the request gives up: a guest who is told to try again spends nothing", async () => {
    const eventId = await make.event({ verify: true });
    const holder = holdTransaction(migrated.connection(), (tx) => acquireEventCapacityLock(tx, eventId));
    await holder.started;
    const options = { ...allow(true), retryMs: 150, pauseMs: [10, 20] as [number, number] };

    expect(await place(eventId, make.registrant(), options)).toEqual({ outcome: "busy" });

    expect(options.mail.addressAllowed).not.toHaveBeenCalled();
    await holder.commit();
  });

  it("does not ask when the event's budget is spent already: the mail is withheld before the address is looked at", async () => {
    const eventId = await make.event({ verify: true, capacity: null });
    await place(eventId, make.registrant(), { mail: { event: { base: 1, windowMs: DAY_MS } } });
    const options = { mail: { addressAllowed: vi.fn(async () => true), event: { base: 1, windowMs: DAY_MS } } };

    expect(await place(eventId, make.registrant(), options)).toEqual(RECEIVED);

    expect(options.mail.addressAllowed).not.toHaveBeenCalled();
    expect(await mailsOf(eventId)).toBe(1);
  });

  it("does not ask when the address is taken between the check and the write, because nothing is stored", async () => {
    const eventId = await make.event({ verify: false });
    const guest = make.registrant();
    const options = allow(true);
    // An attendee with this address is added in a transaction that commits after the guest's check of the address.
    const adding = holdTransaction(migrated.connection(), (tx) =>
      tx.attendee.create({ data: { event_id: eventId, email: guest.email, name: "Added By Staff" } }),
    );
    await adding.started;

    const placing = place(eventId, guest, options);
    // The guest's write is blocked on the address the staff member's transaction has taken but not committed.
    await vi.waitFor(async () => expect(await lockWaiters(db)).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
    await adding.commit();

    expect(await placing).toEqual(RECEIVED);
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);
    expect(options.mail.addressAllowed).not.toHaveBeenCalled();
  });

  it("changes nothing for an address that has a place already, whatever the budget says", async () => {
    const eventId = await make.event({ verify: true });
    const known = await make.registration(eventId, { status: "waitlist" });
    const before = await make.counts(eventId);

    expect(await place(eventId, make.registrant({ email: known.email }), allow(false))).toEqual(RECEIVED);
    expect(await make.counts(eventId)).toEqual(before);
  });
});

describe("placeRegistration: the budget of an event", () => {
  const budget = (base: number, windowMs = DAY_MS) => ({ mail: { event: { base, windowMs } } });

  it("withholds the mail of the guests that come after the event has queued its share, and stores them", async () => {
    const eventId = await make.event({ verify: true, capacity: null });
    const guests = Array.from({ length: 5 }, () => make.registrant());

    for (const guest of guests) expect(await place(eventId, guest, budget(3))).toEqual(RECEIVED);

    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(5);
    expect(await mailsOf(eventId)).toBe(3);
    const withMail = [];
    for (const guest of guests) withMail.push((await make.templatesOf((await make.registrationByEmail(eventId, guest.email))!.id)).length);
    expect(withMail).toEqual([1, 1, 1, 0, 0]);
  });

  it("counts the rows of every template of every registration of the event, not only those of this kind of submission", async () => {
    const eventId = await make.event({ verify: true, capacity: null });
    const first = await make.registration(eventId, { status: "pending" });
    const second = await make.registration(eventId, { status: "waitlist" });
    await db.registrationMail.createMany({
      data: [
        { registration_id: first.id, event_id: eventId, template_name: "registration-received" },
        { registration_id: second.id, event_id: eventId, template_name: "registration-waitlist" },
      ],
    });
    const late = make.registrant();

    expect(await place(eventId, late, budget(2))).toEqual(RECEIVED);

    expect(await make.templatesOf((await make.registrationByEmail(eventId, late.email))!.id)).toEqual([]);
    expect(await mailsOf(eventId)).toBe(2);
  });

  it("counts only the rows queued inside the window", async () => {
    const eventId = await make.event({ verify: true, capacity: null });
    const guests = [make.registrant(), make.registrant()];
    for (const guest of guests) await place(eventId, guest, budget(2, 60_000));
    // Both rows are older than the window now.
    await db.registrationMail.updateMany({ where: { event_id: eventId }, data: { queued_at: new Date(Date.now() - 120_000) } });
    const next = make.registrant();

    expect(await place(eventId, next, budget(2, 60_000))).toEqual(RECEIVED);

    expect(await make.templatesOf((await make.registrationByEmail(eventId, next.email))!.id)).toEqual(["registration-confirm"]);
  });

  it("does not count the mail that staff queued today for registrations older than the window", async () => {
    const eventId = await make.event({ verify: true, capacity: null });
    const older = new Date(Date.now() - 2 * DAY_MS);
    const first = await make.registration(eventId, { status: "pending", createdAt: older });
    const second = await make.registration(eventId, { status: "waitlist", createdAt: older });
    // One mail for each, queued just now: what a decision of staff on an older registration does.
    await db.registrationMail.createMany({
      data: [
        { registration_id: first.id, event_id: eventId, template_name: "registration-rejected" },
        { registration_id: second.id, event_id: eventId, template_name: "registration-received" },
      ],
    });
    const next = make.registrant();

    expect(await place(eventId, next, budget(2))).toEqual(RECEIVED);

    expect(await make.templatesOf((await make.registrationByEmail(eventId, next.email))!.id)).toEqual(["registration-confirm"]);
    expect(await mailsOf(eventId)).toBe(3);
  });

  it("stamps the rows it queues with the real time, so that the window means what it says", async () => {
    const eventId = await make.event({ verify: true, capacity: null });
    const guest = make.registrant();
    const before = Date.now();

    await place(eventId, guest);

    const mail = await db.registrationMail.findFirstOrThrow({ where: { event_id: eventId } });
    expect(Math.abs(mail.queued_at.getTime() - before)).toBeLessThan(60_000);
  });

  it("does not share the budget between events", async () => {
    const full = await make.event({ verify: true, capacity: null });
    const other = await make.event({ verify: true, capacity: null });
    for (let i = 0; i < 3; i += 1) await place(full, make.registrant(), budget(2));
    const guest = make.registrant();

    expect(await place(other, guest, budget(2))).toEqual(RECEIVED);

    expect(await mailsOf(full)).toBe(2);
    expect(await make.templatesOf((await make.registrationByEmail(other, guest.email))!.id)).toEqual(["registration-confirm"]);
  });

  it("allows three rows per seat of the event when that is more than the base", async () => {
    const eventId = await make.event({ verify: true, capacity: 10 });

    for (let i = 0; i < 31; i += 1) await place(eventId, make.registrant(), budget(5));

    // max(5, 3 * 10) = 30
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(31);
    expect(await mailsOf(eventId)).toBe(30);
  });

  it("holds the budget exactly when guests submit at once: the count is read under the registration queue", async () => {
    const eventId = await make.event({ verify: true, capacity: null });
    const guests = Array.from({ length: 8 }, () => make.registrant());

    const answers = await Promise.all(guests.map((guest) => place(eventId, guest, budget(3))));

    expect(answers).toEqual(guests.map(() => RECEIVED));
    expect(await db.registration.count({ where: { event_id: eventId } })).toBe(8);
    expect(await mailsOf(eventId)).toBe(3);
  });

  it("applies when the address is allowed too, and the two limits together withhold the mail if either does", async () => {
    const eventId = await make.event({ verify: true, capacity: null });
    const options = { mail: { addressAllowed: async () => true, event: { base: 1, windowMs: DAY_MS } } };

    await place(eventId, make.registrant(), options);
    const second = make.registrant();
    await place(eventId, second, options);
    const third = make.registrant();
    await place(eventId, third, { mail: { addressAllowed: async () => false, event: { base: 100, windowMs: DAY_MS } } });

    expect(await mailsOf(eventId)).toBe(1);
    expect(await make.templatesOf((await make.registrationByEmail(eventId, second.email))!.id)).toEqual([]);
    expect(await make.templatesOf((await make.registrationByEmail(eventId, third.email))!.id)).toEqual([]);
  });

  it("changes nothing for an address that has a place already when the budget is spent", async () => {
    const eventId = await make.event({ verify: true, capacity: null });
    await place(eventId, make.registrant(), budget(1));
    const known = await make.registration(eventId, { status: "waitlist" });
    const before = await make.counts(eventId);

    expect(await place(eventId, make.registrant({ email: known.email }), budget(1))).toEqual(RECEIVED);
    expect(await make.counts(eventId)).toEqual(before);
  });
});

describe("placeRegistration: telling the caller that the mail was withheld", () => {
  it("names the budget that withheld it, once per registration, and says nothing when the mail is queued", async () => {
    const eventId = await make.event({ verify: true, capacity: null });
    const onWithheld = vi.fn();
    const limits = (addressAllowed: boolean) => ({
      mail: { addressAllowed: async () => addressAllowed, event: { base: 1, windowMs: DAY_MS }, onWithheld },
    });

    await place(eventId, make.registrant(), limits(true));
    expect(onWithheld).not.toHaveBeenCalled();
    // The event has queued its one mail: the next registration is withheld by the event's budget, the address is not asked.
    await place(eventId, make.registrant(), limits(false));
    expect(onWithheld.mock.calls).toEqual([["event"]]);

    const other = await make.event({ verify: true, capacity: null });
    onWithheld.mockClear();
    await place(other, make.registrant(), limits(false));
    expect(onWithheld.mock.calls).toEqual([["address"]]);
  });

  it("says nothing for an address that has a place already, or for a registration that is not stored", async () => {
    const eventId = await make.event({ verify: true, capacity: 1, waitlist: false });
    const known = await make.registration(eventId, { status: "pending" });
    const onWithheld = vi.fn();
    const mail = { addressAllowed: async () => false, event: { base: 0, windowMs: DAY_MS }, onWithheld };

    await place(eventId, make.registrant({ email: known.email }), { mail });
    await make.attendees(eventId, 1);
    await place(eventId, make.registrant(), { mail });

    expect(onWithheld).not.toHaveBeenCalled();
  });
});
