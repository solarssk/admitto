import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "org-attendee-companion";
const EVENT_ID = "evt-attendee-companion";

let prisma: PrismaClient;
let n = 0;

/** A companion row written with raw SQL, so the constraints (not Prisma's types) are what is tested. */
function insertCompanion(attendeeId: string, slot: number, customData: string | null = null): Promise<number> {
  n += 1;
  return prisma.$executeRaw`
    INSERT INTO "AttendeeCompanion" ("id", "attendee_id", "slot", "name", "custom_data", "updated_at")
    VALUES (${`companion-${n}`}, ${attendeeId}, ${slot}, 'Companion Example', ${customData}::jsonb, now())`;
}

async function createAttendee(label: string): Promise<string> {
  n += 1;
  const attendee = await prisma.attendee.create({
    data: { event_id: EVENT_ID, email: `${label}-${n}@example.com`, name: `Attendee ${label}` },
  });
  return attendee.id;
}

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma migrate reset --force", { cwd: DB_ROOT, env: { ...process.env }, stdio: "pipe" });
  prisma = createTestPrismaClient();
  await prisma.organization.create({ data: { id: ORG_ID, name: "Companion Schema Org", slug: "companion-schema" } });
  await prisma.event.create({
    data: { id: EVENT_ID, title: EVENT_ID, slug: EVENT_ID, date: new Date("2030-09-01"), organization_id: ORG_ID },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("AttendeeCompanion", () => {
  it("is written with a name and a slot, and starts with no answers", async () => {
    const attendeeId = await createAttendee("defaults");
    const row = await prisma.attendeeCompanion.create({ data: { attendee_id: attendeeId, slot: 1, name: "Companion Example" } });
    expect(row).toMatchObject({ attendee_id: attendeeId, slot: 1, name: "Companion Example", custom_data: null });
    expect(row.id).toBeTruthy();
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.updated_at).toBeInstanceOf(Date);
    const listed = await prisma.attendee.findUniqueOrThrow({ where: { id: attendeeId }, select: { companions: true } });
    expect(listed.companions.map((companion) => companion.id)).toEqual([row.id]);
  });

  it("holds one companion per attendee and slot", async () => {
    const attendeeId = await createAttendee("unique");
    await insertCompanion(attendeeId, 1);
    await expect(insertCompanion(attendeeId, 1)).rejects.toThrow("AttendeeCompanion_attendee_id_slot_key");
    // Another attendee has its own slot 1.
    await expect(insertCompanion(await createAttendee("unique-other"), 1)).resolves.toBe(1);
  });

  it("does not hard-code one companion: a second slot is accepted by the table, how many to allow is the application's rule", async () => {
    const attendeeId = await createAttendee("slots");
    await insertCompanion(attendeeId, 1);
    await expect(insertCompanion(attendeeId, 2)).resolves.toBe(1);
  });

  it.each([0, -1])("refuses the slot %i: a slot is a position counted from 1", async (slot) => {
    await expect(insertCompanion(await createAttendee("slot"), slot)).rejects.toThrow("AttendeeCompanion_slot_check");
  });

  it("accepts no answers (SQL NULL) and a JSON object of answers", async () => {
    const attendeeId = await createAttendee("answers");
    await expect(insertCompanion(attendeeId, 1, null)).resolves.toBe(1);
    await expect(insertCompanion(attendeeId, 2, '{"diet": "vegan", "shirt": "M"}')).resolves.toBe(1);
    await expect(insertCompanion(attendeeId, 3, "{}")).resolves.toBe(1);
  });

  it.each([
    ["a JSON null", "null"],
    ["an array", '["vegan"]'],
    ["a string", '"vegan"'],
    ["a number", "5"],
    ["a boolean", "true"],
  ])("refuses %s as the answers, so no answers is only ever the SQL NULL", async (_label, json) => {
    await expect(insertCompanion(await createAttendee("not-object"), 1, json)).rejects.toThrow("AttendeeCompanion_custom_data_is_object");
  });

  it("belongs to an attendee that exists", async () => {
    await expect(insertCompanion("no-such-attendee", 1)).rejects.toThrow("AttendeeCompanion_attendee_id_fkey");
  });

  it("goes with its attendee when the attendee is deleted, and with nobody else's", async () => {
    const removed = await createAttendee("cascade");
    const kept = await createAttendee("cascade-kept");
    await insertCompanion(removed, 1);
    await insertCompanion(removed, 2);
    await insertCompanion(kept, 1);

    await prisma.attendee.delete({ where: { id: removed } });

    expect(await prisma.attendeeCompanion.count({ where: { attendee_id: removed } })).toBe(0);
    expect(await prisma.attendeeCompanion.count({ where: { attendee_id: kept } })).toBe(1);
  });
});
