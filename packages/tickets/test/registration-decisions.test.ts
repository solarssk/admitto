/**
 * admitRegistrations and rejectRegistrations against a real, fully migrated database: the attendee made from a
 * registration, the seats counted as the one count (countSeatsInUse) and refused as a whole when they do not
 * suffice, an address that is an attendee already, the ticket mail row in the same transaction, and a waiting list
 * that nothing empties by itself.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { eraseAttendees } from "../src/erase-attendees.js";
import { createAttendeeFromRegistration } from "../src/registration-attendee.js";
import { admitRegistrations, rejectRegistrations } from "../src/registration-decisions.js";
import { placeRegistration } from "../src/registration-placement.js";
import {
  createMigratedDb,
  failingAfterWork,
  fixtures,
  holdTransaction,
  lockWaiters,
  type EventOptions,
  type MigratedDb,
} from "./registration-fixtures.js";

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
const admit = (eventId: string, ids: string[], now?: Date) => admitRegistrations(db, { eventId, ids, actor, now });
const reject = (eventId: string, ids: string[], notify?: boolean, now?: Date) =>
  rejectRegistrations(db, { eventId, ids, actor, notify, now });

/** An event with approval and a limit, and the registrations the test names, as organiser queue rows. */
async function queue(options: EventOptions = {}, statuses: string[] = ["pending"]) {
  const eventId = await make.event({ mode: "approval", capacity: 10, ...options });
  const rows = [];
  for (const status of statuses) rows.push(await make.registration(eventId, { status }));
  return { eventId, rows };
}

const statusOf = async (id: string) => (await db.registration.findUnique({ where: { id } }))?.status;

describe("admitRegistrations: the attendee, the registration and the mail", () => {
  it("makes the attendee from the registration, links and decides it, queues the ticket, and logs the decision", async () => {
    const eventId = await make.event({ mode: "approval" });
    await db.eventCustomField.createMany({
      data: [
        { event_id: eventId, source_field: "diet", label: "Diet", type: "select", options: ["vegan", "none"] },
        { event_id: eventId, source_field: "plate", label: "Plate", type: "text", required: true },
      ],
    });
    const registration = await make.registration(eventId, {
      status: "pending",
      email: make.address("admitted"),
      company: "Example Corp",
      customData: { diet: "vegan", removed_field: "x" },
    });
    const now = new Date();

    const result = await admit(eventId, [registration.id], now);

    const attendee = await db.attendee.findFirstOrThrow({ where: { event_id: eventId } });
    expect(result).toEqual({ status: "done", outcomes: [{ id: registration.id, outcome: "accepted", attendeeId: attendee.id }] });
    expect(attendee).toMatchObject({
      email: registration.email,
      name: registration.name,
      first_name: registration.first_name,
      last_name: registration.last_name,
      company: "Example Corp",
      department: null,
      status: "registered",
      rsvp_status: "none",
      rsvp_source: null,
      ticket_type: null,
      token_hash: null,
      client_timezone: null,
      // The organiser's decision comes first: the required field was not answered and the answer to a deleted field is dropped.
      custom_data: { diet: "vegan" },
    });
    const after = (await db.registration.findUnique({ where: { id: registration.id } }))!;
    expect(after).toMatchObject({ status: "accepted", attendee_id: attendee.id, decided_by: actor.operator, confirm_expires_at: null });
    expect(after.decided_at?.getTime()).toBe(now.getTime());
    expect(await make.templatesOf(registration.id)).toEqual(["ticket"]);
    const logs = await db.attendeeActionLog.findMany({ where: { event_id: eventId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action_type: "registration_accepted",
      attendee_id: null,
      actor_user_id: actor.operator,
      session_id: actor.sessionId,
      client_timezone: actor.timezone,
      ip: actor.ip,
    });
    expect(logs[0]?.metadata).toEqual({ count: 1, registration_ids: [registration.id], attendee_ids: [attendee.id] });
    expect(JSON.stringify(logs[0])).not.toContain(registration.email);
  });

  it("admits from the waiting list and from rejected (D-B8), in one request", async () => {
    const { eventId, rows } = await queue({}, ["pending", "waitlist", "rejected"]);

    const result = await admit(eventId, rows.map((row) => row.id));

    expect(result).toMatchObject({ status: "done" });
    for (const row of rows) {
      expect(await statusOf(row.id)).toBe("accepted");
      expect(await make.templatesOf(row.id)).toEqual(["ticket"]);
    }
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(3);
    expect(await db.attendeeActionLog.count({ where: { event_id: eventId } })).toBe(1);
  });

  it("answers for each id, in the order asked, and treats a repeated id once", async () => {
    const { eventId, rows } = await queue({}, ["pending", "pending", "waitlist"]);
    const [first, second, third] = rows as [(typeof rows)[number], (typeof rows)[number], (typeof rows)[number]];
    const accepted = await make.attendee(eventId);
    const decided = await make.registration(eventId, { status: "accepted", attendeeId: accepted.id });
    const waiting = await make.registration(eventId, { status: "awaiting_email" });
    const otherEvent = await queue();

    const result = await admit(eventId, [
      decided.id,
      third.id,
      "no-such-registration",
      waiting.id,
      first.id,
      otherEvent.rows[0]!.id,
      third.id,
      second.id,
    ]);

    expect(result).toMatchObject({ status: "done" });
    const outcomes = (result as { outcomes: { id: string; outcome: string }[] }).outcomes;
    expect(outcomes.map((row) => [row.id, row.outcome])).toEqual([
      [decided.id, "already_decided"],
      [third.id, "accepted"],
      ["no-such-registration", "gone"],
      [waiting.id, "awaiting_email"],
      [first.id, "accepted"],
      [otherEvent.rows[0]!.id, "gone"],
      [second.id, "accepted"],
    ]);
    expect(await statusOf(waiting.id)).toBe("awaiting_email");
    expect(await statusOf(otherEvent.rows[0]!.id)).toBe("pending");
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(4);
  });

  it("answers an empty request with nothing, and changes nothing", async () => {
    const { eventId } = await queue();
    expect(await admit(eventId, [])).toEqual({ status: "done", outcomes: [] });
  });

  it("changes the state, makes the attendee and queues the mail in one transaction: a rollback leaves none of them", async () => {
    const { eventId, rows } = await queue({}, ["pending", "waitlist"]);
    const before = await make.counts(eventId);

    await expect(
      admitRegistrations(failingAfterWork(migrated.connection()), { eventId, ids: rows.map((row) => row.id), actor }),
    ).rejects.toThrow("Synthetic rollback after the work");

    expect(await make.counts(eventId)).toEqual(before);
    expect(await statusOf(rows[0]!.id)).toBe("pending");
  });

  it("decides nothing in an archived event, or one that does not exist", async () => {
    const { eventId, rows } = await queue({ archived: true });
    const before = await make.counts(eventId);

    expect(await admit(eventId, [rows[0]!.id])).toEqual({ status: "done", outcomes: [{ id: rows[0]!.id, outcome: "closed" }] });
    expect(await admit("no-such-event", ["x"])).toEqual({ status: "done", outcomes: [{ id: "x", outcome: "closed" }] });
    expect(await make.counts(eventId)).toEqual(before);
    expect(await statusOf(rows[0]!.id)).toBe("pending");
  });
});

describe("admitRegistrations: the seats (D-B3, D-B4, D-B7)", () => {
  /** 5 seats, two held (a revoked and a cancelled attendee hold none): 3 free. */
  async function threeFree() {
    const eventId = await make.event({ mode: "approval", capacity: 5 });
    await make.attendees(eventId, 2);
    await make.attendees(eventId, 1, "revoked");
    await make.attendees(eventId, 1, "cancelled");
    const rows = [];
    for (let i = 0; i < 5; i += 1) rows.push(await make.registration(eventId, { status: i % 2 === 0 ? "pending" : "waitlist" }));
    return { eventId, ids: rows.map((row) => row.id) };
  }

  it("refuses a request that needs more seats than are free, with the numbers, and changes nothing", async () => {
    const { eventId, ids } = await threeFree();
    const before = await make.counts(eventId);

    expect(await admit(eventId, ids.slice(0, 4))).toEqual({ status: "not_enough_seats", free: 3, needed: 4 });

    expect(await make.counts(eventId)).toEqual(before);
    for (const id of ids) expect(["pending", "waitlist"]).toContain(await statusOf(id));
  });

  it("admits exactly as many as are free, and then refuses one more", async () => {
    const { eventId, ids } = await threeFree();

    expect(await admit(eventId, ids.slice(0, 3))).toMatchObject({ status: "done" });
    expect(await db.attendee.count({ where: { event_id: eventId, status: { notIn: ["revoked", "cancelled"] } } })).toBe(5);

    expect(await admit(eventId, ids.slice(3, 4))).toEqual({ status: "not_enough_seats", free: 0, needed: 1 });
    expect(await statusOf(ids[3]!)).toBe("waitlist");
  });

  it("admits nobody into an event that is over its limit (a lowered limit takes nobody out)", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 2 });
    await make.attendees(eventId, 3);
    const row = await make.registration(eventId, { status: "pending" });

    expect(await admit(eventId, [row.id])).toEqual({ status: "not_enough_seats", free: 0, needed: 1 });
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(3);
  });

  it("has no limit to respect in an event without one", async () => {
    const eventId = await make.event({ mode: "approval", capacity: null });
    await make.attendees(eventId, 20);
    const rows = [];
    for (let i = 0; i < 6; i += 1) rows.push(await make.registration(eventId, { status: "pending" }));

    expect(await admit(eventId, rows.map((row) => row.id))).toMatchObject({ status: "done" });
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(26);
  });

  it("takes no partial decision: a request that does not fit leaves what would have fitted, and what would have been deleted, as it was", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 3 });
    const holder = await make.attendee(eventId, { email: make.address("holder") });
    await make.attendees(eventId, 1);
    const [a, b] = [await make.registration(eventId, { status: "pending" }), await make.registration(eventId, { status: "waitlist" })];
    const duplicate = await make.registration(eventId, { status: "pending", email: holder.email.toUpperCase().toLowerCase() });
    const before = await make.counts(eventId);

    expect(await admit(eventId, [a.id, b.id, duplicate.id])).toEqual({ status: "not_enough_seats", free: 1, needed: 2 });

    expect(await make.counts(eventId)).toEqual(before);
    expect(await statusOf(duplicate.id)).toBe("pending");
  });

  it("needs a seat for each companion", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 3 });
    await make.attendees(eventId, 2);
    const withCompanion = await make.registration(eventId, { status: "pending", companions: [{ name: "Companion Example", custom_data: {} }] });

    expect(await admit(eventId, [withCompanion.id])).toEqual({ status: "not_enough_seats", free: 1, needed: 2 });
    await db.event.update({ where: { id: eventId }, data: { capacity: 4 } });
    expect(await admit(eventId, [withCompanion.id])).toMatchObject({ status: "done" });
  });

  it("does not promote anybody when a seat frees up (D-B5): a new guest queues behind the waiting one (D-B16), and the organiser decides", async () => {
    const eventId = await make.event({ mode: "automatic", capacity: 1, verify: false });
    const holder = await make.attendee(eventId);
    const waiting = await make.registration(eventId, { status: "waitlist" });

    await db.attendee.update({ where: { id: holder.id }, data: { status: "cancelled" } });
    expect(await statusOf(waiting.id)).toBe("waitlist");
    expect(await db.attendee.count({ where: { event_id: eventId, status: "registered" } })).toBe(0);

    const newcomer = make.registrant();
    expect(await placeRegistration(db, { eventId, method: "link", registrant: newcomer })).toEqual({ outcome: "received" });
    expect((await make.registrationByEmail(eventId, newcomer.email))?.status).toBe("waitlist");
    expect(await db.attendee.count({ where: { event_id: eventId, status: "registered" } })).toBe(0);

    expect(await admit(eventId, [waiting.id])).toMatchObject({ status: "done" });
    expect(await statusOf(waiting.id)).toBe("accepted");
  });
});

describe("admitRegistrations: an address that is an attendee already, or was erased", () => {
  it.each([["registered"], ["revoked"], ["cancelled"]])(
    "deletes the registration of an address that an attendee (status %s) holds, and needs no seat for it",
    async (status) => {
      const eventId = await make.event({ mode: "approval", capacity: 1 });
      const holder = await make.attendee(eventId, { email: ` ${make.address("Imported").toUpperCase()} `, status });
      const registration = await make.registration(eventId, { status: "pending", email: holder.email.trim().toLowerCase() });
      const before = await db.attendee.findUnique({ where: { id: holder.id } });

      const result = await admit(eventId, [registration.id]);

      expect(result).toEqual({ status: "done", outcomes: [{ id: registration.id, outcome: "already_attendee" }] });
      expect(await db.registration.count({ where: { event_id: eventId } })).toBe(0);
      expect(await db.registrationMail.count({ where: { event_id: eventId } })).toBe(0);
      expect(await db.attendee.findUnique({ where: { id: holder.id } })).toEqual(before);
      const logs = await db.attendeeActionLog.findMany({ where: { event_id: eventId } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action_type: "registrations_deleted", actor_user_id: actor.operator });
      expect(logs[0]?.metadata).toEqual({ count: 1, registration_ids: [registration.id], reason: "already_attendee" });
    },
  );

  it("deletes the registration and queued mail of a held address, and admits the others, in one request", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 5 });
    const holder = await make.attendee(eventId);
    const duplicate = await make.registration(eventId, { status: "waitlist", email: holder.email });
    await db.registrationMail.create({ data: { registration_id: duplicate.id, event_id: eventId, template_name: "registration-waitlist" } });
    const fine = await make.registration(eventId, { status: "pending" });

    const result = await admit(eventId, [duplicate.id, fine.id]);

    expect(result).toMatchObject({ status: "done" });
    expect((result as { outcomes: { outcome: string }[] }).outcomes.map((row) => row.outcome)).toEqual(["already_attendee", "accepted"]);
    expect(await db.registration.findUnique({ where: { id: duplicate.id } })).toBeNull();
    expect(await db.registrationMail.count({ where: { registration_id: duplicate.id } })).toBe(0);
    expect(await statusOf(fine.id)).toBe("accepted");
  });

  it("treats an address that an uncommitted edit of an attendee takes meanwhile as held: the registration is deleted and no seat is used", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 5 });
    const editor = await make.attendee(eventId);
    const registration = await make.registration(eventId, { status: "pending" });
    // The one writer that takes none of our locks: an edit of an address, not committed when the admission checks it.
    const editing = holdTransaction(migrated.connection(), (tx) =>
      tx.attendee.update({ where: { id: editor.id }, data: { email: registration.email } }),
    );
    await editing.started;

    const admitting = admit(eventId, [registration.id]);
    await vi.waitFor(async () => expect(await lockWaiters(db)).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
    await editing.commit();

    expect(await admitting).toEqual({ status: "done", outcomes: [{ id: registration.id, outcome: "already_attendee" }] });
    expect(await db.registration.count({ where: { id: registration.id } })).toBe(0);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
    expect(await db.registrationMail.count({ where: { event_id: eventId } })).toBe(0);
  });

  it("makes a new attendee of a guest whose earlier attendee row was erased: it holds a placeholder address", async () => {
    const eventId = await make.event({ mode: "approval", capacity: 5 });
    const person = await make.attendee(eventId, { email: make.address("returning") });
    await db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [person.id] }));
    const registration = await make.registration(eventId, { status: "pending", email: person.email });

    expect(await admit(eventId, [registration.id])).toMatchObject({ status: "done" });

    expect(await db.attendee.count({ where: { event_id: eventId, email: person.email } })).toBe(1);
    expect(await statusOf(registration.id)).toBe("accepted");
  });
});

describe("rejectRegistrations (D-B8)", () => {
  it("rejects pending and waiting registrations, queues no mail by default, and logs the decision", async () => {
    const { eventId, rows } = await queue({}, ["pending", "waitlist"]);
    const now = new Date();

    const result = await reject(eventId, rows.map((row) => row.id), undefined, now);

    expect(result.outcomes.map((row) => row.outcome)).toEqual(["rejected", "rejected"]);
    for (const row of rows) {
      const after = (await db.registration.findUnique({ where: { id: row.id } }))!;
      expect(after).toMatchObject({ status: "rejected", decided_by: actor.operator, attendee_id: null });
      expect(after.decided_at?.getTime()).toBe(now.getTime());
      expect(await make.templatesOf(row.id)).toEqual([]);
    }
    const logs = await db.attendeeActionLog.findMany({ where: { event_id: eventId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action_type: "registration_rejected", actor_user_id: actor.operator, attendee_id: null });
    expect(logs[0]?.metadata).toEqual({ count: 2, registration_ids: rows.map((row) => row.id).sort(), notify: false });
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(0);
  });

  it("queues the rejection mail only when the organiser asked to inform the guest", async () => {
    const { eventId, rows } = await queue({}, ["pending", "waitlist"]);

    await reject(eventId, rows.map((row) => row.id), true);

    for (const row of rows) expect(await make.templatesOf(row.id)).toEqual(["registration-rejected"]);
    expect((await db.attendeeActionLog.findFirstOrThrow({ where: { event_id: eventId } })).metadata).toMatchObject({ notify: true });
  });

  it("answers `already_decided`, `awaiting_email`, `gone` and `closed` where the registration cannot be rejected", async () => {
    const { eventId, rows } = await queue({}, ["pending", "rejected", "awaiting_email"]);
    const holder = await make.attendee(eventId);
    const accepted = await make.registration(eventId, { status: "accepted", attendeeId: holder.id });

    const result = await reject(eventId, [rows[0]!.id, rows[1]!.id, rows[2]!.id, accepted.id, "no-such-registration"]);

    expect(result.outcomes.map((row) => row.outcome)).toEqual(["rejected", "already_decided", "awaiting_email", "already_decided", "gone"]);
    expect(await statusOf(rows[2]!.id)).toBe("awaiting_email");
    expect(await statusOf(accepted.id)).toBe("accepted");

    const archived = await queue({ archived: true });
    expect(await reject(archived.eventId, [archived.rows[0]!.id])).toEqual({ outcomes: [{ id: archived.rows[0]!.id, outcome: "closed" }] });
    expect(await statusOf(archived.rows[0]!.id)).toBe("pending");
  });

  it("needs no seat: a full event can turn guests down", async () => {
    const { eventId, rows } = await queue({ capacity: 1 }, ["waitlist"]);
    await make.attendees(eventId, 1);

    expect((await reject(eventId, [rows[0]!.id])).outcomes[0]?.outcome).toBe("rejected");
  });

  it("changes the state and queues the mail in one transaction: a rollback leaves the registration as it was", async () => {
    const { eventId, rows } = await queue({}, ["pending"]);
    const before = await make.counts(eventId);

    await expect(
      rejectRegistrations(failingAfterWork(migrated.connection()), { eventId, ids: [rows[0]!.id], actor, notify: true }),
    ).rejects.toThrow("Synthetic rollback after the work");

    expect(await make.counts(eventId)).toEqual(before);
    expect(await statusOf(rows[0]!.id)).toBe("pending");
  });

  it("leaves a rejected guest unable to register again until staff delete the row, and able to be admitted later", async () => {
    const { eventId, rows } = await queue({ verify: false }, ["pending"]);
    await reject(eventId, [rows[0]!.id]);

    expect(await placeRegistration(db, { eventId, method: "link", registrant: make.registrant({ email: rows[0]!.email }) })).toEqual({
      outcome: "received",
    });
    expect(await statusOf(rows[0]!.id)).toBe("rejected");

    expect(await admit(eventId, [rows[0]!.id])).toMatchObject({ status: "done" });
    expect(await statusOf(rows[0]!.id)).toBe("accepted");
  });
});

describe("createAttendeeFromRegistration", () => {
  const source = (email: string) => ({
    email,
    first_name: "Guest",
    last_name: "Example",
    company: null,
    department: null,
    custom_data: null,
  });

  it("answers null for an address an attendee holds in exactly this spelling, and leaves its transaction usable", async () => {
    const eventId = await make.event();
    const held = await make.attendee(eventId);

    const result = await db.$transaction(async (tx) => {
      const attendeeId = await createAttendeeFromRegistration(tx, eventId, source(held.email), []);
      // A unique violation would have aborted the transaction: this query would fail with it.
      return { attendeeId, attendees: await tx.attendee.count({ where: { event_id: eventId } }) };
    });

    expect(result).toEqual({ attendeeId: null, attendees: 1 });
  });

  it("waits for an edit of an address that is not committed yet, and then answers null instead of failing", async () => {
    const eventId = await make.event();
    const editor = await make.attendee(eventId);
    const wanted = make.address("wanted");
    // What the one writer that takes none of our locks does: it moves an attendee to the address, and has not committed.
    const editing = holdTransaction(migrated.connection(), (tx) =>
      tx.attendee.update({ where: { id: editor.id }, data: { email: wanted } }),
    );
    await editing.started;

    const creating = db.$transaction(async (tx) => {
      const attendeeId = await createAttendeeFromRegistration(tx, eventId, source(wanted), []);
      return { attendeeId, attendees: await tx.attendee.count({ where: { event_id: eventId } }) };
    });
    await vi.waitFor(async () => expect(await lockWaiters(db)).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
    await editing.commit();

    expect(await creating).toEqual({ attendeeId: null, attendees: 1 });
  });

  it("makes an attendee of an address nobody holds, and returns its id", async () => {
    const eventId = await make.event();
    const email = make.address("fresh");

    const attendeeId = await db.$transaction((tx) => createAttendeeFromRegistration(tx, eventId, source(email), []));

    expect((await db.attendee.findFirstOrThrow({ where: { event_id: eventId } })).id).toBe(attendeeId);
  });
});
