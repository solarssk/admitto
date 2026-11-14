import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as pollDelay } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { commitImport, executeImportCommit, ImportCapacityExceededError } from "@admitto/import";
import { admitRegistrations, countSeatsInUse, deleteRegistrations, eraseAttendees } from "@admitto/tickets";
import { handleCreateEventAttendee, handlePatchEventAttendee } from "../../src/admin/attendees-api-routes.js";

let db: PrismaClient;
let eventId: string;
let orgId: string;
let userId: string;
let sequence = 0;
const clients: PrismaClient[] = [];
function connection() {
  const client = createTestPrismaClient();
  clients.push(client);
  return client;
}
function gate() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return { waiting, release };
}

// The integration runner provisions migrated PostgreSQL schemas, one per worker.
beforeAll(() => { db = connection(); });
beforeEach(async () => {
  const id = randomUUID();
  const org = await db.organization.create({ data: { name: "Capacity Test", slug: `capacity-${id}` } });
  orgId = org.id;
  const event = await db.event.create({ data: {
    organization_id: orgId, title: "Capacity Test", slug: `capacity-${id}`,
    date: new Date("2026-10-13T10:00:00Z"), capacity: 1,
  } });
  eventId = event.id;
  const user = await db.user.create({ data: { email: `capacity-${id}@example.com`, password_hash: "synthetic-unused" } });
  userId = user.id;
  await db.roleAssignment.create({ data: { user_id: userId, role: "admin", scope_type: "organization", scope_id: orgId } });
});
afterEach(async () => {
  await db.adminAuditLog.deleteMany({ where: { actor_user_id: userId } });
  await db.attendee.deleteMany({ where: { event_id: eventId } });
  await db.event.delete({ where: { id: eventId } });
  await db.user.delete({ where: { id: userId } });
  await db.organization.delete({ where: { id: orgId } });
  // The clients a test opened (the paused and the observed one) are done: only the shared client stays, so that this
  // file does not hold a connection per pair of writers until its end.
  await Promise.all(clients.splice(1).map((client) => client.$disconnect()));
});
afterAll(async () => { await Promise.all(clients.map((client) => client.$disconnect())); });

type Writer = "manual" | "import" | "direct" | "registration";
async function write(kind: Writer, client = db, force = false, targetEventId = eventId, bringsCompanion = false): Promise<"created" | "event_full"> {
  const email = `capacity-entry-${++sequence}@example.com`;
  if (kind === "manual") {
    // Exercise the real handler after authentication, including its own role/capacity checks.
    const app = new Hono();
    app.post("/events/:eventId/attendees", (c) => {
      c.set("auth", { userId });
      return handleCreateEventAttendee(c, client);
    });
    const response = await app.request(`/events/${targetEventId}/attendees${force ? "?force=1" : ""}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name: "Synthetic", last_name: "Manual", email }),
    });
    if (response.status === 201) return "created";
    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe("event_full");
    return "event_full";
  }
  if (kind === "registration") {
    // An organiser admits a guest's registration: the shared function of @admitto/tickets, under the same lock.
    const registration = await client.registration.create({
      data: {
        event_id: targetEventId, email, first_name: "Synthetic", last_name: "Registration",
        name: "Synthetic Registration", status: "pending",
        companions: bringsCompanion ? [{ name: "Synthetic Companion", custom_data: {} }] : [],
      },
    });
    const result = await admitRegistrations(client, { eventId: targetEventId, ids: [registration.id], actor: { operator: userId } });
    if (result.status === "not_enough_seats") return "event_full";
    expect(result.outcomes[0]?.outcome).toBe("accepted");
    return "created";
  }
  try {
    const result = kind === "direct"
      ? await commitImport(targetEventId, [{ rowIndex: 1, first_name: "Synthetic", last_name: "Direct", email }], {}, client)
      : await executeImportCommit(client, {
      eventId: targetEventId, csv: `first_name,last_name,email\nSynthetic,Import,${email}`,
      overwrite: false, forceCapacity: force, actorUserId: userId, sessionId: null,
      timezone: "Europe/Warsaw", filename: "synthetic-capacity.csv", importId: randomUUID(),
    });
    expect(result.created).toBe(1);
    return "created";
  } catch (error) {
    if (!(error instanceof ImportCapacityExceededError)) throw error;
    expect(error.code).toBe("event_full");
    return "event_full";
  }
}

/** Whether a raw query is the count of the seats of the event (countSeatsInUse): over the attendees and their companions, for this event. */
function isSeatCount(strings: readonly string[], values: readonly unknown[]): boolean {
  return strings.some((piece) => piece.includes('"AttendeeCompanion"')) && values.includes(eventId);
}

/** Pause after a real count result, retaining the real transaction and its locks. */
function pauseCapacityRead() {
  const reached = gate();
  const release = gate();
  const client = connection();
  const transaction = client.$transaction.bind(client);
  let paused = false;
  const wrapped = new Proxy(client, {
    get(target, key, receiver) {
      if (key !== "$transaction") return Reflect.get(target, key, receiver);
      return <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number; maxWait?: number }) => transaction(async (tx) => {
        const queryRaw = async (strings: readonly string[], ...values: unknown[]) => {
          const rows: unknown = await Reflect.apply(tx.$queryRaw, tx, [strings, ...values]);
          if (!paused && isSeatCount(strings, values)) {
            paused = true; reached.release(); await release.waiting;
          }
          return rows;
        };
        return operation(new Proxy(tx, {
          get(actual, property, actualReceiver) {
            return property === "$queryRaw" ? queryRaw : Reflect.get(actual, property, actualReceiver);
          },
        }));
      }, options);
    },
  });
  return { client: wrapped, reached: reached.waiting, release: release.release };
}
/** Track only this operation's PostgreSQL backend; preserve production transaction options. */
function observedConnection(pause?: Promise<void>) {
  const client = connection();
  const transaction = client.$transaction.bind(client);
  let pid: number | undefined;
  const ready = gate();
  const wrapped = new Proxy(client, {
    get(target, key, receiver) {
      if (key !== "$transaction") return Reflect.get(target, key, receiver);
      return <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number; maxWait?: number }) => transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (!backend) throw new Error("PostgreSQL backend PID unavailable");
        pid = backend.pid;
        ready.release();
        if (pause) await pause;
        return operation(tx);
      }, options);
    },
  });
  return { client: wrapped, pid: () => pid, ready: ready.waiting };
}
async function completedOrBlocked(completed: () => boolean, pid: () => number | undefined, observed?: () => void) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    if (completed()) return "completed";
    const rows = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_stat_activity
      WHERE datname = current_database() AND pid = ${pid() ?? -1} AND wait_event_type = 'Lock'
        AND position('pg_advisory_xact_lock' IN query) > 0
    `;
    observed?.();
    if (Number(rows[0]?.count ?? 0) > 0) return "blocked";
    await pollDelay(20);
  }
  throw new Error("Neither a PostgreSQL lock waiter nor a completed operation observed");
}

describe("shared final event capacity (real migrated PostgreSQL)", () => {
  it.each([
    ["manual", "import"], ["import", "manual"], ["manual", "manual"], ["import", "import"], ["manual", "direct"], ["direct", "manual"], ["direct", "direct"],
    ["registration", "manual"], ["manual", "registration"], ["registration", "import"], ["import", "registration"],
    ["registration", "direct"], ["direct", "registration"], ["registration", "registration"],
  ] as const)("serializes %s followed by %s at the last place", async (firstKind, secondKind) => {
    const paused = pauseCapacityRead();
    const first = Promise.allSettled([write(firstKind, paused.client)]);
    await paused.reached;
    let completed = false;
    const observer = observedConnection();
    const second = Promise.allSettled([write(secondKind, observer.client)]).then((result) => { completed = true; return result; });
    let interleaving: string;
    try { interleaving = await completedOrBlocked(() => completed, observer.pid); }
    finally { paused.release(); }
    const [a] = await first;
    const [b] = await second;
    expect.soft(interleaving!).toBe("blocked");
    expect.soft(a.status).toBe("fulfilled");
    expect.soft(b.status).toBe("fulfilled");
    if (a.status === "fulfilled") expect.soft(a.value).toBe("created");
    if (b.status === "fulfilled") expect.soft(b.value).toBe("event_full");
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });
  it("refuses a sequential import after manual creation fills the event", async () => {
    expect(await write("manual")).toBe("created");
    expect(await write("import")).toBe("event_full");
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });
  it("allows both writers on an unlimited event", async () => {
    await db.event.update({ where: { id: eventId }, data: { capacity: null } });
    expect(await write("manual")).toBe("created");
    expect(await write("import")).toBe("created");
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(2);
  });
  it.each(["revoked", "cancelled"] as const)("keeps %s attendees outside the capacity count", async (status) => {
    await db.attendee.create({ data: { event_id: eventId, email: "excluded@example.com", name: "Synthetic Excluded", status } });
    expect(await write("import")).toBe("created");
    expect(await write("manual")).toBe("event_full");
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(2);
  });
  it("preserves the trusted import force override and its audit", async () => {
    await write("manual");
    expect(await write("import", db, true)).toBe("created");
    const audit = await db.attendeeActionLog.findFirstOrThrow({ where: { event_id: eventId, action_type: "attendees_imported" } });
    expect(audit.metadata).toMatchObject({ forced: true, capacity: 1, current: 1 });
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(2);
  });
  it("allows manual force only for a superadmin", async () => {
    await write("import");
    expect(await write("manual", db, true)).toBe("event_full");
    await db.roleAssignment.create({ data: { user_id: userId, role: "superadmin", scope_type: "instance" } });
    expect(await write("manual", db, true)).toBe("created");
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(2);
  });
  it("rolls back the import and releases the capacity lock", async () => {
    const client = connection();
    const transaction = client.$transaction.bind(client);
    const failing = new Proxy(client, {
      get(target, key, receiver) {
        if (key !== "$transaction") return Reflect.get(target, key, receiver);
        return <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => transaction(async (tx) => {
          await operation(tx);
          throw new Error("Synthetic rollback before commit");
        });
      },
    });
    await expect(write("import", failing)).rejects.toThrow("Synthetic rollback before commit");
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(0);
    expect(await db.attendeeActionLog.count({ where: { event_id: eventId } })).toBe(0);
    expect(await write("manual")).toBe("created");
  });
  it("serializes import with status restoration at the last place", async () => {
    const attendee = await db.attendee.create({ data: { event_id: eventId, email: "restore@example.com", name: "Synthetic Restore", status: "revoked" } });
    const paused = pauseCapacityRead();
    const first = Promise.allSettled([write("import", paused.client)]);
    await paused.reached;
    const app = new Hono();
    const observer = observedConnection();
    const client = observer.client;
    app.patch("/events/:eventId/attendees/:id", (c) => {
      c.set("auth", { userId });
      return handlePatchEventAttendee(c, client);
    });
    let completed = false;
    const restored = Promise.resolve(app.request(`/events/${eventId}/attendees/${attendee.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "registered", expected_updated_at: attendee.updated_at.toISOString() }),
    })).then((response) => { completed = true; return response; });
    let interleaving: string;
    try { interleaving = await completedOrBlocked(() => completed, observer.pid); }
    finally { paused.release(); }
    expect((await first)[0].status).toBe("fulfilled");
    const response = await restored;
    expect(interleaving!).toBe("blocked");
    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe("event_full");
    expect(await db.attendee.count({ where: { event_id: eventId, status: { notIn: ["revoked", "cancelled"] } } })).toBe(1);
  });
  it("keeps erasure's existing release of an unadmitted attendee's place", async () => {
    await write("manual");
    const attendee = await db.attendee.findFirstOrThrow({ where: { event_id: eventId } });
    await db.$transaction((tx) => eraseAttendees(tx, { eventId, attendeeIds: [attendee.id] }));
    expect((await db.attendee.findUniqueOrThrow({ where: { id: attendee.id } })).status).toBe("cancelled");
    expect(await write("import")).toBe("created");
  });
  it("frees the place of an accepted registration that staff delete, for the next writer", async () => {
    await write("registration");
    const accepted = await db.registration.findFirstOrThrow({ where: { event_id: eventId, status: "accepted" } });
    await db.$transaction((tx) =>
      deleteRegistrations(tx, { eventId, target: { kind: "ids", ids: [accepted.id] }, actor: { operator: userId } }),
    );
    expect((await db.attendee.findFirstOrThrow({ where: { event_id: eventId } })).status).toBe("cancelled");
    expect(await write("import")).toBe("created");
    expect(await write("manual")).toBe("event_full");
  });
  it("allows an overwrite that consumes no additional place", async () => {
    await write("manual");
    const attendee = await db.attendee.findFirstOrThrow({ where: { event_id: eventId } });
    const result = await commitImport(eventId, [{ rowIndex: 1, first_name: "Synthetic", last_name: "Updated", email: attendee.email }], { overwrite: true }, db);
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });

  /** Restores the attendee through the real handler, on `client`, with the version of the row the staff member saw. */
  function restoring(client: PrismaClient, attendee: { id: string; updated_at: Date }) {
    const app = new Hono();
    app.patch("/events/:eventId/attendees/:id", (c) => {
      c.set("auth", { userId });
      return handlePatchEventAttendee(c, client);
    });
    return Promise.resolve(app.request(`/events/${eventId}/attendees/${attendee.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "registered", expected_updated_at: attendee.updated_at.toISOString() }),
    }));
  }

  it("serializes an admission that brings a companion followed by a manual add at the last two places", async () => {
    await db.event.update({ where: { id: eventId }, data: { capacity: 2 } });
    const paused = pauseCapacityRead();
    const first = Promise.allSettled([write("registration", paused.client, false, eventId, true)]);
    await paused.reached;
    let completed = false;
    const observer = observedConnection();
    const second = Promise.allSettled([write("manual", observer.client)]).then((result) => { completed = true; return result; });
    let interleaving: string;
    try { interleaving = await completedOrBlocked(() => completed, observer.pid); }
    finally { paused.release(); }
    const [a] = await first;
    const [b] = await second;
    expect.soft(interleaving!).toBe("blocked");
    expect.soft(a.status === "fulfilled" && a.value).toBe("created");
    expect.soft(b.status === "fulfilled" && b.value).toBe("event_full");
    expect(await countSeatsInUse(db, eventId)).toBe(2);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
    expect(await db.attendeeCompanion.count({ where: { attendee: { event_id: eventId } } })).toBe(1);
  });

  it("serializes a manual add followed by an admission that brings a companion: the guest and the companion no longer fit", async () => {
    await db.event.update({ where: { id: eventId }, data: { capacity: 2 } });
    const paused = pauseCapacityRead();
    const first = Promise.allSettled([write("manual", paused.client)]);
    await paused.reached;
    let completed = false;
    const observer = observedConnection();
    const second = Promise.allSettled([write("registration", observer.client, false, eventId, true)]).then((result) => { completed = true; return result; });
    let interleaving: string;
    try { interleaving = await completedOrBlocked(() => completed, observer.pid); }
    finally { paused.release(); }
    const [a] = await first;
    const [b] = await second;
    expect.soft(interleaving!).toBe("blocked");
    expect.soft(a.status === "fulfilled" && a.value).toBe("created");
    expect.soft(b.status === "fulfilled" && b.value).toBe("event_full");
    expect(await countSeatsInUse(db, eventId)).toBe(1);
    expect(await db.attendeeCompanion.count({ where: { attendee: { event_id: eventId } } })).toBe(0);
  });

  it("serializes an import followed by the restoration of an attendee with a companion: the two places are no longer free", async () => {
    await db.event.update({ where: { id: eventId }, data: { capacity: 2 } });
    const attendee = await db.attendee.create({
      data: { event_id: eventId, email: "restore-companion@example.com", name: "Synthetic Restore", status: "revoked", companions: { create: { slot: 1, name: "Synthetic Companion" } } },
    });
    const paused = pauseCapacityRead();
    const first = Promise.allSettled([write("import", paused.client)]);
    await paused.reached;
    const observer = observedConnection();
    let completed = false;
    const restored = restoring(observer.client, attendee).then((response) => { completed = true; return response; });
    let interleaving: string;
    try { interleaving = await completedOrBlocked(() => completed, observer.pid); }
    finally { paused.release(); }
    expect((await first)[0].status).toBe("fulfilled");
    const response = await restored;
    expect(interleaving!).toBe("blocked");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "event_full", capacity: 2, current: 1, incoming: 2 });
    expect((await db.attendee.findUniqueOrThrow({ where: { id: attendee.id } })).status).toBe("revoked");
    expect(await countSeatsInUse(db, eventId)).toBe(1);
  });

  it("serializes the restoration of an attendee with a companion followed by an import: the event is then full", async () => {
    await db.event.update({ where: { id: eventId }, data: { capacity: 2 } });
    const attendee = await db.attendee.create({
      data: { event_id: eventId, email: "restore-first@example.com", name: "Synthetic Restore", status: "revoked", companions: { create: { slot: 1, name: "Synthetic Companion" } } },
    });
    const paused = pauseCapacityRead();
    const first = restoring(paused.client, attendee);
    await paused.reached;
    let completed = false;
    const observer = observedConnection();
    const second = Promise.allSettled([write("import", observer.client)]).then((result) => { completed = true; return result; });
    let interleaving: string;
    try { interleaving = await completedOrBlocked(() => completed, observer.pid); }
    finally { paused.release(); }
    expect((await first).status).toBe(200);
    const [imported] = await second;
    expect(interleaving!).toBe("blocked");
    expect(imported.status === "fulfilled" && imported.value).toBe("event_full");
    expect((await db.attendee.findUniqueOrThrow({ where: { id: attendee.id } })).status).toBe("registered");
    expect(await countSeatsInUse(db, eventId)).toBe(2);
  });

  it("does not block another event's capacity while the first event waits", async () => {
    const other = await db.event.create({ data: {
      organization_id: orgId, title: "Independent Capacity", slug: `independent-${randomUUID()}`,
      date: new Date("2026-10-13T10:00:00Z"), capacity: 1,
    } });
    const paused = pauseCapacityRead();
    const first = Promise.allSettled([write("manual", paused.client)]);
    await paused.reached;
    let completed = false;
    const unrelated = observedConnection();
    let unrelatedCompleted = false;
    const unrelatedWaiter = Promise.allSettled([write("manual", unrelated.client)]).then((result) => { unrelatedCompleted = true; return result; });
    expect(await completedOrBlocked(() => unrelatedCompleted, unrelated.pid)).toBe("blocked");
    const independentRelease = gate();
    const observer = observedConnection(independentRelease.waiting);
    const second = Promise.allSettled([write("import", observer.client, false, other.id)]).then((result) => { completed = true; return result; });
    let interleaving: string;
    await observer.ready;
    try { interleaving = await completedOrBlocked(() => completed, observer.pid, independentRelease.release); }
    finally { independentRelease.release(); paused.release(); }
    await unrelatedWaiter;
    try {
      expect((await first)[0].status).toBe("fulfilled");
      const [result] = await second;
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") expect(result.value).toBe("created");
      expect(interleaving!).toBe("completed");
      expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
      expect(await db.attendee.count({ where: { event_id: other.id } })).toBe(1);
    } finally {
      await db.attendee.deleteMany({ where: { event_id: other.id } });
      await db.event.delete({ where: { id: other.id } });
    }
  });

  it.each(["manual", "restore"] as const)("returns event_full after a lock wait exceeding the default five-second budget (%s)", async (kind) => {
    const attendee = kind === "restore"
      ? await db.attendee.create({ data: { event_id: eventId, email: "long-restore@example.com", name: "Synthetic Restore", status: "revoked" } })
      : undefined;
    const paused = pauseCapacityRead();
    const first = Promise.allSettled([write("import", paused.client)]);
    await paused.reached;
    const observer = observedConnection();
    const client = observer.client;
    let completed = false;
    let response: Promise<Response> | undefined;
    if (attendee) {
      const app = new Hono();
      app.patch("/events/:eventId/attendees/:id", (c) => {
        c.set("auth", { userId });
        return handlePatchEventAttendee(c, client);
      });
      response = Promise.resolve(app.request(`/events/${eventId}/attendees/${attendee.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "registered", expected_updated_at: attendee.updated_at.toISOString() }),
      }));
    }
    const second = response
      ? response.then(async (answer) => {
        completed = true;
        expect(answer.status).toBe(409);
        expect((await answer.json() as { code: string }).code).toBe("event_full");
        return "event_full";
      })
      : write("manual", client).then((result) => { completed = true; return result; });
    // Observe the real lock waiter first. A server-side delay then tests the timeout budget,
    // not the existence of a race; neither query data nor transaction options are replaced.
    const results = Promise.allSettled([second]);
    let interleaving: string;
    try {
      interleaving = await completedOrBlocked(() => completed, observer.pid);
      await db.$queryRaw`SELECT 1 FROM pg_sleep(6)`;
    } finally { paused.release(); }
    expect(interleaving!).toBe("blocked");
    const [imported] = await first;
    expect(imported.status).toBe("fulfilled");
    const [result] = await results;
    if (result.status === "rejected") throw result.reason;
    expect(result.value).toBe("event_full");
    expect(await db.attendee.count({ where: { event_id: eventId, status: { notIn: ["revoked", "cancelled"] } } })).toBe(1);
  }, 20_000);

});
