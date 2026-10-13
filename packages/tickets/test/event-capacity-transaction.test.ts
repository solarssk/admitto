import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { acquireEventCapacityLock, runEventCapacityTransaction, type EventCapacityTransactionPolicy } from "../src/event-capacity.js";

const schema = `tickets_capacity_budget_${randomUUID().replaceAll("-", "")}`;
let db: PrismaClient;
let admin: PrismaClient;

beforeAll(() => {
  const url = process.env.DATABASE_URL ?? "";
  assertTestDatabaseUrl(url);
  const migrated = new URL(url);
  migrated.searchParams.set("schema", schema);
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), "../../db"),
    env: { ...process.env, DATABASE_URL: migrated.toString() }, stdio: "pipe",
  });
  db = createTestPrismaClient(url, schema);
  admin = createTestPrismaClient(url);
}, 30_000);
afterAll(async () => {
  if (db) await db.$disconnect();
  if (admin) {
    // Generated identifier, never request or CSV content.
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});

async function fixture() {
  const slug = randomUUID();
  const org = await db.organization.create({ data: { name: "Synthetic Budget", slug } });
  return db.event.create({ data: { organization_id: org.id, title: "Synthetic Budget", slug, date: new Date() } });
}
const policy: EventCapacityTransactionPolicy = {
  workTimeout: 1_000, lockAllowance: 400, grace: 100, maxWait: 5_000, waitTimeout: 10_000,
};
function gate() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return { release, waiting };
}

describe("capacity acquisition reserves the work budget (real migrated PostgreSQL)", () => {
  it("restarts a slow acquisition before work and writes exactly once", async () => {
    const event = await fixture();
    const held = gate();
    const release = gate();
    const holder = db.$transaction(async (tx) => {
      await acquireEventCapacityLock(tx, event.id);
      held.release();
      await release.waiting;
    }, { timeout: 10_000 });
    await held.waiting;
    let attempts = 0;
    let writes = 0;
    let pid: number | undefined;
    const operation = runEventCapacityTransaction(db, event.id, async (tx) => {
      attempts++;
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      if (!backend) throw new Error("PostgreSQL backend PID unavailable");
      pid = backend.pid;
    }, async (tx) => {
      writes++;
      await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.6)`;
      return tx.attendee.create({ data: { event_id: event.id, email: "budget@example.com", name: "Synthetic Budget" } });
    }, policy);
    const results = Promise.allSettled([operation]);
    try {
      const deadline = performance.now() + 5_000;
      let blocked = false;
      while (!blocked && performance.now() < deadline) {
        const rows = await db.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid = ${pid ?? -1}
            AND wait_event_type = 'Lock') AS blocked`;
        blocked = rows[0]?.blocked ?? false;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      // Once a real waiter is observed, consume most of its 1.5s attempt budget.
      await db.$queryRaw`SELECT 1 FROM pg_sleep(1.2)`;
    } finally { release.release(); }
    await holder;
    const [result] = await results;
    if (result.status === "rejected") throw result.reason;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(writes).toBe(1);
    expect(await db.attendee.count({ where: { event_id: event.id } })).toBe(1);
  });
  it("retries a server-cancelled advisory wait before starting work", async () => {
    const event = await fixture();
    const held = gate();
    const release = gate();
    const holder = db.$transaction(async (tx) => {
      await acquireEventCapacityLock(tx, event.id);
      held.release();
      await release.waiting;
    }, { timeout: 10_000 });
    await held.waiting;
    let attempts = 0;
    let writes = 0;
    const operation = runEventCapacityTransaction(db, event.id, async (tx) => {
      if (++attempts === 1) {
        // Enforce a real server timeout, scaled from the adapter's production 30s limit.
        await tx.$executeRaw`SET LOCAL statement_timeout = '100ms'`;
      } else {
        release.release();
      }
    }, async (tx) => {
      writes++;
      return tx.attendee.create({ data: { event_id: event.id, email: "server-timeout@example.com", name: "Synthetic Timeout" } });
    }, policy);
    let results: PromiseSettledResult<unknown>[];
    try { results = await Promise.allSettled([operation]); }
    finally { release.release(); }
    await holder;
    const [result] = results;
    if (!result) throw new Error("Synthetic operation result unavailable");
    if (result.status === "rejected") throw result.reason;
    expect(attempts).toBe(2);
    expect(writes).toBe(1);
    expect(await db.attendee.count({ where: { event_id: event.id } })).toBe(1);
  });
  it("retries an expired read-only preparation", async () => {
    const event = await fixture();
    let attempts = 0;
    let writes = 0;
    await runEventCapacityTransaction(db, event.id, async (tx) => {
      if (++attempts === 1) await tx.$queryRaw`SELECT 1 FROM pg_sleep(1.7)`;
    }, async (tx) => {
      writes++;
      await tx.attendee.create({ data: { event_id: event.id, email: "retry@example.com", name: "Synthetic Retry" } });
    }, policy);
    expect(attempts).toBe(2);
    expect(writes).toBe(1);
  });
  it("never replays work after expiry, and rolls its writes back", async () => {
    const event = await fixture();
    let writes = 0;
    await expect(runEventCapacityTransaction(db, event.id, async () => {}, async (tx) => {
      writes++;
      await tx.attendee.create({ data: { event_id: event.id, email: "rollback@example.com", name: "Synthetic Rollback" } });
      await tx.$queryRaw`SELECT 1 FROM pg_sleep(1.7)`;
      await tx.attendee.count();
    }, policy)).rejects.toMatchObject({ code: "P2028" });
    expect(writes).toBe(1);
    expect(await db.attendee.count({ where: { event_id: event.id } })).toBe(0);
  });
  it("never replays work after a server timeout, and rolls writes back", async () => {
    const event = await fixture();
    let writes = 0;
    await expect(runEventCapacityTransaction(db, event.id, async () => {}, async (tx) => {
      writes++;
      await tx.attendee.create({ data: { event_id: event.id, email: "server-rollback@example.com", name: "Synthetic Rollback" } });
      await tx.$executeRaw`SET LOCAL statement_timeout = '100ms'`;
      await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.2)`;
    }, policy)).rejects.toMatchObject({ code: "P2010", meta: { driverAdapterError: { cause: { code: "57014" } } } });
    expect(writes).toBe(1);
    expect(await db.attendee.count({ where: { event_id: event.id } })).toBe(0);
  });
  it("does not retry unrelated raw-query failures during preparation", async () => {
    const event = await fixture();
    let attempts = 0;
    await expect(runEventCapacityTransaction(db, event.id, async (tx) => {
      attempts++;
      await tx.$queryRaw`SELECT 1 / 0`;
    }, async () => {}, policy)).rejects.toMatchObject({ code: "P2010", meta: { driverAdapterError: { cause: { code: "22012" } } } });
    expect(attempts).toBe(1);
  });
  it("bounds repeated acquisition attempts without starting work", async () => {
    const event = await fixture();
    let writes = 0;
    await expect(runEventCapacityTransaction(db, event.id, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.2)`;
    }, async () => { writes++; }, { ...policy, lockAllowance: 50, waitTimeout: 100 }))
      .rejects.toThrow("Event capacity lock acquisition timed out.");
    expect(writes).toBe(0);
  });
  it("propagates preparation errors without retrying", async () => {
    const event = await fixture();
    let attempts = 0;
    await expect(runEventCapacityTransaction(db, event.id, async () => {
      attempts++;
      throw new Error("Synthetic stopped job");
    }, async () => {}, policy)).rejects.toThrow("Synthetic stopped job");
    expect(attempts).toBe(1);
  });
});
