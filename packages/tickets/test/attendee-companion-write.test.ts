/**
 * writeAttendeeCompanion and removeAttendeeCompanion (staff correct or remove a companion) against a real, fully
 * migrated database: what they accept and refuse at the boundary of a registrant, whose companion they may touch, and
 * that they take the attendee's row lock first, so that against an erasure or a removal that is open each side finds
 * the other's work whole: an edit never puts a name or an answer back into a row the erasure emptied.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@admitto/db";
import { removeAttendeeCompanion, writeAttendeeCompanion, MAX_COMPANION_SLOTS } from "../src/attendee-companion.js";
import { ERASED_COMPANION_NAME, eraseAttendees } from "../src/erase-attendees.js";
import { countSeatsInUse } from "../src/event-seats.js";
import { RegistrantInputError } from "../src/registrant-input.js";
import { removeAttendees } from "../src/remove-attendees.js";
import { createMigratedDb, fixtures, holdTransaction, lockWaiters, wrapTransactions, type EventOptions, type MigratedDb } from "./registration-fixtures.js";

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

/** An event with two questions about a companion (one of them off the registration form, for staff only) and one about the guest. */
async function eventWithQuestions(options: EventOptions = {}) {
  const eventId = await make.event(options);
  await db.eventCustomField.createMany({
    data: [
      { event_id: eventId, source_field: "diet", label: "Diet", type: "select", options: ["vegan", "none"], applies_to: "companion", show_on_form: true },
      { event_id: eventId, source_field: "plate", label: "Plate", type: "text", applies_to: "companion", show_on_form: false },
      { event_id: eventId, source_field: "shirt", label: "Shirt", type: "text" },
    ],
  });
  return eventId;
}

/** An attendee with a companion who has an old name and an old answer. */
async function guestWithCompanion(eventId: string, options: { status?: string } = {}) {
  const guest = await make.attendee(eventId, options);
  await make.companion(guest.id, { name: "Old Name", customData: { diet: "none" } });
  return guest;
}

const companionOf = (attendeeId: string) => db.attendeeCompanion.findFirst({ where: { attendee_id: attendeeId, slot: 1 } });
const write = (
  eventId: string,
  attendeeId: string,
  input: { name?: unknown; customData?: unknown; slot?: number } = {},
  client: PrismaClient = db,
) =>
  client.$transaction((tx) =>
    writeAttendeeCompanion(tx, { eventId, attendeeId, name: "New Name", customData: { diet: "vegan" }, ...input }),
  );
const remove = (eventId: string, attendeeId: string, slot?: number) =>
  db.$transaction((tx) => removeAttendeeCompanion(tx, { eventId, attendeeId, slot }));

const waitForALockWaiter = () =>
  vi.waitFor(async () => expect(await lockWaiters(db)).toBeGreaterThan(0), { timeout: 5000, interval: 25 });

describe("writeAttendeeCompanion", () => {
  it("replaces the name and the answers of the companion, those off the registration form included, and takes no seat", async () => {
    const eventId = await eventWithQuestions({ capacity: 3 });
    const guest = await guestWithCompanion(eventId);
    const before = await countSeatsInUse(db, eventId);

    expect(await write(eventId, guest.id, { name: "  New Name  ", customData: { diet: "vegan", plate: "WA 12345" } })).toEqual({ outcome: "written" });

    expect(await companionOf(guest.id)).toMatchObject({ name: "New Name", slot: 1, custom_data: { diet: "vegan", plate: "WA 12345" } });
    expect(await countSeatsInUse(db, eventId)).toBe(before);
  });

  it("holds no answers when it is given none: the old ones go", async () => {
    const eventId = await eventWithQuestions();
    const guest = await guestWithCompanion(eventId);
    expect(await write(eventId, guest.id, { customData: undefined })).toEqual({ outcome: "written" });
    expect((await companionOf(guest.id))?.custom_data).toBeNull();
    expect(await write(eventId, guest.id, { customData: { diet: "" } })).toEqual({ outcome: "written" });
    expect((await companionOf(guest.id))?.custom_data).toBeNull();
  });

  it("reads the keys of the companion's questions only: a question about the guest, an unknown key and __proto__ are left out", async () => {
    const eventId = await eventWithQuestions();
    const guest = await guestWithCompanion(eventId);
    const hostile = JSON.parse('{"diet": "vegan", "shirt": "L", "unknown": "x", "company": "Example Corp", "__proto__": {"plate": "polluted"}}') as unknown;

    expect(await write(eventId, guest.id, { customData: hostile })).toEqual({ outcome: "written" });

    const row = await companionOf(guest.id);
    expect(row?.custom_data).toEqual({ diet: "vegan" });
    expect(Object.keys(row?.custom_data as object)).toEqual(["diet"]);
  });

  it("writes to the companion of a revoked or cancelled attendee too: staff may correct a name any time before an erasure", async () => {
    const eventId = await eventWithQuestions();
    for (const status of ["revoked", "cancelled"]) {
      const guest = await guestWithCompanion(eventId, { status });
      expect(await write(eventId, guest.id, { name: `Corrected ${status}` })).toEqual({ outcome: "written" });
      expect((await companionOf(guest.id))?.name).toBe(`Corrected ${status}`);
    }
  });

  const hostileName = (marks: number[]) => `Evil${marks.map((mark) => String.fromCodePoint(mark)).join("")}Name`;

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["an address", "someone@example.com"],
    ["a link", "https://example.com/offer"],
    ["a scheme without slashes", "mailto:someone"],
    ["too long", "x".repeat(101)],
    ["not text", 42],
    ["a name with a bidirectional control", hostileName([0x202e])],
    ["a name with a zero-width character", hostileName([0x200b])],
    ["a name with a control character", hostileName([0x07])],
  ])("refuses a name that is %s, with a fixed code that holds none of it, and changes nothing", async (_label, name) => {
    const eventId = await eventWithQuestions();
    const guest = await guestWithCompanion(eventId);

    const failure = await write(eventId, guest.id, { name }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RegistrantInputError);
    expect((failure as Error).message).toBe("validation_failed");
    expect(await companionOf(guest.id)).toMatchObject({ name: "Old Name", custom_data: { diet: "none" } });
  });

  it.each([
    ["a choice that is not an option", { diet: "pizza" }],
    ["a text that is too long", { plate: "x".repeat(101) }],
    ["an answer that is not text", { plate: 5 }],
    ["an answer that is a set of answers", { plate: { nested: "x" } }],
    ["a text with a bidirectional control", { plate: hostileName([0x202e]) }],
    ["more answers than an event may have questions", Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key_${index}`, "x"]))],
    ["answers that are a list", ["vegan"]],
  ])("refuses an answer that is %s, with a fixed code, and changes nothing", async (_label, customData) => {
    const eventId = await eventWithQuestions();
    const guest = await guestWithCompanion(eventId);

    const failure = await write(eventId, guest.id, { customData }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RegistrantInputError);
    expect((failure as Error).message).toBe("validation_failed");
    expect(await companionOf(guest.id)).toMatchObject({ name: "Old Name", custom_data: { diet: "none" } });
  });

  it("asks a required question of the companion, and refuses a write that leaves it unanswered", async () => {
    const eventId = await eventWithQuestions();
    await db.eventCustomField.create({
      data: { event_id: eventId, source_field: "badge", label: "Badge name", type: "text", required: true, applies_to: "companion" },
    });
    const guest = await guestWithCompanion(eventId);

    await expect(write(eventId, guest.id, { customData: { diet: "vegan" } })).rejects.toBeInstanceOf(RegistrantInputError);
    expect(await write(eventId, guest.id, { customData: { badge: "Companion" } })).toEqual({ outcome: "written" });
  });

  it("does not ask a required question about the guest of the companion", async () => {
    const eventId = await eventWithQuestions();
    await db.eventCustomField.create({ data: { event_id: eventId, source_field: "badge", label: "Badge name", type: "text", required: true } });
    const guest = await guestWithCompanion(eventId);
    expect(await write(eventId, guest.id)).toEqual({ outcome: "written" });
  });

  it.each([0, -1, MAX_COMPANION_SLOTS + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses slot %s: it is a whole number from 1 to the most companions the application allows",
    async (slot) => {
      const eventId = await eventWithQuestions();
      const guest = await guestWithCompanion(eventId);
      expect(await write(eventId, guest.id, { slot })).toEqual({ outcome: "invalid_slot" });
      expect((await companionOf(guest.id))?.name).toBe("Old Name");
    },
  );

  it("finds no companion to edit when the attendee has none, and never adds one", async () => {
    const eventId = await eventWithQuestions({ capacity: 5 });
    const guest = await make.attendee(eventId);
    expect(await write(eventId, guest.id)).toEqual({ outcome: "no_companion" });
    expect(await db.attendeeCompanion.count({ where: { attendee_id: guest.id } })).toBe(0);
    expect(await countSeatsInUse(db, eventId)).toBe(1);
  });

  it("finds an attendee who is gone: erased, removed, never there, or of another event", async () => {
    const eventId = await eventWithQuestions();
    const erased = await guestWithCompanion(eventId);
    await db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [erased.id] }));
    const removed = await guestWithCompanion(eventId);
    await db.$transaction((tx) => removeAttendees(tx, { eventId, attendeeIds: [removed.id] }));
    const elsewhere = await guestWithCompanion(await eventWithQuestions());

    for (const attendeeId of [erased.id, removed.id, "no-such-attendee", elsewhere.id]) {
      expect(await write(eventId, attendeeId)).toEqual({ outcome: "attendee_gone" });
    }
    expect(await companionOf(erased.id)).toMatchObject({ name: ERASED_COMPANION_NAME, custom_data: null });
    expect(await companionOf(elsewhere.id)).toMatchObject({ name: "Old Name" });
  });

  it("takes the attendee's row lock before it reads or writes anything else", async () => {
    const eventId = await eventWithQuestions();
    const guest = await guestWithCompanion(eventId);
    const statements: string[] = [];
    const recording = wrapTransactions(
      db,
      (tx) =>
        new Proxy(tx, {
          get(actual, property, receiver) {
            const value = Reflect.get(actual, property, receiver) as unknown;
            if (property === "$queryRaw") {
              return (strings: TemplateStringsArray, ...values: unknown[]) => {
                statements.push(strings.join("?"));
                return Reflect.apply(value as () => unknown, actual, [strings, ...values]) as unknown;
              };
            }
            if (typeof property === "string" && !property.startsWith("$")) statements.push(property);
            return value;
          },
        }),
    );

    await write(eventId, guest.id, {}, recording);

    expect(statements[0]).toMatch(/FROM "Attendee"[\s\S]*FOR KEY SHARE/);
    expect(statements.slice(1)).toEqual(["eventCustomField", "attendeeCompanion"]);
  });
});

describe("removeAttendeeCompanion", () => {
  it("removes the companion, and the seat with it", async () => {
    const eventId = await eventWithQuestions({ capacity: 3 });
    const guest = await guestWithCompanion(eventId);
    const other = await guestWithCompanion(eventId);
    expect(await countSeatsInUse(db, eventId)).toBe(4);

    expect(await remove(eventId, guest.id)).toEqual({ outcome: "removed" });

    expect(await companionOf(guest.id)).toBeNull();
    expect(await companionOf(other.id)).not.toBeNull();
    expect(await countSeatsInUse(db, eventId)).toBe(3);
    expect(await remove(eventId, guest.id)).toEqual({ outcome: "no_companion" });
  });

  it("refuses a slot that cannot exist, and an attendee who is gone, and leaves the companion of an erased attendee as it is", async () => {
    const eventId = await eventWithQuestions();
    const guest = await guestWithCompanion(eventId);
    expect(await remove(eventId, guest.id, 0)).toEqual({ outcome: "invalid_slot" });
    expect(await remove(eventId, guest.id, MAX_COMPANION_SLOTS + 1)).toEqual({ outcome: "invalid_slot" });
    expect(await remove(eventId, "no-such-attendee")).toEqual({ outcome: "attendee_gone" });
    expect(await remove(await eventWithQuestions(), guest.id)).toEqual({ outcome: "attendee_gone" });

    await db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [guest.id] }));
    expect(await remove(eventId, guest.id)).toEqual({ outcome: "attendee_gone" });
    expect(await companionOf(guest.id)).toMatchObject({ name: ERASED_COMPANION_NAME });
  });

  it("takes the attendee's row lock first, like the write", async () => {
    const eventId = await eventWithQuestions();
    const guest = await guestWithCompanion(eventId);
    const hold = holdTransaction(db, (tx) => eraseAttendees(tx, { eventId, attendeeIds: [guest.id] }));
    await hold.started;
    let finished = false;
    const removal = remove(eventId, guest.id).then((result) => {
      finished = true;
      return result;
    });
    await waitForALockWaiter();
    expect(finished).toBe(false);
    await hold.commit();
    expect(await removal).toEqual({ outcome: "attendee_gone" });
    expect(await companionOf(guest.id)).toMatchObject({ name: ERASED_COMPANION_NAME });
  });
});

describe("an edit against an erasure or a removal that is open", () => {
  it("waits for the erasure, then finds the attendee erased and writes nothing: no name goes back into the emptied row", async () => {
    const eventId = await eventWithQuestions({ capacity: 2 });
    const guest = await guestWithCompanion(eventId);
    const erasure = holdTransaction(db, (tx) => eraseAttendees(tx, { eventId, attendeeIds: [guest.id] }));
    await erasure.started;
    let finished = false;
    const edit = write(eventId, guest.id, { name: "Late Edit", customData: { diet: "vegan" } }).then((result) => {
      finished = true;
      return result;
    });
    await waitForALockWaiter();
    expect(finished).toBe(false);

    await erasure.commit();

    expect(await edit).toEqual({ outcome: "attendee_gone" });
    expect(await companionOf(guest.id)).toMatchObject({ name: ERASED_COMPANION_NAME, custom_data: null });
    expect(await db.attendee.findUniqueOrThrow({ where: { id: guest.id } })).toMatchObject({ status: "cancelled" });
    expect(await countSeatsInUse(db, eventId)).toBe(0);
  });

  it("is waited for by an erasure that comes after it, which then empties what the edit wrote", async () => {
    const eventId = await eventWithQuestions({ capacity: 2 });
    const guest = await guestWithCompanion(eventId);
    const edit = holdTransaction(db, (tx) =>
      writeAttendeeCompanion(tx, { eventId, attendeeId: guest.id, name: "Edit In Flight", customData: { diet: "vegan", plate: "WA 1" } }),
    );
    expect(await edit.started).toEqual({ outcome: "written" });
    let erased = false;
    const erasure = db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [guest.id] })).then((result) => {
      erased = true;
      return result;
    });
    await waitForALockWaiter();
    expect(erased).toBe(false);

    await edit.commit();

    expect((await erasure).erasedIds).toEqual([guest.id]);
    expect(await companionOf(guest.id)).toMatchObject({ name: ERASED_COMPANION_NAME, custom_data: null });
  });

  it("waits for the removal of the attendee, then finds the attendee gone", async () => {
    const eventId = await eventWithQuestions();
    const guest = await guestWithCompanion(eventId);
    const removal = holdTransaction(db, (tx) => removeAttendees(tx, { eventId, attendeeIds: [guest.id] }));
    await removal.started;
    const edit = write(eventId, guest.id);
    await waitForALockWaiter();

    await removal.commit();

    expect(await edit).toEqual({ outcome: "attendee_gone" });
    expect(await companionOf(guest.id)).toBeNull();
  });

  it("is waited for by a removal that comes after it, which then deletes the row", async () => {
    const eventId = await eventWithQuestions();
    const guest = await guestWithCompanion(eventId);
    const edit = holdTransaction(db, (tx) => writeAttendeeCompanion(tx, { eventId, attendeeId: guest.id, name: "Edit In Flight" }));
    await edit.started;
    const removal = db.$transaction((tx) => removeAttendees(tx, { eventId, attendeeIds: [guest.id] }));
    await waitForALockWaiter();

    await edit.commit();

    expect((await removal).removedIds).toEqual([guest.id]);
    expect(await companionOf(guest.id)).toBeNull();
  });

  it("leaves two edits of one companion to run one after the other, with no deadlock, and the later one stands", async () => {
    const eventId = await eventWithQuestions();
    const guest = await guestWithCompanion(eventId);
    const first = holdTransaction(db, (tx) => writeAttendeeCompanion(tx, { eventId, attendeeId: guest.id, name: "First Edit" }));
    await first.started;
    const second = write(eventId, guest.id, { name: "Second Edit" });
    await waitForALockWaiter();
    await first.commit();
    expect(await second).toEqual({ outcome: "written" });
    expect((await companionOf(guest.id))?.name).toBe("Second Edit");
  });

  it("waits for the removal of the companion, then finds nothing to edit", async () => {
    const eventId = await eventWithQuestions();
    const guest = await guestWithCompanion(eventId);
    const removal = holdTransaction(db, (tx) => removeAttendeeCompanion(tx, { eventId, attendeeId: guest.id }));
    expect(await removal.started).toEqual({ outcome: "removed" });
    const edit = write(eventId, guest.id);
    await waitForALockWaiter();
    await removal.commit();
    expect(await edit).toEqual({ outcome: "no_companion" });
    expect(await companionOf(guest.id)).toBeNull();
  });
});
