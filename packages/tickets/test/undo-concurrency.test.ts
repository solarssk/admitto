import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pollDelay } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { admitAttendee } from "../src/admit.js";
import { undoLastCheckIn, UndoNotAllowedError, revokeCheckIn } from "../src/undo.js";
import { eraseAttendees } from "../src/erase-attendees.js";
import { removeAttendees } from "../src/remove-attendees.js";
import { addAttendeeNote } from "../src/notes.js";
import type { AdmitResult } from "../src/types.js";

// A fresh migrated schema preserves real constraints without resetting another suite's tables.
const schema = `undo_revision_${randomUUID().replaceAll("-", "")}`;
const clients: PrismaClient[] = [];
let db: PrismaClient;
let admin: PrismaClient;
let url: string;
let sequence = 0;

function connection() {
  const client = createTestPrismaClient(url, schema);
  clients.push(client);
  return client;
}

function gate() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return { waiting, release };
}

beforeAll(() => {
  url = process.env.DATABASE_URL ?? "";
  assertTestDatabaseUrl(url);
  const migratedUrl = new URL(url);
  migratedUrl.searchParams.set("schema", schema);
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), "../../db"),
    env: { ...process.env, DATABASE_URL: migratedUrl.toString() }, stdio: "pipe",
  });
  admin = createTestPrismaClient(url);
  db = connection();
}, 30_000);

afterEach(() => vi.useRealTimers());

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  if (admin) {
    // The identifier is generated above, never derived from request or fixture data.
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});

function admissionTime(result: AdmitResult): Date {
  expect(result.status).toBe("VALID");
  if (result.status !== "VALID") throw new Error("Expected a new admission");
  return result.admittedAt;
}

async function fixture() {
  const n = ++sequence;
  const org = await db.organization.create({ data: { name: "Undo Test", slug: `undo-org-${n}` } });
  const event = await db.event.create({ data: {
    organization_id: org.id, title: "Undo Test", slug: `undo-event-${n}`,
    date: new Date("2026-10-12T10:00:00Z"),
    ops_config: { badge_at_entry: true, require_confirm_on_scan: false },
  } });
  await db.eventItem.create({ data: { event_id: event.id, key: "badge", label: "Badge", config: { issue_on_checkin: true } } });
  const attendee = await db.attendee.create({ data: {
    event_id: event.id, email: `undo-${n}@example.com`, name: "Synthetic Guest", status: "confirmed",
  } });
  const audit = { operator: "synthetic-operator", deviceId: `undo-device-${n}` };
  const admit = (client = db, deviceId = audit.deviceId, method: "scan" | "manual" = "manual") => admitAttendee({
    eventId: event.id, attendeeId: attendee.id, method, audit: { ...audit, deviceId },
  }, client);
  const undo = (client = db) => undoLastCheckIn({ eventId: event.id, audit }, client);
  return { event, attendee, audit, admit, undo };
}

/** Rewrites the id of every check-in created through this client so it sorts after any natural id. */
function highIdAdmissionClient() {
  const client = connection();
  const transaction = client.$transaction.bind(client);
  return new Proxy(client, {
    get(target, key, receiver) {
      if (key !== "$transaction") return Reflect.get(target, key, receiver);
      return <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => transaction(async (tx) => {
        const checkIn = new Proxy(tx.checkIn, {
          get(delegate, method, delegateReceiver) {
            if (method !== "create") return Reflect.get(delegate, method, delegateReceiver);
            return async (args: Prisma.CheckInCreateArgs) => {
              const created = await delegate.create(args);
              const { data: _data, ...selection } = args;
              return delegate.update({
                ...selection, where: { id: created.id },
                data: { id: created.id.slice(0, 9) + "zzzz" + created.id.slice(13) },
              });
            };
          },
        });
        return operation(new Proxy(tx, {
          get(actual, property, actualReceiver) {
            return property === "checkIn" ? checkIn : Reflect.get(actual, property, actualReceiver);
          },
        }));
      });
    },
  });
}

/** Pause a real query's dispatch/result; every query and transaction still uses PostgreSQL. */
function pauseMutation(point: "selection" | "clear") {
  const reached = gate();
  const release = gate();
  const client = connection();
  const transaction = client.$transaction.bind(client);
  let paused = false;
  const wrapped = new Proxy(client, {
    get(target, key, receiver) {
      if (key !== "$transaction") return Reflect.get(target, key, receiver);
      return <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => transaction(async (tx) => {
        const checkIn = new Proxy(tx.checkIn, {
          get(delegate, method, delegateReceiver) {
            if (point === "selection" && method === "findFirst") {
              return async (args: Prisma.CheckInFindFirstArgs) => {
                const result = await delegate.findFirst(args);
                if (!paused) { paused = true; reached.release(); await release.waiting; }
                return result;
              };
            }
            return Reflect.get(delegate, method, delegateReceiver);
          },
        });
        const attendee = new Proxy(tx.attendee, {
          get(delegate, method, delegateReceiver) {
            if (point === "clear" && method === "updateMany") {
              return async (args: Prisma.AttendeeUpdateManyArgs) => {
                reached.release(); await release.waiting;
                return delegate.updateMany(args);
              };
            }
            return Reflect.get(delegate, method, delegateReceiver);
          },
        });
        return operation(new Proxy(tx, {
          get(actual, property, actualReceiver) {
            if (property === "checkIn") return checkIn;
            if (property === "attendee") return attendee;
            return Reflect.get(actual, property, actualReceiver);
          },
        }));
      }, { timeout: 20_000 });
    },
  });
  return { client: wrapped, reached: reached.waiting, release: release.release };
}

/** Poll database lock state, not elapsed time, to establish the actual interleaving. */
async function completionOrLock(completed: () => boolean, minimum = 1) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    if (completed()) return "completed";
    const rows = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND (position('Attendee' IN query) > 0 OR position('pg_advisory_xact_lock' IN query) > 0)
    `;
    if (Number(rows[0]?.count ?? 0) >= minimum) return "blocked";
    await pollDelay(20);
  }
  throw new Error("No real PostgreSQL waiter or completed operation observed");
}

describe("undo admission serialization (real migrated PostgreSQL)", () => {
  it.each([false, true])("keeps one reversal and a fresh admission despite overlapping undo (fixed clock: %s)", async (fixedClock) => {
    if (fixedClock) { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-12T12:00:00Z")); }
    const f = await fixture();
    expect((await f.admit()).status).toBe("VALID");
    const paused = pauseMutation("clear");
    const first = Promise.allSettled([f.undo(paused.client)]);
    await paused.reached;
    let finished = false;
    const second = Promise.allSettled([f.undo(connection())]).then((result) => { finished = true; return result; });
    let interleaving: string;
    let newer: Date | undefined;
    try {
      interleaving = await completionOrLock(() => finished);
      // On vulnerable code the second undo commits before the old dispatch resumes.
      if (interleaving === "completed") newer = admissionTime(await f.admit(db, "newer-device"));
    } finally {
      paused.release();
    }
    const [firstResult] = await first;
    const [secondResult] = await second;
    if (!newer) newer = admissionTime(await f.admit(db, "newer-device"));
    expect(firstResult.status).toBe("fulfilled");
    expect.soft(interleaving!).toBe("blocked");
    expect.soft(secondResult.status).toBe("rejected");
    if (secondResult.status === "rejected") expect(secondResult.reason).toBeInstanceOf(UndoNotAllowedError);
    expect.soft((await db.attendee.findUniqueOrThrow({ where: { id: f.attendee.id } })).admitted_at).toEqual(newer);
    expect.soft(await db.checkIn.count({ where: { attendee_id: f.attendee.id, status: "UNDO" } })).toBe(1);
    expect((await f.admit()).status).toBe("ALREADY_CHECKED_IN");
    expect(await db.attendeeActionLog.count({ where: { attendee_id: f.attendee.id, action_type: "check_in_undo" } })).toBe(1);
    expect(await db.attendeeItemState.count({ where: { attendee_id: f.attendee.id, state: "issued" } })).toBe(1);
  });

  it.each(["scan", "manual"] as const)("serializes the device's latest-admission decision with another guest's %s", async (method) => {
    const f = await fixture();
    await f.admit();
    const secondGuest = await db.attendee.create({ data: {
      event_id: f.event.id, email: `second-${++sequence}@example.com`, name: "Second Synthetic Guest", status: "confirmed",
    } });
    const paused = pauseMutation("selection");
    const first = Promise.allSettled([f.undo(paused.client)]);
    await paused.reached;
    let finished = false;
    const second = Promise.allSettled([admitAttendee({
      eventId: f.event.id, attendeeId: secondGuest.id, method, audit: f.audit,
    }, connection())]).then((result) => { finished = true; return result; });
    let interleaving: string;
    try { interleaving = await completionOrLock(() => finished); }
    finally { paused.release(); }
    expect((await first)[0].status).toBe("fulfilled");
    const [secondResult] = await second;
    expect(secondResult.status).toBe("fulfilled");
    if (secondResult.status !== "fulfilled") throw new Error("Expected the later admission to succeed");
    expect(secondResult.value.status).toBe("VALID");
    expect(interleaving!).toBe("blocked");
    expect((await db.attendee.findUniqueOrThrow({ where: { id: secondGuest.id } })).admitted_at).not.toBeNull();
    expect(await db.checkIn.count({ where: { attendee_id: secondGuest.id, status: "UNDO" } })).toBe(0);
    expect((await f.undo()).card.id).toBe(secondGuest.id);
    expect((await db.attendee.findUniqueOrThrow({ where: { id: secondGuest.id } })).admitted_at).toBeNull();
  });

  it.each(["another device", "another event"] as const)("allows independent admission on %s while undo holds its device lock", async (scope) => {
    const f = await fixture();
    await f.admit();
    const other = await fixture();
    const eventId = scope === "another event" ? other.event.id : f.event.id;
    const guest = await db.attendee.create({ data: {
      event_id: eventId, email: `independent-${++sequence}@example.com`, name: "Independent Synthetic Guest", status: "confirmed",
    } });
    const paused = pauseMutation("selection");
    const undo = Promise.allSettled([f.undo(paused.client)]);
    await paused.reached;
    let finished = false;
    const admission = Promise.allSettled([admitAttendee({
      eventId, attendeeId: guest.id, method: "manual",
      audit: { ...f.audit, deviceId: scope === "another device" ? other.audit.deviceId : f.audit.deviceId },
    }, connection())]).then((result) => { finished = true; return result; });
    let interleaving: string;
    try { interleaving = await completionOrLock(() => finished); }
    finally { paused.release(); }
    expect((await undo)[0].status).toBe("fulfilled");
    const [result] = await admission;
    expect(result.status).toBe("fulfilled");
    if (result.status === "fulfilled") expect(result.value.status).toBe("VALID");
    expect(interleaving!).toBe("completed");
  });

  it("selects the newer guest when their admission commits before undo starts", async () => {
    const f = await fixture();
    await f.admit();
    const secondGuest = await db.attendee.create({ data: {
      event_id: f.event.id, email: `latest-${++sequence}@example.com`, name: "Latest Synthetic Guest", status: "confirmed",
    } });
    await admitAttendee({ eventId: f.event.id, attendeeId: secondGuest.id, method: "manual", audit: f.audit }, db);
    expect((await f.undo()).card.id).toBe(secondGuest.id);
    expect((await db.attendee.findUniqueOrThrow({ where: { id: f.attendee.id } })).admitted_at).not.toBeNull();
  });

  it("refuses a selected old admission when admin revoke and re-admission commit before its row lock", async () => {
    const f = await fixture();
    await f.admit();
    const paused = pauseMutation("selection");
    const stale = Promise.allSettled([f.undo(paused.client)]);
    await paused.reached;
    let newer: Date | undefined;
    try {
      await revokeCheckIn({ eventId: f.event.id, attendeeId: f.attendee.id, audit: f.audit }, db);
      newer = admissionTime(await f.admit(db, "another-device"));
    } finally { paused.release(); }
    const [result] = await stale;
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBeInstanceOf(UndoNotAllowedError);
    expect((await db.attendee.findUniqueOrThrow({ where: { id: f.attendee.id } })).admitted_at).toEqual(newer);
    expect(await db.checkIn.count({ where: { attendee_id: f.attendee.id, status: "UNDO" } })).toBe(1);
  });

  it("refuses a revoked selection with equal times and a synthetically higher original ID", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    const f = await fixture();
    const seededClient = highIdAdmissionClient();
    await f.admit(seededClient);
    const firstAdmission = await db.checkIn.findFirstOrThrow({
      where: { attendee_id: f.attendee.id, status: "VALID" },
    });
    const seededId = firstAdmission.id;
    const paused = pauseMutation("selection");
    const stale = Promise.allSettled([f.undo(paused.client)]);
    await paused.reached;
    let newer: Date | undefined;
    try {
      await revokeCheckIn({ eventId: f.event.id, attendeeId: f.attendee.id, audit: f.audit }, db);
      newer = admissionTime(await f.admit(db, "another-device"));
      const replacement = await db.checkIn.findFirstOrThrow({
        where: { attendee_id: f.attendee.id, status: "VALID", id: { not: seededId } },
      });
      expect(firstAdmission.checked_in_at).toBeInstanceOf(Date);
      expect(replacement.checked_in_at).toBeInstanceOf(Date);
      expect(replacement.checked_in_at.getTime()).toBe(firstAdmission.checked_in_at.getTime());
      expect(replacement.id < seededId).toBe(true);
    } finally { paused.release(); }
    const [result] = await stale;
    expect.soft(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBeInstanceOf(UndoNotAllowedError);
    expect.soft((await db.attendee.findUniqueOrThrow({ where: { id: f.attendee.id } })).admitted_at).toEqual(newer);
    expect.soft(await db.checkIn.count({ where: { attendee_id: f.attendee.id, status: "UNDO" } })).toBe(1);
    expect.soft(await db.attendeeActionLog.count({ where: { attendee_id: f.attendee.id, action_type: "check_in_undo" } })).toBe(0);
    expect.soft(await db.attendeeItemState.count({ where: { attendee_id: f.attendee.id, state: "issued" } })).toBe(1);
    expect.soft((await f.admit(db, "post-stale-device")).status).toBe("ALREADY_CHECKED_IN");
    // The replacement can still be undone from the device that admitted it.
    await undoLastCheckIn({ eventId: f.event.id, audit: { ...f.audit, deviceId: "another-device" } }, db);
    expect((await db.attendee.findUniqueOrThrow({ where: { id: f.attendee.id } })).admitted_at).toBeNull();
    expect(await db.checkIn.count({ where: { attendee_id: f.attendee.id, status: "UNDO" } })).toBe(2);
  });

  it.each(["equal times, reversed IDs", "equal times, natural IDs", "real clock"] as const)("second revoke names the live admission and protects its replacement (%s)", async (mode) => {
    if (mode !== "real clock") {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    }
    const f = await fixture();
    const validOn = (deviceId: string) => db.checkIn.findFirstOrThrow({
      where: { attendee_id: f.attendee.id, status: "VALID", device_id: deviceId },
    });
    const revoke = () => revokeCheckIn({ eventId: f.event.id, attendeeId: f.attendee.id, audit: f.audit }, db);
    await f.admit(mode === "equal times, reversed IDs" ? highIdAdmissionClient() : db, "device-a");
    const a = await validOn("device-a");
    await revoke();
    await f.admit(db, "device-b");
    const b = await validOn("device-b");
    const paused = pauseMutation("selection");
    const stale = Promise.allSettled([undoLastCheckIn({ eventId: f.event.id, audit: { ...f.audit, deviceId: "device-b" } }, paused.client)]);
    await paused.reached;
    let replacement: Date | undefined;
    try {
      await revoke();
      replacement = admissionTime(await f.admit(db, "device-c"));
    } finally { paused.release(); }
    const [result] = await stale;
    if (mode === "equal times, reversed IDs") {
      expect(b.id < a.id).toBe(true);
      expect(b.checked_in_at).toEqual(a.checked_in_at);
      expect(replacement).toEqual(b.checked_in_at);
    }
    const markers = await db.attendeeActionLog.findMany({
      where: { attendee_id: f.attendee.id, action_type: "check_in_revoked" }, select: { metadata: true },
    });
    const named = markers.map((log) => (log.metadata as { undone_check_in_id?: string } | null)?.undone_check_in_id).sort();
    expect.soft(named).toEqual([a.id, b.id].sort());
    expect.soft(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBeInstanceOf(UndoNotAllowedError);
    expect.soft((await db.attendee.findUniqueOrThrow({ where: { id: f.attendee.id } })).admitted_at).toEqual(replacement);
    expect.soft(await db.checkIn.count({ where: { attendee_id: f.attendee.id, status: "UNDO" } })).toBe(2);
    expect.soft(await db.attendeeActionLog.count({ where: { attendee_id: f.attendee.id, action_type: "check_in_undo" } })).toBe(0);
    expect.soft(await db.attendeeItemState.count({ where: { attendee_id: f.attendee.id, state: "issued" } })).toBe(1);
    expect.soft((await f.admit(db, "device-d")).status).toBe("ALREADY_CHECKED_IN");
  });

  it("serializes concurrent admin revokes and records one reversal", async () => {
    const f = await fixture();
    await f.admit();
    const paused = pauseMutation("clear");
    const params = { eventId: f.event.id, attendeeId: f.attendee.id, audit: f.audit };
    const first = Promise.allSettled([revokeCheckIn(params, paused.client)]);
    await paused.reached;
    let finished = false;
    const second = Promise.allSettled([revokeCheckIn(params, connection())]).then((result) => { finished = true; return result; });
    let interleaving: string;
    try { interleaving = await completionOrLock(() => finished); }
    finally { paused.release(); }
    expect((await first)[0].status).toBe("fulfilled");
    const [result] = await second;
    expect(interleaving!).toBe("blocked");
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBeInstanceOf(UndoNotAllowedError);
    expect(await db.checkIn.count({ where: { attendee_id: f.attendee.id, status: "UNDO" } })).toBe(1);
    expect(await db.attendeeActionLog.count({ where: { attendee_id: f.attendee.id, action_type: "check_in_revoked" } })).toBe(1);
  });

  it("admits exactly once when concurrent scan/manual requests wait on the same real row", async () => {
    const f = await fixture();
    const ready = gate();
    const release = gate();
    const holding = connection().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Attendee" WHERE "id" = ${f.attendee.id} FOR UPDATE`;
      ready.release(); await release.waiting;
    }, { timeout: 20_000 });
    await ready.waiting;
    const admissions = Promise.allSettled(Array.from({ length: 4 }, (_, n) =>
      f.admit(connection(), `scan-device-${n}`, n % 2 ? "scan" : "manual")));
    try { expect(await completionOrLock(() => false, 4)).toBe("blocked"); }
    finally { release.release(); await holding; }
    const results = await admissions;
    const statuses = results.map((result) => result.status === "fulfilled" ? result.value.status : "FAILED");
    expect(statuses.filter((status) => status === "VALID")).toHaveLength(1);
    expect(statuses.filter((status) => status === "ALREADY_CHECKED_IN")).toHaveLength(3);
    expect(await db.checkIn.count({ where: { attendee_id: f.attendee.id, status: "VALID" } })).toBe(1);
    expect(await db.attendeeActionLog.count({ where: { attendee_id: f.attendee.id, action_type: "check_in" } })).toBe(1);
    expect(await db.attendeeItemState.count({ where: { attendee_id: f.attendee.id, state: "issued" } })).toBe(1);
  });

  it("allows undo to finish while a note transaction holds the erasure guard", async () => {
    const f = await fixture();
    await f.admit();
    const ready = gate();
    const release = gate();
    const client = connection();
    const transaction = client.$transaction.bind(client);
    const held = new Proxy(client, {
      get(target, key, receiver) {
        if (key !== "$transaction") return Reflect.get(target, key, receiver);
        return <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => transaction(async (tx) => {
          const result = await operation(tx);
          ready.release(); await release.waiting;
          return result;
        }, { timeout: 20_000 });
      },
    });
    const note = addAttendeeNote({ eventId: f.event.id, attendeeId: f.attendee.id, audit: f.audit, body: "Synthetic note" }, held);
    await ready.waiting;
    let finished = false;
    const undo = Promise.allSettled([f.undo(connection())]).then((result) => { finished = true; return result; });
    let interleaving: string;
    try { interleaving = await completionOrLock(() => finished); }
    finally { release.release(); await note; }
    const [result] = await undo;
    expect(interleaving!).toBe("completed");
    expect(result.status).toBe("fulfilled");
    expect(await db.attendeeNote.count({ where: { attendee_id: f.attendee.id } })).toBe(1);
  });

  it("supports ordinary undo, rejects a repeated undo and allows re-admission", async () => {
    const f = await fixture();
    await f.admit();
    expect((await f.undo()).card.check_in_status).toBe("not_admitted");
    await expect(f.undo()).rejects.toBeInstanceOf(UndoNotAllowedError);
    expect((await f.admit()).status).toBe("VALID");
  });

  it("does not undo another device's admission", async () => {
    const f = await fixture();
    await f.admit(db, "other-device");
    await expect(f.undo()).rejects.toBeInstanceOf(UndoNotAllowedError);
    expect((await f.admit()).status).toBe("ALREADY_CHECKED_IN");
  });

  it.each(["erase", "remove"] as const)("refuses a selected attendee after %s commits", async (action) => {
    const f = await fixture();
    await f.admit();
    const paused = pauseMutation("selection");
    const stale = Promise.allSettled([f.undo(paused.client)]);
    await paused.reached;
    try {
      if (action === "erase") await db.$transaction((tx) => eraseAttendees(tx, { eventId: f.event.id, attendeeIds: [f.attendee.id] }));
      else await db.$transaction((tx) => removeAttendees(tx, { eventId: f.event.id, attendeeIds: [f.attendee.id] }));
    } finally { paused.release(); }
    const [result] = await stale;
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBeInstanceOf(UndoNotAllowedError);
    expect(await db.checkIn.count({ where: { attendee_id: f.attendee.id, status: "UNDO" } })).toBe(0);
  });

  it("rolls back the admission, badge and audit changes if undo fails before commit", async () => {
    const f = await fixture();
    await f.admit();
    const before = await db.attendee.findUniqueOrThrow({ where: { id: f.attendee.id } });
    const client = connection();
    const transaction = client.$transaction.bind(client);
    const failing = new Proxy(client, {
      get(target, key, receiver) {
        if (key !== "$transaction") return Reflect.get(target, key, receiver);
        return <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => transaction(async (tx) => {
          await operation(tx);
          throw new Error("Synthetic failure before commit");
        });
      },
    });
    await expect(f.undo(failing)).rejects.toThrow("Synthetic failure before commit");
    expect((await db.attendee.findUniqueOrThrow({ where: { id: f.attendee.id } })).admitted_at).toEqual(before.admitted_at);
    expect(await db.checkIn.count({ where: { attendee_id: f.attendee.id, status: "UNDO" } })).toBe(0);
    expect(await db.attendeeActionLog.count({ where: { attendee_id: f.attendee.id, action_type: "check_in_undo" } })).toBe(0);
    expect(await db.attendeeItemState.count({ where: { attendee_id: f.attendee.id, state: "issued" } })).toBe(1);
  });
});
