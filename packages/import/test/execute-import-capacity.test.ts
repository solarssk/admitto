import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { executeImportCommit, ImportCapacityExceededError, ImportStoppedError } from "../src/executeImportCommit.js";
import { reclaimStaleImportJobs, parseImportJobStaleRunningMs } from "../src/reclaimStaleImportJobs.js";
import type { StorageAdapter } from "@admitto/storage";
import type { ExecuteImportCommitParams } from "../src/executeImportCommit.js";

const schema = `import_execute_capacity_${randomUUID().replaceAll("-", "")}`;
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
async function fixture(capacity = 1) {
  const n = ++sequence;
  const org = await db.organization.create({ data: { name: "Execute Capacity", slug: `execute-capacity-${n}` } });
  const event = await db.event.create({ data: {
    organization_id: org.id, title: "Execute Capacity", slug: `execute-capacity-${n}`,
    date: new Date("2026-10-13T10:00:00Z"), capacity,
  } });
  const params: ExecuteImportCommitParams = {
    eventId: event.id, csv: `first_name,last_name,email\nSynthetic,Execute,execute-${n}@example.com`,
    overwrite: false, forceCapacity: false, actorUserId: null, sessionId: null,
    timezone: "Europe/Warsaw", filename: "synthetic-capacity.csv", importId: randomUUID(),
  };
  return { org, event, params };
}

describe("import execution's final capacity check (real migrated PostgreSQL)", () => {
  it("commits a fitting import and its audit", async () => {
    const f = await fixture();
    expect(await executeImportCommit(db, f.params)).toMatchObject({ created: 1, toCreate: 1, skippedCount: 0 });
    expect(await db.attendee.count({ where: { event_id: f.event.id } })).toBe(1);
    const audit = await db.attendeeActionLog.findFirstOrThrow({ where: { event_id: f.event.id, action_type: "attendees_imported" } });
    expect(audit.metadata).toMatchObject({ created: 1, importId: f.params.importId });
  });
  it("refuses a full event without writing an attendee or import audit", async () => {
    const f = await fixture();
    await db.attendee.create({ data: { event_id: f.event.id, email: "existing-full@example.com", name: "Synthetic Existing" } });
    await expect(executeImportCommit(db, f.params)).rejects.toBeInstanceOf(ImportCapacityExceededError);
    expect(await db.attendee.count({ where: { event_id: f.event.id } })).toBe(1);
    expect(await db.attendeeActionLog.count({ where: { event_id: f.event.id } })).toBe(0);
  });
  it("carries a trusted force override through the write and records it", async () => {
    const f = await fixture();
    await db.attendee.create({ data: { event_id: f.event.id, email: "existing-force@example.com", name: "Synthetic Existing" } });
    expect((await executeImportCommit(db, { ...f.params, forceCapacity: true })).created).toBe(1);
    expect(await db.attendee.count({ where: { event_id: f.event.id } })).toBe(2);
    const audit = await db.attendeeActionLog.findFirstOrThrow({ where: { event_id: f.event.id, action_type: "attendees_imported" } });
    expect(audit.metadata).toMatchObject({ forced: true, capacity: 1, current: 1 });
  });
  it("commits a running worker job's completion together with its attendees", async () => {
    const f = await fixture();
    const job = await db.adminJob.create({ data: {
      organization_id: f.org.id, event_id: f.event.id, type: "import_commit", status: "running", import_id: f.params.importId,
    } });
    expect((await executeImportCommit(db, { ...f.params, adminJobId: job.id })).created).toBe(1);
    expect(await db.adminJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "succeeded", created_count: 1, to_create: 1 });
    expect(await db.attendee.count({ where: { event_id: f.event.id } })).toBe(1);
  });
  it("refuses a stopped worker job before capacity or attendee writes", async () => {
    const f = await fixture();
    const job = await db.adminJob.create({ data: {
      organization_id: f.org.id, event_id: f.event.id, type: "import_commit", status: "cancelled",
    } });
    await expect(executeImportCommit(db, { ...f.params, adminJobId: job.id })).rejects.toBeInstanceOf(ImportStoppedError);
    expect(await db.attendee.count({ where: { event_id: f.event.id } })).toBe(0);
    expect((await db.adminJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled");
  });
});


describe("import reclaim intervals (real migrated PostgreSQL)", () => {
  it.each([900_000, Infinity, NaN, Number.MAX_VALUE, 0, -1])("reclaims with interval %s using supported cutoffs", async (interval) => {
    const f = await fixture();
    const now = new Date("2026-10-13T12:00:00Z");
    const job = await db.adminJob.create({ data: {
      organization_id: f.org.id, event_id: f.event.id, type: "import_commit", status: "running",
      started_at: new Date(now.getTime() - 900_001),
    } });
    const storage = { delete: vi.fn() } as unknown as StorageAdapter;
    expect(await reclaimStaleImportJobs(db, storage, { olderThanMs: interval, heartbeatStaleMs: interval, now })).toMatchObject({ reclaimed: 1 });
    expect((await db.adminJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("failed");
  });

  it("accepts the Date interval boundary and falls back for oversized env digits", async () => {
    const f = await fixture();
    const now = new Date("2026-10-13T12:00:00Z");
    const job = await db.adminJob.create({ data: {
      organization_id: f.org.id, event_id: f.event.id, type: "import_commit", status: "running",
      started_at: new Date(now.getTime() - 900_001),
    } });
    const storage = { delete: vi.fn() } as unknown as StorageAdapter;
    expect(await reclaimStaleImportJobs(db, storage, { olderThanMs: 62_135_596_800_000, now })).toMatchObject({ reclaimed: 0 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const interval = parseImportJobStaleRunningMs({ IMPORT_JOB_STALE_RUNNING_MS: "9".repeat(400) });
      expect(await reclaimStaleImportJobs(db, storage, { olderThanMs: interval, now })).toMatchObject({ reclaimed: 1 });
      expect(warn).toHaveBeenCalledWith("Invalid import stale interval configuration; using default.");
    } finally { warn.mockRestore(); }
    expect((await db.adminJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("failed");
  });
});

describe("import of the long text, date, phone and rule-bound fields of the registry (real migrated PostgreSQL)", () => {
  const HEADER = "first_name,last_name,email,arrival,phone,notes,plate";

  async function fieldsFixture() {
    const f = await fixture(50);
    await db.eventCustomField.createMany({
      data: [
        { event_id: f.event.id, source_field: "arrival", label: "Arrival", type: "date", display_order: 0 },
        { event_id: f.event.id, source_field: "phone", label: "Phone", type: "phone", display_order: 1, rules: { min_length: 9 } },
        { event_id: f.event.id, source_field: "notes", label: "Notes", type: "long_text", display_order: 2 },
        {
          event_id: f.event.id,
          source_field: "plate",
          label: "Plate",
          type: "text",
          display_order: 3,
          rules: { digits_only: true, min_length: 3, max_length: 6, example: "123456" },
        },
      ],
    });
    return f;
  }

  it("stores each answer in its normal form and refuses, row by row, what breaks a type or a rule", async () => {
    const f = await fieldsFixture();
    const csv = [
      HEADER,
      'Ann,One,types-1@example.com,2026-11-04,+48 600 100 200,"Two seats,\nplease.",123456',
      "Bob,Two,types-2@example.com,2026-11-05T00:00:00.000Z,(22) 123-45-67,,987",
      "Cy,Three,types-3@example.com,2026-02-30,600100200,,123",
      "Di,Four,types-4@example.com,2026-11-06,600100200,,12a",
      "Ed,Five,types-5@example.com,2026-11-07,12345,,123",
    ].join("\n");

    const result = await executeImportCommit(db, { ...f.params, csv });

    expect(result).toMatchObject({ created: 2, invalidCount: 3 });
    expect(result.invalidRows.map((row) => row.reason)).toEqual([
      "Invalid value for Arrival (expected a date as YYYY-MM-DD)",
      "Invalid value for Plate (expected digits only, 3 to 6 characters, for example 123456)",
      "Invalid value for Phone (expected a phone number with 3 to 15 digits, at least 9 characters)",
    ]);
    const stored = await db.attendee.findMany({ where: { event_id: f.event.id }, orderBy: { email: "asc" } });
    expect(stored.map((a) => a.custom_data)).toEqual([
      { arrival: "2026-11-04", phone: "+48600100200", notes: "Two seats,\nplease.", plate: "123456" },
      { arrival: "2026-11-05", phone: "221234567", plate: "987" },
    ]);
  });

  it("holds an update of an existing attendee to the same rules, so one bad answer skips the row", async () => {
    const f = await fieldsFixture();
    await db.attendee.create({
      data: { event_id: f.event.id, email: "types-update@example.com", name: "Up Date", custom_data: { plate: "123" } },
    });
    const csv = [HEADER, "Up,Date,types-update@example.com,2026-11-04,600100200,,12a"].join("\n");

    const result = await executeImportCommit(db, { ...f.params, csv, overwrite: true });

    expect(result.updated).toBe(0);
    expect(result.invalidCount).toBe(1);
    const row = await db.attendee.findFirstOrThrow({ where: { event_id: f.event.id, email: "types-update@example.com" } });
    expect(row.custom_data).toEqual({ plate: "123" });
  });
});
