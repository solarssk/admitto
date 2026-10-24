/**
 * What erasing, removing and deleting a registration do to the companion of an attendee, against a real, fully
 * migrated database. The companion is a third party: the name and the answers go like the attendee's own, the row
 * stays (the seat of an admitted guest is still taken), and the seat goes with the attendee, so an erasure that
 * cancels the attendee frees both seats and one that does not frees none.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@admitto/db";
import { ERASED_COMPANION_NAME, eraseAttendees } from "../src/erase-attendees.js";
import { countSeatsInUse } from "../src/event-seats.js";
import { deleteRegistrations } from "../src/registration-deletion.js";
import { removeAttendees } from "../src/remove-attendees.js";
import { createMigratedDb, fixtures, type MigratedDb } from "./registration-fixtures.js";

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

const MARKER = "Zzyzx-Marker";
const actor = { operator: "staff-user-1", sessionId: "session-1", timezone: "Europe/Warsaw", ip: "203.0.113.7" };
const erase = (eventId: string, attendeeIds: string[]) => db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds }));
const seats = (eventId: string) => countSeatsInUse(db, eventId);
const companionsOf = (attendeeId: string) => db.attendeeCompanion.findMany({ where: { attendee_id: attendeeId }, orderBy: { slot: "asc" } });

/** An attendee with a companion who has a name and an answer worth finding (they hold `marker`): two seats. */
async function guestWithCompanion(eventId: string, options: { status?: string; admitted?: boolean; marker?: string } = {}) {
  const marker = options.marker ?? MARKER;
  const guest = await make.attendee(eventId, { status: options.status });
  if (options.admitted) await db.attendee.update({ where: { id: guest.id }, data: { admitted_at: new Date() } });
  const companion = await make.companion(guest.id, { name: `Companion ${marker}`, customData: { diet: `vegan ${marker}` } });
  return { guest, companion };
}

/** A marker no other test of this file has written: the scans below read the whole database. */
const uniqueMarker = () => `Zzyzx-${randomUUID()}`;

/** The tables of the database that hold the marker in any column, found by reading each row as text. */
async function tablesHolding(marker: string): Promise<string[]> {
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`;
  const holding: string[] = [];
  for (const { table_name } of tables) {
    // A table name read from the catalog, never request content.
    const [row] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${table_name}" t WHERE t::text LIKE $1`, `%${marker}%`);
    if (Number(row?.n ?? 0) > 0) holding.push(table_name);
  }
  holding.sort();
  return holding;
}

describe("erasing an attendee who has a companion", () => {
  it("frees both seats of one who was not admitted, and keeps the companion's row with a placeholder name and no answers", async () => {
    const eventId = await make.event({ capacity: 2 });
    const { guest, companion } = await guestWithCompanion(eventId);
    expect(await seats(eventId)).toBe(2);

    const result = await erase(eventId, [guest.id]);

    expect(result.erasedIds).toEqual([guest.id]);
    expect((await db.attendee.findUniqueOrThrow({ where: { id: guest.id } })).status).toBe("cancelled");
    expect(await seats(eventId)).toBe(0);
    const [row] = await companionsOf(guest.id);
    expect(row).toMatchObject({ id: companion.id, attendee_id: guest.id, slot: 1, name: ERASED_COMPANION_NAME, custom_data: null });
    expect(ERASED_COMPANION_NAME).not.toContain(MARKER);
    expect(row!.updated_at.getTime()).toBeGreaterThanOrEqual(companion.updated_at.getTime());
  });

  it("keeps both seats of one who was admitted: the guest came, and so did their companion", async () => {
    const eventId = await make.event({ capacity: 2 });
    const { guest } = await guestWithCompanion(eventId, { admitted: true });

    await erase(eventId, [guest.id]);

    expect((await db.attendee.findUniqueOrThrow({ where: { id: guest.id } })).status).toBe("registered");
    expect(await seats(eventId)).toBe(2);
    expect(await companionsOf(guest.id)).toEqual([expect.objectContaining({ name: ERASED_COMPANION_NAME, custom_data: null })]);
  });

  it("keeps both seats on an archived event, where the numbers are final", async () => {
    const eventId = await make.event({ capacity: 2, archived: true });
    const { guest } = await guestWithCompanion(eventId);

    await erase(eventId, [guest.id]);

    expect((await db.attendee.findUniqueOrThrow({ where: { id: guest.id } })).status).toBe("registered");
    expect(await seats(eventId)).toBe(2);
    expect(await companionsOf(guest.id)).toEqual([expect.objectContaining({ name: ERASED_COMPANION_NAME, custom_data: null })]);
  });

  it("leaves a revoked attendee's seats where they were, none, and empties the companion", async () => {
    const eventId = await make.event({ capacity: 2 });
    const { guest } = await guestWithCompanion(eventId, { status: "revoked" });
    expect(await seats(eventId)).toBe(0);

    await erase(eventId, [guest.id]);

    expect((await db.attendee.findUniqueOrThrow({ where: { id: guest.id } })).status).toBe("revoked");
    expect(await seats(eventId)).toBe(0);
    expect(await companionsOf(guest.id)).toEqual([expect.objectContaining({ name: ERASED_COMPANION_NAME, custom_data: null })]);
  });

  it("empties the companions of the attendees it erases, and the companion of nobody else", async () => {
    const eventId = await make.event({ capacity: 10 });
    const first = await guestWithCompanion(eventId);
    const second = await guestWithCompanion(eventId);
    const kept = await guestWithCompanion(eventId);
    const otherEvent = await make.event();
    const elsewhere = await guestWithCompanion(otherEvent);

    await erase(eventId, [first.guest.id, second.guest.id]);

    for (const erased of [first, second]) expect(await companionsOf(erased.guest.id)).toEqual([expect.objectContaining({ name: ERASED_COMPANION_NAME })]);
    for (const untouched of [kept, elsewhere]) {
      expect(await companionsOf(untouched.guest.id)).toEqual([
        expect.objectContaining({ name: `Companion ${MARKER}`, custom_data: { diet: `vegan ${MARKER}` } }),
      ]);
    }
    expect(await seats(eventId)).toBe(2);
  });

  it("changes nothing when the attendee is erased already", async () => {
    const eventId = await make.event();
    const { guest } = await guestWithCompanion(eventId);
    await erase(eventId, [guest.id]);
    const [before] = await companionsOf(guest.id);

    const again = await erase(eventId, [guest.id]);

    expect(again.alreadyErasedIds).toEqual([guest.id]);
    expect((await companionsOf(guest.id))[0]).toEqual(before);
  });

  it("leaves the companion's name and answers in no table of the database, the copy in the registration included", async () => {
    const marker = uniqueMarker();
    const eventId = await make.event();
    const { guest } = await guestWithCompanion(eventId, { marker });
    await make.registration(eventId, {
      status: "accepted",
      attendeeId: guest.id,
      companions: [{ name: `Companion ${marker}`, custom_data: { diet: `vegan ${marker}` } }],
    });
    expect(await tablesHolding(marker)).toEqual(["AttendeeCompanion", "Registration"]);

    await erase(eventId, [guest.id]);

    expect(await tablesHolding(marker)).toEqual([]);
  });
});

describe("removing an attendee who has a companion", () => {
  it("deletes the companion's rows with the attendee, frees the seats, and leaves the name in no table", async () => {
    const marker = uniqueMarker();
    const eventId = await make.event({ capacity: 2 });
    const { guest } = await guestWithCompanion(eventId, { marker });
    await make.registration(eventId, {
      status: "accepted",
      attendeeId: guest.id,
      companions: [{ name: `Companion ${marker}`, custom_data: null }],
    });
    const other = await guestWithCompanion(await make.event());

    const result = await db.$transaction((tx) => removeAttendees(tx, { eventId, attendeeIds: [guest.id] }));

    expect(result.removedIds).toEqual([guest.id]);
    expect(await companionsOf(guest.id)).toEqual([]);
    expect(await seats(eventId)).toBe(0);
    expect(await companionsOf(other.guest.id)).toHaveLength(1);
    expect(await tablesHolding(marker)).toEqual([]);
  });

  it("deletes the rows of an attendee who was erased before, with the attendee", async () => {
    const eventId = await make.event();
    const { guest } = await guestWithCompanion(eventId, { admitted: true });
    await erase(eventId, [guest.id]);

    await db.$transaction((tx) => removeAttendees(tx, { eventId, attendeeIds: [guest.id] }));

    expect(await companionsOf(guest.id)).toEqual([]);
    expect(await seats(eventId)).toBe(0);
  });
});

describe("deleting the registration of an accepted guest who has a companion", () => {
  it("erases the attendee and the companion the way Erase personal data does", async () => {
    const marker = uniqueMarker();
    const eventId = await make.event({ capacity: 2 });
    const { guest } = await guestWithCompanion(eventId, { marker });
    const registration = await make.registration(eventId, {
      status: "accepted",
      attendeeId: guest.id,
      companions: [{ name: `Companion ${marker}`, custom_data: null }],
    });

    const result = await db.$transaction((tx) =>
      deleteRegistrations(tx, { eventId, target: { kind: "ids", ids: [registration.id] }, actor }),
    );

    expect(result).toMatchObject({ status: "done", deleted: [{ id: registration.id, attendeeId: guest.id }] });
    expect(await seats(eventId)).toBe(0);
    expect(await companionsOf(guest.id)).toEqual([expect.objectContaining({ name: ERASED_COMPANION_NAME, custom_data: null })]);
    expect(await tablesHolding(marker)).toEqual([]);
  });
});
