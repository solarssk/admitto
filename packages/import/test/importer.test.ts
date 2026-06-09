import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { commitImport } from "../src/importer.js";
import type { AttendeeRow } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "../../db");

let prisma: PrismaClient;

const EVENT_ID = "test-event-001";

const rowA: AttendeeRow = {
  first_name: "Jan",
  last_name: "Kowalski",
  email: "jan@example.com",
  ticket_type: "standard",
};

const rowB: AttendeeRow = {
  first_name: "Ana",
  last_name: "Nowak",
  email: "ana@example.com",
  external_uuid: "agency-uuid-001",
  qr_payload: "AGENCY-QR-001",
};

beforeAll(async () => {
  execSync("npx prisma db push --force-reset", {
    cwd: DB_ROOT,
    env: { ...process.env, DATABASE_URL: process.env["DATABASE_URL"] ?? "file:./test.db" },
    stdio: "pipe",
  });

  prisma = new PrismaClient();

  // Seed a test event
  await prisma.event.upsert({
    where: { id: EVENT_ID },
    update: {},
    create: {
      id: EVENT_ID,
      title: "Test Event",
      slug: "test-event-001",
      date: new Date("2026-09-01T09:00:00Z"),
    },
  });
});

afterAll(async () => {
  // Clean up test data
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.$disconnect();
});

describe("commitImport — dry-run", () => {
  it("returns correct counts without writing to DB", async () => {
    const summary = await commitImport(EVENT_ID, [rowA, rowB], { dryRun: true }, prisma);
    expect(summary.toCreate).toBe(2);
    expect(summary.created).toBe(0);

    const count = await prisma.attendee.count({ where: { event_id: EVENT_ID } });
    expect(count).toBe(0);
  });
});

describe("commitImport — create", () => {
  it("creates new attendees", async () => {
    const summary = await commitImport(EVENT_ID, [rowA, rowB], {}, prisma);
    expect(summary.created).toBe(2);
    expect(summary.toCreate).toBe(2);
    expect(summary.skipped).toHaveLength(0);
  });

  it("leaves token_hash null — issuance happens in Step 4, not import", async () => {
    const att = await prisma.attendee.findUnique({
      where: { event_id_email: { event_id: EVENT_ID, email: "jan@example.com" } },
    });
    // Import creates the record; token_hash is set during ticket issuance (mailer step).
    expect(att?.token_hash).toBeNull();
  });

  it("preserves agency qr_payload and external_uuid as-is", async () => {
    const att = await prisma.attendee.findUnique({
      where: { event_id_email: { event_id: EVENT_ID, email: "ana@example.com" } },
    });
    expect(att?.qr_payload).toBe("AGENCY-QR-001");
    expect(att?.external_uuid).toBe("agency-uuid-001");
  });
});

describe("commitImport — overwrite=false (re-import)", () => {
  it("skips existing attendees, never updates them", async () => {
    const summary = await commitImport(EVENT_ID, [rowA], { overwrite: false }, prisma);
    expect(summary.toSkip).toBe(1);
    expect(summary.updated).toBe(0);
    expect(summary.skipped[0]?.email).toBe("jan@example.com");
  });

  it("does not overwrite qr_payload when overwrite=false", async () => {
    const before = await prisma.attendee.findUnique({
      where: { event_id_email: { event_id: EVENT_ID, email: "ana@example.com" } },
    });
    await commitImport(EVENT_ID, [{ ...rowB, qr_payload: "OVERWRITE-ATTEMPT" }], { overwrite: false }, prisma);
    const after = await prisma.attendee.findUnique({
      where: { event_id_email: { event_id: EVENT_ID, email: "ana@example.com" } },
    });
    expect(after?.qr_payload).toBe(before?.qr_payload);
  });
});

describe("commitImport — overwrite=true", () => {
  it("updates presentation fields (name, ticket_type)", async () => {
    const updated = { ...rowA, first_name: "Janek", ticket_type: "vip" };
    const summary = await commitImport(EVENT_ID, [updated], { overwrite: true }, prisma);
    expect(summary.updated).toBe(1);
    expect(summary.toUpdate).toBe(1);

    const att = await prisma.attendee.findUnique({
      where: { event_id_email: { event_id: EVENT_ID, email: "jan@example.com" } },
    });
    expect(att?.name).toBe("Janek Kowalski");
  });

  it("never overwrites qr_payload even with overwrite=true", async () => {
    // rowB in DB: external_uuid=agency-uuid-001, qr_payload=AGENCY-QR-001
    // Import with same external_uuid but different qr_payload — must not overwrite
    await commitImport(
      EVENT_ID,
      [{ ...rowB, qr_payload: "OVERWRITE-ATTEMPT" }],
      { overwrite: true },
      prisma,
    );
    const after = await prisma.attendee.findUnique({
      where: { event_id_email: { event_id: EVENT_ID, email: "ana@example.com" } },
    });
    expect(after?.qr_payload).toBe("AGENCY-QR-001");
    expect(after?.external_uuid).toBe("agency-uuid-001");
  });

  it("never overwrites token_hash even with overwrite=true", async () => {
    // Simulate ticket issuance: manually set a token_hash
    await prisma.attendee.update({
      where: { event_id_email: { event_id: EVENT_ID, email: "jan@example.com" } },
      data: { token_hash: "deadbeef".repeat(8) },
    });
    await commitImport(EVENT_ID, [rowA], { overwrite: true }, prisma);
    const after = await prisma.attendee.findUnique({
      where: { event_id_email: { event_id: EVENT_ID, email: "jan@example.com" } },
    });
    expect(after?.token_hash).toBe("deadbeef".repeat(8));
  });

  it("never overwrites status", async () => {
    // Manually set status to confirmed
    await prisma.attendee.update({
      where: { event_id_email: { event_id: EVENT_ID, email: "jan@example.com" } },
      data: { status: "confirmed" },
    });
    await commitImport(EVENT_ID, [rowA], { overwrite: true }, prisma);
    const att = await prisma.attendee.findUnique({
      where: { event_id_email: { event_id: EVENT_ID, email: "jan@example.com" } },
    });
    expect(att?.status).toBe("confirmed");
  });
});

describe("commitImport — Mode B matching by external_uuid", () => {
  it("matches existing attendee by external_uuid, not email", async () => {
    // rowB is already in DB with email ana@example.com and external_uuid agency-uuid-001
    // Try with a different email but same external_uuid → should match existing
    const rowBDifferentEmail: AttendeeRow = {
      ...rowB,
      email: "different@example.com",
    };
    const summary = await commitImport(EVENT_ID, [rowBDifferentEmail], { overwrite: false }, prisma);
    // Should skip because external_uuid matches existing
    expect(summary.toSkip).toBe(1);
  });

  it("matches existing attendee by qr_payload when external_uuid is missing", async () => {
    const rowWithQrOnly: AttendeeRow = {
      first_name: "Qr",
      last_name: "Only",
      email: "qr-only@example.com",
      qr_payload: "AGENCY-QR-ONLY",
    };
    await commitImport(EVENT_ID, [rowWithQrOnly], {}, prisma);

    const reimportWithChangedEmail: AttendeeRow = {
      ...rowWithQrOnly,
      email: "qr-only-renamed@example.com",
    };
    const summary = await commitImport(EVENT_ID, [reimportWithChangedEmail], { overwrite: false }, prisma);

    expect(summary.toSkip).toBe(1);
    expect(summary.created).toBe(0);
  });
});

describe("commitImport — UUID/email fallback", () => {
  it("falls back to email match when external_uuid is new for an existing attendee", async () => {
    // Jan is in DB with no external_uuid (Mode A). Re-import same email with a newly assigned UUID.
    // Without fallback this would crash with a unique constraint on (event_id, email).
    const summary = await commitImport(
      EVENT_ID,
      [{ ...rowA, external_uuid: "newly-assigned-uuid" }],
      { overwrite: false },
      prisma,
    );
    expect(summary.toSkip).toBe(1);
    expect(summary.created).toBe(0);
  });

  it("skips rows whose identifiers point to different attendees", async () => {
    await commitImport(
      EVENT_ID,
      [
        {
          first_name: "Uuid",
          last_name: "Holder",
          email: "uuid-holder@example.com",
          external_uuid: "conflict-uuid-001",
        },
        {
          first_name: "Qr",
          last_name: "Holder",
          email: "qr-holder@example.com",
          qr_payload: "CONFLICT-QR-001",
        },
      ],
      {},
      prisma,
    );

    const conflictingRow: AttendeeRow = {
      first_name: "Conflict",
      last_name: "Row",
      email: "uuid-holder@example.com",
      external_uuid: "conflict-uuid-001",
      qr_payload: "CONFLICT-QR-001",
    };

    const summary = await commitImport(EVENT_ID, [conflictingRow], { overwrite: true }, prisma);

    expect(summary.toSkip).toBe(1);
    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(0);
    expect(summary.skipped[0]?.reason).toMatch(/conflicting identifiers/i);
  });
});

describe("commitImport — idempotency", () => {
  it("re-importing same file twice is idempotent (overwrite=false)", async () => {
    const newRow: AttendeeRow = { first_name: "New", last_name: "User", email: "new@example.com" };
    await commitImport(EVENT_ID, [newRow], {}, prisma);
    const summary = await commitImport(EVENT_ID, [newRow], {}, prisma);
    expect(summary.toSkip).toBe(1);
    expect(summary.created).toBe(0);
  });
});
