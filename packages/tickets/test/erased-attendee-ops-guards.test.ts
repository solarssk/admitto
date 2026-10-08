/**
 * Event-day operations refuse an erased attendee (check-in, undo / revoke, item hand-outs, notes,
 * activity log, door lookups), and an erasure that is still open makes them wait instead of
 * writing onto the row it is emptying. Same database setup as erase-attendees.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { eraseAttendees } from "../src/erase-attendees.js";
import { lockAttendeeRow, lockAttendeesForUpdate } from "../src/attendee-lock.js";
import { admitAttendee } from "../src/admit.js";
import { checkInScan, getRecentCheckIns } from "../src/checkin.js";
import { getAttendeeCard, lookupAttendees } from "../src/attendee-card.js";
import { revokeCheckIn, revokeCheckInMutation, undoLastCheckIn, UndoNotAllowedError } from "../src/undo.js";
import { IllegalItemTransitionError, revokeItemState, transitionItemState } from "../src/item-states.js";
import {
  AttendeeNotFoundError,
  NoteNotFoundError,
  addAttendeeNote,
  deleteAttendeeNote,
  updateAttendeeNote,
} from "../src/notes.js";
import { revokeAllCheckInsForEvent, revokeAllItemsForEvent, revokeItemsForAttendees } from "../src/bulk-revoke.js";
import { writeActionLog, writeActionLogMany } from "../src/ops-audit.js";
import { generateToken } from "../src/token.js";
import { hashToken } from "../src/hash.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");

const ORG_ID = "org_erase_ops";
const EVENT_ID = "evt-erase-ops";
const PREVIEW_EVENT_ID = "evt-erase-ops-preview";
const audit = { operator: "staff-1", deviceId: "Gate A", sessionId: "session-1" };

let prisma: PrismaClient;
let seq = 0;
let badgeItemId: string;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();
  await prisma.organization.create({ data: { id: ORG_ID, name: "Erase Ops Org", slug: "erase-ops-org" } });
  const base = { organization_id: ORG_ID, date: new Date("2026-09-01T09:00:00Z") };
  await prisma.event.create({
    data: { id: EVENT_ID, title: "Ops", slug: "erase-ops", ops_config: { require_confirm_on_scan: false, badge_at_entry: false }, ...base },
  });
  await prisma.event.create({
    data: { id: PREVIEW_EVENT_ID, title: "Preview", slug: "erase-ops-preview", ops_config: { require_confirm_on_scan: true }, ...base },
  });
  badgeItemId = (await prisma.eventItem.create({ data: { event_id: EVENT_ID, key: "badge", label: "Badge" } })).id;
  await prisma.eventItem.create({ data: { event_id: PREVIEW_EVENT_ID, key: "badge", label: "Badge" } });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function createAttendee(overrides: Partial<Prisma.AttendeeUncheckedCreateInput> = {}) {
  const n = ++seq;
  return prisma.attendee.create({
    data: {
      id: `ops-att-${n}`,
      event_id: EVENT_ID,
      email: `ops${n}@example.com`,
      name: `Ops Person ${n}`,
      status: "registered",
      ...overrides,
    },
  });
}

const erase = (ids: string[], eventId = EVENT_ID) =>
  prisma.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: ids }));

/** Starts an erasure and keeps its transaction open after the rows are written. */
async function holdErasure(ids: string[], eventId = EVENT_ID) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let written!: () => void;
  const writtenPromise = new Promise<void>((resolve) => (written = resolve));
  const transaction = prisma.$transaction(async (tx) => {
    await eraseAttendees(tx, { eventId, attendeeIds: ids });
    written();
    await gate;
  });
  await writtenPromise;
  return { commit: () => (release(), transaction) };
}

/** True when the promise is still unsettled after a short wait. */
async function staysPending(promise: Promise<unknown>, ms = 300): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return !settled;
}

const admittedAttendee = async (overrides: Partial<Prisma.AttendeeUncheckedCreateInput> = {}, deviceId = "Gate A") => {
  const a = await createAttendee({ admitted_at: new Date("2026-09-01T10:15:00Z"), admitted_by: "staff-1", ...overrides });
  const checkIn = await prisma.checkIn.create({
    data: { attendee_id: a.id, event_id: EVENT_ID, status: "VALID", source: "scan", device_id: deviceId, checked_in_at: new Date("2026-09-01T10:15:00Z") },
  });
  return { a, checkIn };
};

describe("lockAttendeeRow", () => {
  it("reports live, erased and missing rows, and respects the event", async () => {
    const live = await createAttendee();
    const gone = await createAttendee();
    await erase([gone.id]);
    expect(await lockAttendeeRow(prisma, live.id)).toMatchObject({ id: live.id, status: "registered", erased: false });
    expect(await lockAttendeeRow(prisma, gone.id)).toMatchObject({ erased: true });
    expect(await lockAttendeeRow(prisma, "nobody")).toBeNull();
    expect(await lockAttendeeRow(prisma, live.id, PREVIEW_EVENT_ID)).toBeNull();
  });

  it("waits for an open erasure and then reports the row as erased", async () => {
    const a = await createAttendee();
    const held = await holdErasure([a.id]);
    const locking = prisma.$transaction((tx) => lockAttendeeRow(tx, a.id));
    expect(await staysPending(locking)).toBe(true);
    await held.commit();
    expect(await locking).toMatchObject({ erased: true });
  });

  it("lockAttendeesForUpdate returns the ids of the event that exist, in id order, and nothing for an empty list", async () => {
    const a = await createAttendee();
    const b = await createAttendee();
    const ids = await prisma.$transaction((tx) => lockAttendeesForUpdate(tx, EVENT_ID, [b.id, "nobody", a.id]));
    expect(ids).toEqual([a.id, b.id].sort());
    expect(await prisma.$transaction((tx) => lockAttendeesForUpdate(tx, EVENT_ID, []))).toEqual([]);
    expect(await prisma.$transaction((tx) => lockAttendeesForUpdate(tx, PREVIEW_EVENT_ID, [a.id]))).toEqual([]);
  });

  it("lockAttendeesForUpdate makes an erasure wait for the transaction that holds it", async () => {
    const a = await createAttendee();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockedPromise = new Promise<void>((resolve) => (locked = resolve));
    const holding = prisma.$transaction(async (tx) => {
      await lockAttendeesForUpdate(tx, EVENT_ID, [a.id]);
      locked();
      await gate;
    });
    await lockedPromise;
    const erasing = erase([a.id]);
    expect(await staysPending(erasing)).toBe(true);
    release();
    await holding;
    expect((await erasing).erasedIds).toEqual([a.id]);
  });

  it("does not block an ordinary update of the attendee", async () => {
    const a = await createAttendee();
    await prisma.$transaction(async (tx) => {
      await lockAttendeeRow(tx, a.id);
      await prisma.attendee.update({ where: { id: a.id }, data: { rsvp_status: "accepted" } });
    });
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } })).rsvp_status).toBe("accepted");
  });
});

describe("check-in", () => {
  it("manual admit of an erased attendee is INVALID and writes nothing", async () => {
    const { a } = await admittedAttendee();
    await erase([a.id]);
    const before = await prisma.checkIn.count({ where: { attendee_id: a.id } });

    expect(await admitAttendee({ attendeeId: a.id, eventId: EVENT_ID, method: "manual", audit }, prisma)).toEqual({
      status: "INVALID",
      confirmed: false,
    });
    expect(await prisma.checkIn.count({ where: { attendee_id: a.id } })).toBe(before);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: a.id } })).toBe(0);
  });

  it("an admit that starts while the erasure is open waits, then finds the attendee erased", async () => {
    const a = await createAttendee();
    const held = await holdErasure([a.id]);
    const admitting = admitAttendee({ attendeeId: a.id, eventId: EVENT_ID, method: "manual", audit }, prisma);
    expect(await staysPending(admitting)).toBe(true);
    await held.commit();
    expect(await admitting).toMatchObject({ status: "INVALID" });
    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.admitted_at).toBeNull();
    expect(await prisma.checkIn.count({ where: { attendee_id: a.id } })).toBe(0);
  });

  it("a scan that resolved the ticket before the erasure gets INVALID and no check-in row (blocked pass)", async () => {
    const token = generateToken();
    const a = await createAttendee({ status: "cancelled", token_hash: hashToken(token) });
    const held = await holdErasure([a.id]);
    const scanning = checkInScan({ scanned: token, eventId: EVENT_ID, operator: "staff-1", deviceId: "Gate A" }, prisma);
    expect(await staysPending(scanning)).toBe(true);
    await held.commit();
    expect(await scanning).toEqual({ status: "INVALID", confirmed: false });
    expect(await prisma.checkIn.count({ where: { attendee_id: a.id } })).toBe(0);
  });

  it("a scan in preview mode that resolved the ticket before the erasure gets INVALID, no card and no activity entry", async () => {
    const token = generateToken();
    const a = await createAttendee({ event_id: PREVIEW_EVENT_ID, token_hash: hashToken(token) });
    const held = await holdErasure([a.id], PREVIEW_EVENT_ID);
    const scanning = checkInScan({ scanned: token, eventId: PREVIEW_EVENT_ID, operator: "staff-1", deviceId: "Gate A" }, prisma);
    expect(await staysPending(scanning)).toBe(true);
    await held.commit();
    expect(await scanning).toEqual({ status: "INVALID", confirmed: false });
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: a.id } })).toBe(0);
    expect(await prisma.attendeeItemState.count({ where: { attendee_id: a.id } })).toBe(0);
  });

  it("a scan in preview mode builds the card and writes its activity entry in one transaction, so no erasure can start between them", async () => {
    const token = generateToken();
    const a = await createAttendee({ event_id: PREVIEW_EVENT_ID, token_hash: hashToken(token) });
    const transactions = vi.spyOn(prisma, "$transaction");
    try {
      const result = await checkInScan(
        { scanned: token, eventId: PREVIEW_EVENT_ID, operator: "staff-1", deviceId: "Gate A" },
        prisma,
      );
      expect(result).toEqual(expect.objectContaining({ status: "PREVIEW", attendeeId: a.id }));
      expect(transactions).toHaveBeenCalledTimes(1);
    } finally {
      transactions.mockRestore();
    }
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: a.id, action_type: "scan_preview" } })).toBe(1);
  });

  it("a card requested while the erasure is open waits, then returns no card and leaves no item rows", async () => {
    const a = await createAttendee();
    const held = await holdErasure([a.id]);
    const requesting = getAttendeeCard(EVENT_ID, a.id, prisma);
    expect(await staysPending(requesting)).toBe(true);
    await held.commit();
    expect(await requesting).toBeNull();
    expect(await prisma.attendeeItemState.count({ where: { attendee_id: a.id } })).toBe(0);
  });

  it("an erased attendee has no card, is not found by the door search and is not in the recent list", async () => {
    const { a } = await admittedAttendee({ name: "Findable Zanzibar" });
    const live = await createAttendee({ name: "Erased Looking Name" });
    expect(await lookupAttendees(EVENT_ID, "Zanzibar", prisma)).toEqual([expect.objectContaining({ id: a.id })]);
    expect((await getRecentCheckIns(EVENT_ID, prisma, 100)).map((entry) => entry.attendee_id)).toContain(a.id);

    await erase([a.id]);

    expect(await getAttendeeCard(EVENT_ID, a.id, prisma)).toBeNull();
    expect(await lookupAttendees(EVENT_ID, "Zanzibar", prisma)).toEqual([]);
    expect((await lookupAttendees(EVENT_ID, "Erased", prisma)).map((r) => r.id)).toEqual([live.id]);
    expect((await getRecentCheckIns(EVENT_ID, prisma, 100)).map((entry) => entry.attendee_id)).not.toContain(a.id);
    // The attendee's pending item rows were not recreated by looking at the card.
    expect(await prisma.attendeeItemState.count({ where: { attendee_id: a.id } })).toBe(0);
  });
});

describe("undo and revoke of an admission", () => {
  it("undo of the last check-in on the device refuses an erased attendee and keeps the admission", async () => {
    const { a } = await admittedAttendee({}, "Gate U1");
    await erase([a.id]);
    await expect(undoLastCheckIn({ eventId: EVENT_ID, audit: { ...audit, deviceId: "Gate U1" } }, prisma)).rejects.toBeInstanceOf(
      UndoNotAllowedError,
    );
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } })).admitted_at).not.toBeNull();
  });

  describe("when an erased scan may have been the last one on the device", () => {
    const scanAt = async (time: string, device: string, overrides: Partial<Prisma.AttendeeUncheckedCreateInput> = {}) => {
      const a = await createAttendee({ admitted_at: new Date(time), admitted_by: "staff-1", ...overrides });
      await prisma.checkIn.create({
        data: { attendee_id: a.id, event_id: EVENT_ID, status: "VALID", source: "scan", device_id: device, checked_in_at: new Date(time) },
      });
      return a;
    };
    const undo = (device: string) => undoLastCheckIn({ eventId: EVENT_ID, audit: { ...audit, deviceId: device } }, prisma);

    it("refuses instead of undoing the older, live attendee (a 10:55 scan erased to 10:00 sorts behind a 10:30 one)", async () => {
      const live = await scanAt("2026-09-01T10:30:00Z", "Gate U10");
      const erased = await scanAt("2026-09-01T10:55:00Z", "Gate U10");
      await erase([erased.id]);

      await expect(undo("Gate U10")).rejects.toBeInstanceOf(UndoNotAllowedError);

      expect((await prisma.attendee.findUniqueOrThrow({ where: { id: live.id } })).admitted_at).not.toBeNull();
      expect(await prisma.checkIn.count({ where: { attendee_id: live.id, status: "UNDO" } })).toBe(0);
    });

    it("still undoes the last scan when the erased one is clearly older or on another device", async () => {
      const older = await scanAt("2026-09-01T07:10:00Z", "Gate U11");
      await erase([older.id]);
      const elsewhere = await scanAt("2026-09-01T11:50:00Z", "Gate U12");
      await erase([elsewhere.id]);
      const live = await scanAt("2026-09-01T11:30:00Z", "Gate U11");

      const result = await undo("Gate U11");

      expect(result.card.id).toBe(live.id);
      expect((await prisma.attendee.findUniqueOrThrow({ where: { id: live.id } })).admitted_at).toBeNull();
    });
  });

  it("an undo that starts while the erasure is open waits, then refuses and keeps the admission", async () => {
    const { a } = await admittedAttendee({}, "Gate U2");
    const held = await holdErasure([a.id]);
    const undoing = undoLastCheckIn({ eventId: EVENT_ID, audit: { ...audit, deviceId: "Gate U2" } }, prisma);
    expect(await staysPending(undoing)).toBe(true);
    await held.commit();
    await expect(undoing).rejects.toBeInstanceOf(UndoNotAllowedError);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } })).admitted_at).not.toBeNull();
    expect(await prisma.checkIn.count({ where: { attendee_id: a.id, status: "UNDO" } })).toBe(0);
  });

  it("a revoke that starts while the erasure is open waits, then refuses and keeps the admission", async () => {
    const { a } = await admittedAttendee();
    const held = await holdErasure([a.id]);
    const revoking = revokeCheckIn({ eventId: EVENT_ID, attendeeId: a.id, audit }, prisma);
    expect(await staysPending(revoking)).toBe(true);
    await held.commit();
    await expect(revoking).rejects.toBeInstanceOf(IllegalItemTransitionError);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } })).admitted_at).not.toBeNull();
    expect(await prisma.checkIn.count({ where: { attendee_id: a.id, status: "UNDO" } })).toBe(0);
  });

  it("clearing a stale admission without the item reset (the pass-status path) refuses too", async () => {
    const { a } = await admittedAttendee();
    await erase([a.id]);
    await expect(
      prisma.$transaction((tx) => revokeCheckInMutation({ eventId: EVENT_ID, attendeeId: a.id, audit, resetItems: false }, tx)),
    ).rejects.toBeInstanceOf(IllegalItemTransitionError);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } })).admitted_at).not.toBeNull();
  });

  it("revoke of the check-in refuses an erased attendee with an item error and keeps the admission", async () => {
    const { a } = await admittedAttendee();
    await erase([a.id]);
    const checkIns = await prisma.checkIn.count({ where: { attendee_id: a.id } });
    await expect(revokeCheckIn({ eventId: EVENT_ID, attendeeId: a.id, audit }, prisma)).rejects.toBeInstanceOf(
      IllegalItemTransitionError,
    );
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } })).admitted_at).not.toBeNull();
    expect(await prisma.checkIn.count({ where: { attendee_id: a.id } })).toBe(checkIns);
  });

  it("the event-wide revoke of all check-ins leaves erased attendees admitted and revokes the others", async () => {
    const event = await prisma.event.create({
      data: { id: "evt-erase-ops-bulk", title: "Bulk", slug: "erase-ops-bulk", organization_id: ORG_ID, date: new Date("2026-09-01T09:00:00Z") },
    });
    const erased = await createAttendee({ event_id: event.id, admitted_at: new Date("2026-09-01T10:15:00Z") });
    const live = await createAttendee({ event_id: event.id, admitted_at: new Date("2026-09-01T10:20:00Z") });
    await erase([erased.id], event.id);

    // One transaction: the erased attendee is not even scheduled.
    const spy = vi.spyOn(prisma, "$transaction");
    let revoked: number;
    try {
      revoked = await revokeAllCheckInsForEvent(prisma, { eventId: event.id, audit });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }

    expect(revoked).toBe(1);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: erased.id } })).admitted_at).not.toBeNull();
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: live.id } })).admitted_at).toBeNull();
  });
});

describe("item hand-outs", () => {
  // Admitted, so erasure leaves the status as it was and only the erased marker can stop a revoke.
  const issuedBadge = async () => {
    const a = await createAttendee({ admitted_at: new Date("2026-09-01T10:15:00Z") });
    await prisma.attendeeItemState.create({ data: { attendee_id: a.id, event_item_id: badgeItemId, state: "issued" } });
    return a;
  };

  it("refuses to issue or revoke an item for an erased attendee, and writes no log", async () => {
    const a = await issuedBadge();
    await erase([a.id]);
    await expect(
      transitionItemState({ attendeeId: a.id, eventId: EVENT_ID, itemKey: "badge", targetState: "returned", audit }, prisma),
    ).rejects.toBeInstanceOf(IllegalItemTransitionError);
    await expect(revokeItemState({ attendeeId: a.id, eventId: EVENT_ID, itemKey: "badge", audit }, prisma)).rejects.toBeInstanceOf(
      IllegalItemTransitionError,
    );
    expect((await prisma.attendeeItemState.findFirstOrThrow({ where: { attendee_id: a.id } })).state).toBe("issued");
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: a.id } })).toBe(0);
  });

  it("an item change that starts while the erasure is open waits and is then refused", async () => {
    const a = await createAttendee();
    const held = await holdErasure([a.id]);
    const issuing = transitionItemState({ attendeeId: a.id, eventId: EVENT_ID, itemKey: "badge", targetState: "issued", audit }, prisma);
    expect(await staysPending(issuing)).toBe(true);
    await held.commit();
    await expect(issuing).rejects.toBeInstanceOf(IllegalItemTransitionError);
    expect(await prisma.attendeeItemState.count({ where: { attendee_id: a.id } })).toBe(0);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: a.id } })).toBe(0);
  });

  it("the event-wide and the selection revoke leave an erased attendee's hand-outs, and still reset the others", async () => {
    const erased = await issuedBadge();
    const live = await issuedBadge();
    await erase([erased.id]);

    expect(await revokeItemsForAttendees(prisma, { eventId: EVENT_ID, attendeeIds: [erased.id], audit })).toBe(0);
    expect(await revokeAllItemsForEvent(prisma, { eventId: EVENT_ID, audit })).toBeGreaterThanOrEqual(1);

    expect((await prisma.attendeeItemState.findFirstOrThrow({ where: { attendee_id: erased.id } })).state).toBe("issued");
    expect((await prisma.attendeeItemState.findFirstOrThrow({ where: { attendee_id: live.id } })).state).toBe("pending");
  });
});

describe("notes", () => {
  it("adds no note to an erased attendee, and cannot edit or delete one", async () => {
    const a = await createAttendee();
    const note = await prisma.attendeeNote.create({
      data: { attendee_id: a.id, event_id: EVENT_ID, author_user_id: "staff-1", body: "before" },
    });
    await erase([a.id]);
    await expect(addAttendeeNote({ attendeeId: a.id, eventId: EVENT_ID, body: "after", audit }, prisma)).rejects.toBeInstanceOf(
      AttendeeNotFoundError,
    );
    await expect(
      updateAttendeeNote({ attendeeId: a.id, eventId: EVENT_ID, noteId: note.id, body: "edit", audit }, prisma),
    ).rejects.toBeInstanceOf(NoteNotFoundError);
    await expect(
      deleteAttendeeNote({ attendeeId: a.id, eventId: EVENT_ID, noteId: note.id, canDeleteAnyNote: true, audit }, prisma),
    ).rejects.toBeInstanceOf(NoteNotFoundError);
    expect(await prisma.attendeeNote.count({ where: { attendee_id: a.id } })).toBe(0);
  });

  it("editing or deleting a note while the erasure is open waits, then finds no note", async () => {
    const a = await createAttendee();
    const note = await prisma.attendeeNote.create({
      data: { attendee_id: a.id, event_id: EVENT_ID, author_user_id: "staff-1", body: "before" },
    });
    const held = await holdErasure([a.id]);
    const editing = updateAttendeeNote({ attendeeId: a.id, eventId: EVENT_ID, noteId: note.id, body: "edit", audit }, prisma);
    const deleting = deleteAttendeeNote({ attendeeId: a.id, eventId: EVENT_ID, noteId: note.id, canDeleteAnyNote: true, audit }, prisma);
    expect(await staysPending(editing)).toBe(true);
    expect(await staysPending(deleting)).toBe(true);
    await held.commit();
    await expect(editing).rejects.toBeInstanceOf(NoteNotFoundError);
    await expect(deleting).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it("a note typed while the erasure is open does not survive it", async () => {
    const a = await createAttendee();
    const held = await holdErasure([a.id]);
    const adding = addAttendeeNote({ attendeeId: a.id, eventId: EVENT_ID, body: "late note", audit }, prisma);
    expect(await staysPending(adding)).toBe(true);
    await held.commit();
    await expect(adding).rejects.toBeInstanceOf(AttendeeNotFoundError);
    expect(await prisma.attendeeNote.count({ where: { attendee_id: a.id } })).toBe(0);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: a.id } })).toBe(0);
  });

  it("still works for a live attendee", async () => {
    const a = await createAttendee();
    const added = await addAttendeeNote({ attendeeId: a.id, eventId: EVENT_ID, body: "hello", audit }, prisma);
    const edited = await updateAttendeeNote({ attendeeId: a.id, eventId: EVENT_ID, noteId: added.id, body: "hello again", audit }, prisma);
    expect(edited.body).toBe("hello again");
    await deleteAttendeeNote({ attendeeId: a.id, eventId: EVENT_ID, noteId: added.id, canDeleteAnyNote: false, audit }, prisma);
    expect(await prisma.attendeeNote.count({ where: { attendee_id: a.id } })).toBe(0);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: a.id } })).toBe(3);
  });
});

describe("activity log", () => {
  it("writeActionLog and writeActionLogMany skip erased attendees and write for the others", async () => {
    const erased = await createAttendee();
    const live = await createAttendee();
    await erase([erased.id]);

    await prisma.$transaction(async (tx) => {
      await writeActionLog(tx, { event_id: EVENT_ID, attendee_id: erased.id, action_type: "ticket_resent", audit });
      await writeActionLog(tx, { event_id: EVENT_ID, attendee_id: live.id, action_type: "ticket_resent", audit });
      await writeActionLogMany(tx, {
        event_id: EVENT_ID,
        action_type: "pass_revoked",
        audit,
        entries: [{ attendee_id: erased.id }, { attendee_id: live.id }],
      });
    });

    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: erased.id } })).toBe(0);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: live.id } })).toBe(2);
  });

  it("a batch of entries written while the erasure is open is not kept for the erased attendee", async () => {
    const erased = await createAttendee();
    const live = await createAttendee();
    const held = await holdErasure([erased.id]);
    const logging = prisma.$transaction((tx) =>
      writeActionLogMany(tx, {
        event_id: EVENT_ID,
        action_type: "pass_revoked",
        audit,
        entries: [{ attendee_id: erased.id }, { attendee_id: live.id }],
      }),
    );
    expect(await staysPending(logging)).toBe(true);
    await held.commit();
    await logging;
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: erased.id } })).toBe(0);
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: live.id } })).toBe(1);
  });

  it("still fails on the foreign key for an attendee that does not exist", async () => {
    await expect(
      prisma.$transaction((tx) => writeActionLog(tx, { event_id: EVENT_ID, attendee_id: "nobody", action_type: "ticket_resent", audit })),
    ).rejects.toThrow();
  });

  it("an entry written while the erasure is open is not kept", async () => {
    const a = await createAttendee();
    const held = await holdErasure([a.id]);
    const logging = prisma.$transaction((tx) =>
      writeActionLog(tx, { event_id: EVENT_ID, attendee_id: a.id, action_type: "ticket_resent", audit }),
    );
    expect(await staysPending(logging)).toBe(true);
    await held.commit();
    await logging;
    expect(await prisma.attendeeActionLog.count({ where: { attendee_id: a.id } })).toBe(0);
  });
});
