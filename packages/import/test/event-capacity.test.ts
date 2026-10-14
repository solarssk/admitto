import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { commitImport } from "../src/importer.js";
import { ImportCapacityExceededError } from "../src/executeImportCommit.js";
import type { AttendeeRow } from "../src/types.js";

const schema = `import_capacity_${randomUUID().replaceAll("-", "")}`;
let db: PrismaClient;
let admin: PrismaClient;
let sequence = 0;
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
async function fixture(capacity: number | null = 1) {
  const n = ++sequence;
  const org = await db.organization.create({ data: { name: "Import Capacity", slug: `import-capacity-${n}` } });
  const event = await db.event.create({ data: {
    organization_id: org.id, title: "Import Capacity", slug: `import-capacity-${n}`,
    date: new Date("2026-10-13T10:00:00Z"), capacity,
  } });
  return event.id;
}
function rows(amount = 1): AttendeeRow[] {
  return Array.from({ length: amount }, (_, index) => ({
    rowIndex: index + 1, first_name: "Synthetic", last_name: "Capacity",
    email: `core-capacity-${++sequence}@example.com`,
  }));
}

describe("import capacity at the write boundary (real migrated PostgreSQL)", () => {
  it("rejects the whole oversized batch without partial writes", async () => {
    const eventId = await fixture();
    await expect(commitImport(eventId, rows(2), {}, db)).rejects.toMatchObject({
      code: "event_full", capacity: 1, current: 0, incoming: 2, projected: 2,
    });
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(0);
  });
  it("allows an exact fit and refuses the next write", async () => {
    const eventId = await fixture();
    expect((await commitImport(eventId, rows(), {}, db)).created).toBe(1);
    await expect(commitImport(eventId, rows(), {}, db)).rejects.toBeInstanceOf(ImportCapacityExceededError);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(1);
  });
  it("preserves a trusted explicit force override", async () => {
    const eventId = await fixture();
    expect((await commitImport(eventId, rows(2), { forceCapacity: true }, db)).created).toBe(2);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(2);
  });
  it("does not reserve or write places during a preview", async () => {
    const eventId = await fixture();
    const result = await commitImport(eventId, rows(2), { dryRun: true }, db);
    expect(result.toCreate).toBe(2);
    expect(result.created).toBe(0);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(0);
  });
  it("preserves an unlimited event", async () => {
    const eventId = await fixture(null);
    expect((await commitImport(eventId, rows(2), {}, db)).created).toBe(2);
  });
  it.each(["cancelled", "revoked"] as const)("does not count a %s attendee", async (status) => {
    const eventId = await fixture();
    await db.attendee.create({ data: { event_id: eventId, email: `excluded-${++sequence}@example.com`, name: "Synthetic Excluded", status } });
    expect((await commitImport(eventId, rows(), {}, db)).created).toBe(1);
    expect(await db.attendee.count({ where: { event_id: eventId } })).toBe(2);
  });
});
