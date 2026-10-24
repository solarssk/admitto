/**
 * The "companion" item (D-E5) against a real, fully migrated database: it is made by the admission that saves a companion,
 * once; only the guests who have a companion are offered it (the check-in card, the hand-out states a card makes, and an
 * operator's attempt to issue it); and the companions let in are counted for the people on site.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { ERASED_COMPANION_NAME, eraseAttendees } from "../src/erase-attendees.js";
import { removeAttendeeCompanion } from "../src/attendee-companion.js";
import { getAttendeeCard } from "../src/attendee-card.js";
import { COMPANION_ITEM_KEY, ensureCompanionEventItem } from "../src/event-items.js";
import { countActiveAdmittedAttendees, countCompanionsIssued } from "../src/event-seats.js";
import { ensureAttendeeItemStates, IllegalItemTransitionError, transitionItemState } from "../src/item-states.js";
import { admitRegistrations } from "../src/registration-decisions.js";
import {
  createMigratedDb,
  failingAfterWork,
  fixtures,
  holdTransaction,
  lockWaiters,
  replacing,
  wrapTransactions,
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

const staff = { operator: "staff-user-1", sessionId: "session-1", timezone: "Europe/Warsaw", ip: "203.0.113.7" };
const door = { operator: "operator-1", sessionId: "session-2", deviceId: "tablet-1", ip: "203.0.113.9" };
const plusOne = (name = "Companion Example") => ({ name, custom_data: {} });
const companionItems = (eventId: string) => db.eventItem.findMany({ where: { event_id: eventId, key: COMPANION_ITEM_KEY } });
const issue = (eventId: string, attendeeId: string) =>
  transitionItemState({ attendeeId, eventId, itemKey: COMPANION_ITEM_KEY, targetState: "issued", audit: door }, db);
const cardKeys = async (eventId: string, attendeeId: string) =>
  (await getAttendeeCard(eventId, attendeeId, db))?.items.map((item) => item.key);
const stateRows = (attendeeId: string) =>
  db.attendeeItemState.findMany({ where: { attendee_id: attendeeId }, include: { event_item: true } });

/** A guest of the event, with a companion when `companion` names one, and admitted at the door when `admitted` is set. */
async function guest(eventId: string, options: { companion?: string; admitted?: boolean; status?: string } = {}) {
  const attendee = await make.attendee(eventId, { status: options.status });
  if (options.companion) await make.companion(attendee.id, { name: options.companion });
  if (options.admitted) await db.attendee.update({ where: { id: attendee.id }, data: { admitted_at: new Date() } });
  return attendee;
}

/** An event whose companion item exists, as one that has admitted a companion has it. */
async function eventWithCompanionItem() {
  const eventId = await make.event({ capacity: 20 });
  await ensureCompanionEventItem(eventId, db);
  return eventId;
}

describe("ensureCompanionEventItem", () => {
  it("makes the item for guests with a companion: enabled, never given back, not issued at check-in", async () => {
    const eventId = await make.event();

    await ensureCompanionEventItem(eventId, db);

    expect(await companionItems(eventId)).toEqual([
      expect.objectContaining({
        event_id: eventId,
        key: "companion",
        label: "Companion",
        type: "item",
        enabled: true,
        icon: "user",
        config: { audience: "with_companion", requires_return: false, issue_on_checkin: false },
      }),
    ]);
  });

  it("has a description for the operator, so that the card does not read 'No description'", async () => {
    const eventId = await make.event();
    await ensureCompanionEventItem(eventId, db);
    const [item] = await companionItems(eventId);
    expect(item!.description).toBeTruthy();
  });

  it("makes it once however often it is called, and leaves one that was disabled or edited as the organiser has it", async () => {
    const eventId = await make.event();
    await ensureCompanionEventItem(eventId, db);
    await db.eventItem.updateMany({ where: { event_id: eventId, key: "companion" }, data: { enabled: false, label: "Plus one" } });

    await ensureCompanionEventItem(eventId, db);
    await ensureCompanionEventItem(eventId, db);

    expect(await companionItems(eventId)).toEqual([expect.objectContaining({ enabled: false, label: "Plus one" })]);
  });

  it("makes it again after the organiser deleted it", async () => {
    const eventId = await make.event();
    await ensureCompanionEventItem(eventId, db);
    await db.eventItem.deleteMany({ where: { event_id: eventId, key: "companion" } });
    expect(await companionItems(eventId)).toHaveLength(0);

    await ensureCompanionEventItem(eventId, db);

    expect(await companionItems(eventId)).toHaveLength(1);
  });

  it("leaves an item the organiser made with the same key as it is", async () => {
    const eventId = await make.event();
    await db.eventItem.create({ data: { event_id: eventId, key: "companion", label: "My own", config: { requires_return: true } } });

    await ensureCompanionEventItem(eventId, db);

    expect(await companionItems(eventId)).toEqual([expect.objectContaining({ label: "My own", config: { requires_return: true } })]);
  });

  it("leaves one item when two callers make it at once: the second waits for the first, and finds the row there", async () => {
    const eventId = await make.event();
    const first = holdTransaction(db, (tx) => ensureCompanionEventItem(eventId, tx));
    await first.started;

    // Its own look for the item finds none (the first has not committed), so it goes on to insert, and waits for the first.
    const second = db.$transaction((tx) => ensureCompanionEventItem(eventId, tx));
    await vi.waitFor(async () => expect(await lockWaiters(db)).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
    await first.commit();
    await second;

    expect(await companionItems(eventId)).toHaveLength(1);
  });

  it("makes one item for each event", async () => {
    const [one, other] = [await make.event(), await make.event()];
    await Promise.all([ensureCompanionEventItem(one, db), ensureCompanionEventItem(other, db)]);
    expect(await companionItems(one)).toHaveLength(1);
    expect(await companionItems(other)).toHaveLength(1);
  });
});

describe("admitting a registration", () => {
  const admit = (eventId: string, ids: string[], client: PrismaClient = db) => admitRegistrations(client, { eventId, ids, actor: staff });
  const approvalEvent = () => make.event({ mode: "approval", capacity: 20 });

  it("makes the item when it saves a companion, in the same transaction", async () => {
    const eventId = await approvalEvent();
    const registration = await make.registration(eventId, { status: "pending", companions: [plusOne()] });
    expect(await companionItems(eventId)).toHaveLength(0);

    expect(await admit(eventId, [registration.id])).toMatchObject({ status: "done" });

    expect(await companionItems(eventId)).toEqual([expect.objectContaining({ enabled: true })]);
  });

  it("makes no item for a guest who comes alone, and an event without companions has none", async () => {
    const eventId = await approvalEvent();
    const registration = await make.registration(eventId, { status: "pending" });

    expect(await admit(eventId, [registration.id])).toMatchObject({ status: "done" });

    expect(await db.eventItem.findMany({ where: { event_id: eventId } })).toEqual([]);
  });

  it("makes the item only for the event whose guest brought a companion", async () => {
    const [with_, without] = [await approvalEvent(), await approvalEvent()];
    await admit(with_, [(await make.registration(with_, { status: "pending", companions: [plusOne()] })).id]);
    await admit(without, [(await make.registration(without, { status: "pending" })).id]);
    expect(await companionItems(with_)).toHaveLength(1);
    expect(await companionItems(without)).toHaveLength(0);
  });

  it("leaves one item when two guests with companions are admitted at once", async () => {
    const eventId = await approvalEvent();
    const [first, second] = await Promise.all([
      make.registration(eventId, { status: "pending", companions: [plusOne("First Companion")] }),
      make.registration(eventId, { status: "pending", companions: [plusOne("Second Companion")] }),
    ]);

    const results = await Promise.all([admit(eventId, [first.id]), admit(eventId, [second.id], migrated.connection())]);

    expect(results).toEqual([expect.objectContaining({ status: "done" }), expect.objectContaining({ status: "done" })]);
    expect(await companionItems(eventId)).toHaveLength(1);
    expect(await db.attendeeCompanion.count({ where: { attendee: { event_id: eventId } } })).toBe(2);
  });

  it("makes the item again after the organiser deleted it, when the next companion is admitted", async () => {
    const eventId = await approvalEvent();
    await admit(eventId, [(await make.registration(eventId, { status: "pending", companions: [plusOne()] })).id]);
    await db.eventItem.deleteMany({ where: { event_id: eventId, key: COMPANION_ITEM_KEY } });

    await admit(eventId, [(await make.registration(eventId, { status: "pending", companions: [plusOne()] })).id]);

    expect(await companionItems(eventId)).toHaveLength(1);
  });

  it("leaves no item behind when the transaction does not commit", async () => {
    const eventId = await approvalEvent();
    const registration = await make.registration(eventId, { status: "pending", companions: [plusOne()] });

    await expect(admit(eventId, [registration.id], failingAfterWork(migrated.connection()))).rejects.toThrow("Synthetic rollback");

    expect(await companionItems(eventId)).toHaveLength(0);
    expect(await db.attendeeCompanion.count({ where: { attendee: { event_id: eventId } } })).toBe(0);
  });
});

describe("who is offered the companion item", () => {
  it("makes a pending state of it for a guest with a companion, and none for a guest without", async () => {
    const eventId = await eventWithCompanionItem();
    const withCompanion = await guest(eventId, { companion: "Companion Example" });
    const alone = await guest(eventId);

    await ensureAttendeeItemStates(withCompanion.id, eventId, db);
    await ensureAttendeeItemStates(alone.id, eventId, db);

    const keysOf = async (attendeeId: string) => (await stateRows(attendeeId)).map((row) => row.event_item.key).sort();
    expect(await keysOf(withCompanion.id)).toEqual(["badge", "companion"]);
    expect(await keysOf(alone.id)).toEqual(["badge"]);
  });

  it("is the card of a guest with a companion, and not that of one without", async () => {
    const eventId = await eventWithCompanionItem();
    const withCompanion = await guest(eventId, { companion: "Companion Example" });
    const alone = await guest(eventId);

    expect(await cardKeys(eventId, withCompanion.id)).toEqual(["badge", "companion"]);
    expect(await cardKeys(eventId, alone.id)).toEqual(["badge"]);
  });

  it("names the companion on the card, so that the operator knows whom they welcome, and offers to mark them in", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example" });

    const card = await getAttendeeCard(eventId, attendee.id, db);

    expect(card!.items.find((item) => item.key === "companion")).toEqual({
      key: "companion",
      label: "Companion",
      description: expect.any(String) as string,
      icon: "user",
      state: "pending",
      actions: ["issued"],
      detail: "Companion Example",
    });
    // Nothing else on the card carries it.
    expect(card!.items.find((item) => item.key === "badge")!.detail).toBeUndefined();
  });

  it("ends in 'issued' with no return, like any item that is not given back", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example" });

    expect(await issue(eventId, attendee.id)).toEqual({ state: "issued" });

    const item = (await getAttendeeCard(eventId, attendee.id, db))!.items.find((entry) => entry.key === "companion");
    expect(item).toMatchObject({ state: "issued", actions: [], detail: "Companion Example" });
  });

  it("puts the companion's name before what the item's own content fields say", async () => {
    const eventId = await eventWithCompanionItem();
    await db.eventCustomField.create({ data: { event_id: eventId, source_field: "shirt", label: "Shirt", type: "text" } });
    await db.eventItem.updateMany({
      where: { event_id: eventId, key: COMPANION_ITEM_KEY },
      data: { config: { audience: "with_companion", requires_return: false, content_fields: ["shirt"] } },
    });
    const attendee = await guest(eventId, { companion: "Companion Example" });
    await db.attendee.update({ where: { id: attendee.id }, data: { custom_data: { shirt: "L" } } });

    const item = (await getAttendeeCard(eventId, attendee.id, db))!.items.find((entry) => entry.key === COMPANION_ITEM_KEY);

    expect(item!.detail).toBe("Companion Example · Shirt: L");
  });

  it("refuses to issue it to a guest without a companion, as an item that is not there for them", async () => {
    const eventId = await eventWithCompanionItem();
    const alone = await guest(eventId);

    await expect(issue(eventId, alone.id)).rejects.toThrow(new IllegalItemTransitionError("Item not found or disabled"));

    expect((await stateRows(alone.id)).map((row) => row.event_item.key)).not.toContain("companion");
  });

  it("stops offering it to a guest whose companion staff removed, and offers it again if there is one", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example" });
    expect(await cardKeys(eventId, attendee.id)).toContain("companion");

    expect(await db.$transaction((tx) => removeAttendeeCompanion(tx, { eventId, attendeeId: attendee.id }))).toEqual({ outcome: "removed" });

    expect(await cardKeys(eventId, attendee.id)).toEqual(["badge"]);
    await expect(issue(eventId, attendee.id)).rejects.toBeInstanceOf(IllegalItemTransitionError);
    await make.companion(attendee.id, { name: "Another Companion" });
    expect(await cardKeys(eventId, attendee.id)).toContain("companion");
  });

  it("does not offer a disabled item", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example" });
    await db.eventItem.updateMany({ where: { event_id: eventId, key: COMPANION_ITEM_KEY }, data: { enabled: false } });
    expect(await cardKeys(eventId, attendee.id)).toEqual(["badge"]);
  });

  it("offers an item that has no audience, or 'all', to every guest, with or without a companion", async () => {
    const eventId = await eventWithCompanionItem();
    await db.eventItem.createMany({
      data: [
        { event_id: eventId, key: "giftbag", label: "Gift bag" },
        { event_id: eventId, key: "headset", label: "Headset", config: { audience: "all", requires_return: true } },
      ],
    });
    const withCompanion = await guest(eventId, { companion: "Companion Example" });
    const alone = await guest(eventId);

    expect(await cardKeys(eventId, withCompanion.id)).toEqual(["badge", "companion", "giftbag", "headset"]);
    expect(await cardKeys(eventId, alone.id)).toEqual(["badge", "giftbag", "headset"]);
  });

  it("offers an item for guests with a companion that the organiser made themselves, and names the companion on it too", async () => {
    const eventId = await make.event();
    await db.eventItem.create({
      data: { event_id: eventId, key: "plus_one_bag", label: "Gift bag for a companion", config: { audience: "with_companion" } },
    });
    const withCompanion = await guest(eventId, { companion: "Companion Example" });
    const alone = await guest(eventId);

    const card = await getAttendeeCard(eventId, withCompanion.id, db);

    expect(card!.items.find((item) => item.key === "plus_one_bag")).toMatchObject({ detail: "Companion Example" });
    expect(await cardKeys(eventId, alone.id)).toEqual(["badge"]);
  });

  it("changes nothing for an event that has no item for companions: the card does not look for a companion at all", async () => {
    const eventId = await make.event();
    await db.eventItem.create({ data: { event_id: eventId, key: "giftbag", label: "Gift bag" } });
    const attendee = await guest(eventId, { companion: "Companion Example" });
    let reads = 0;
    const counting = wrapTransactions(db, (tx) =>
      replacing(
        tx,
        "attendeeCompanion",
        new Proxy(tx.attendeeCompanion, {
          get(delegate, method, receiver) {
            const member = Reflect.get(delegate, method, receiver) as unknown;
            if (typeof member !== "function") return member;
            return (...args: unknown[]) => {
              reads += 1;
              return Reflect.apply(member, delegate, args) as unknown;
            };
          },
        }),
      ),
    );

    const card = await getAttendeeCard(eventId, attendee.id, counting);

    expect(card!.items.map((item) => item.key)).toEqual(["badge", "giftbag"]);
    expect(reads).toBe(0);
  });

  it("gives an erased guest no card, as before, so the placeholder name never reaches the door", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example", admitted: true });

    await db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [attendee.id] }));

    expect(await getAttendeeCard(eventId, attendee.id, db)).toBeNull();
    expect((await db.attendeeCompanion.findFirstOrThrow({ where: { attendee_id: attendee.id } })).name).toBe(ERASED_COMPANION_NAME);
  });

  it("keeps the name out of the logs of an issue: the action log holds the key of the item, never the companion", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Zzyzx-Companion-Name" });

    await issue(eventId, attendee.id);

    const logs = await db.attendeeActionLog.findMany({ where: { event_id: eventId } });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain("Zzyzx-Companion-Name");
    expect(logs.map((log) => log.metadata)).toContainEqual(expect.objectContaining({ event_item_key: COMPANION_ITEM_KEY }));
  });
});

describe("countCompanionsIssued", () => {
  const counted = async (eventId: string) => ({
    companions: await countCompanionsIssued(db, eventId),
    heads: await countActiveAdmittedAttendees(db, eventId),
  });

  it("counts the companion of an admitted guest once it is issued, and not before", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example", admitted: true });
    await getAttendeeCard(eventId, attendee.id, db);
    expect(await counted(eventId)).toEqual({ companions: 0, heads: 1 });

    await issue(eventId, attendee.id);

    expect(await counted(eventId)).toEqual({ companions: 1, heads: 1 });
  });

  it("counts each companion let in, and keeps the heads to the guests", async () => {
    const eventId = await eventWithCompanionItem();
    for (const name of ["First Companion", "Second Companion", "Third Companion"]) {
      const attendee = await guest(eventId, { companion: name, admitted: true });
      if (name !== "Third Companion") await issue(eventId, attendee.id);
    }
    await guest(eventId, { admitted: true });

    expect(await counted(eventId)).toEqual({ companions: 2, heads: 4 });
  });

  it("does not count a companion whom staff removed: the guest has none now, although the state stays issued", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example", admitted: true });
    await issue(eventId, attendee.id);
    expect((await counted(eventId)).companions).toBe(1);

    await db.$transaction((tx) => removeAttendeeCompanion(tx, { eventId, attendeeId: attendee.id }));

    expect((await stateRows(attendee.id)).find((row) => row.event_item.key === COMPANION_ITEM_KEY)?.state).toBe("issued");
    expect((await counted(eventId)).companions).toBe(0);
  });

  it("does not count the companion of an attendee who was cancelled or revoked", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example", admitted: true });
    await issue(eventId, attendee.id);

    for (const status of ["cancelled", "revoked"]) {
      await db.attendee.update({ where: { id: attendee.id }, data: { status } });
      expect((await counted(eventId)).companions).toBe(0);
    }
    await db.attendee.update({ where: { id: attendee.id }, data: { status: "registered" } });
    expect((await counted(eventId)).companions).toBe(1);
  });

  it("does not count the companion of a guest whose check-in was undone: they are not on site", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example", admitted: true });
    await issue(eventId, attendee.id);

    await db.attendee.update({ where: { id: attendee.id }, data: { admitted_at: null } });

    expect((await counted(eventId)).companions).toBe(0);
    await db.attendee.update({ where: { id: attendee.id }, data: { admitted_at: new Date() } });
    expect((await counted(eventId)).companions).toBe(1);
  });

  it("stops counting a companion handed back to 'pending' by an admin, and counts one marked 'returned' as not on site", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example", admitted: true });
    await issue(eventId, attendee.id);

    for (const state of ["pending", "returned", "lost", "problem", "not_applicable"]) {
      await db.attendeeItemState.updateMany({ where: { attendee_id: attendee.id }, data: { state } });
      expect((await counted(eventId)).companions).toBe(0);
    }
  });

  it("counts an admitted guest who was erased, whose companion row stays with a placeholder name", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example", admitted: true });
    await issue(eventId, attendee.id);

    await db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [attendee.id] }));

    expect(await counted(eventId)).toEqual({ companions: 1, heads: 1 });
  });

  it("counts only what is issued under the companion item: another item, or another event, adds nothing", async () => {
    const [eventId, other] = [await eventWithCompanionItem(), await eventWithCompanionItem()];
    await db.eventItem.create({ data: { event_id: eventId, key: "giftbag", label: "Gift bag" } });
    const attendee = await guest(eventId, { companion: "Companion Example", admitted: true });
    await ensureAttendeeItemStates(attendee.id, eventId, db);
    await db.attendeeItemState.updateMany({ where: { attendee_id: attendee.id, event_item: { key: { not: COMPANION_ITEM_KEY } } }, data: { state: "issued" } });
    const elsewhere = await guest(other, { companion: "Other Companion", admitted: true });
    await issue(other, elsewhere.id);

    expect(await counted(eventId)).toEqual({ companions: 0, heads: 1 });
    expect((await counted(other)).companions).toBe(1);
  });

  it("is nothing for an event that has no companions, whether it has the item or not", async () => {
    const without = await make.event();
    await guest(without, { admitted: true });
    expect(await counted(without)).toEqual({ companions: 0, heads: 1 });
    expect(await counted(await eventWithCompanionItem())).toEqual({ companions: 0, heads: 0 });
  });

  it("counts the same inside a transaction", async () => {
    const eventId = await eventWithCompanionItem();
    const attendee = await guest(eventId, { companion: "Companion Example", admitted: true });
    await issue(eventId, attendee.id);
    expect(await db.$transaction((tx) => countCompanionsIssued(tx, eventId))).toBe(1);
  });
});
