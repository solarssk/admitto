import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as pollDelay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { acquireEventCapacityLock } from "../src/event-capacity.js";

const clients: PrismaClient[] = [];
let monitor: PrismaClient;
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
beforeAll(() => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  monitor = connection();
});
afterAll(async () => { await Promise.all(clients.map((client) => client.$disconnect())); });

/** Observe a real waiter; polling time only bounds a failed test. */
async function completedOrBlocked(completed: () => boolean) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    if (completed()) return "completed";
    const rows = await monitor.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND position('pg_advisory_xact_lock' IN query) > 0
    `;
    if (Number(rows[0]?.count ?? 0) > 0) return "blocked";
    await pollDelay(20);
  }
  throw new Error("No PostgreSQL lock waiter or completed transaction observed");
}

describe("event capacity transaction lock (real PostgreSQL)", () => {
  it.each([true, false])("serializes only matching event keys (same event: %s)", async (sameEvent) => {
    const eventId = randomUUID();
    const ready = gate();
    const release = gate();
    const first = connection().$transaction(async (tx) => {
      await acquireEventCapacityLock(tx, eventId);
      ready.release(); await release.waiting;
    }, { timeout: 20_000 });
    await ready.waiting;
    let completed = false;
    const second = connection().$transaction(async (tx) => {
      await acquireEventCapacityLock(tx, sameEvent ? eventId : randomUUID());
    }, { timeout: 20_000 }).then(() => { completed = true; });
    let interleaving: string;
    try { interleaving = await completedOrBlocked(() => completed); }
    finally { release.release(); }
    await Promise.all([first, second]);
    expect(interleaving!).toBe(sameEvent ? "blocked" : "completed");
  });
  it("releases ownership when its transaction rolls back", async () => {
    const eventId = randomUUID();
    await expect(connection().$transaction(async (tx) => {
      await acquireEventCapacityLock(tx, eventId);
      throw new Error("Synthetic capacity rollback");
    })).rejects.toThrow("Synthetic capacity rollback");
    await connection().$transaction(async (tx) => { await acquireEventCapacityLock(tx, eventId); });
  });
});
