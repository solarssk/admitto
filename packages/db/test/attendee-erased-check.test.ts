import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const EVENT_ID = "evt-erased-check";
const ORG_ID = "org-erased-check";

let prisma: PrismaClient | undefined;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma migrate reset --force", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Erased Constraint Org", slug: "erased-constraint" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Erased Constraint Gala",
      slug: "erased-constraint-gala",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
    },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function createAttendee(id: string) {
  return prisma!.attendee.create({
    data: {
      id,
      event_id: EVENT_ID,
      email: `${id}@example.com`,
      name: "Real Person",
      first_name: "Real",
      last_name: "Person",
      company: "Acme",
      department: "Ops",
      custom_data: { diet: "vegan" },
      token_hash: `hash-${id}`,
      token_enc: `enc-${id}`,
      qr_payload: `qr-${id}`,
      external_uuid: `uuid-${id}`,
      public_ref: `ref-${id}`,
    },
  });
}

/** The values an erased row holds, as SQL literals - the row the constraint must accept. */
function erasedValues(id: string): Record<string, string> {
  return {
    name: "'Erased attendee'",
    email: `'erased-${id}@erased.invalid'`,
    first_name: "NULL",
    last_name: "NULL",
    company: "NULL",
    department: "NULL",
    custom_data: "NULL",
    token_hash: "NULL",
    token_enc: "NULL",
    qr_payload: "NULL",
    external_uuid: "NULL",
    public_ref: "NULL",
  };
}

/** UPDATE that erases the row, with some columns overridden to put a value back. */
function eraseSql(id: string, overrides: Record<string, string> = {}): string {
  const values = { ...erasedValues(id), ...overrides };
  const assignments = Object.entries(values).map(([column, value]) => `"${column}" = ${value}`);
  return `UPDATE "Attendee" SET ${assignments.join(", ")}, "erased_at" = NOW() WHERE "id" = '${id}'`;
}

describe("Attendee erased_at DB constraint", () => {
  it("accepts the canonical erased row", async () => {
    const id = "erase-ok";
    await createAttendee(id);
    await prisma!.$executeRawUnsafe(eraseSql(id));
    const row = await prisma!.attendee.findUniqueOrThrow({ where: { id } });
    expect(row.erased_at).not.toBeNull();
  });

  it("does not constrain a row that is not erased", async () => {
    const attendee = await createAttendee("erase-untouched");
    expect(attendee.erased_at).toBeNull();
    expect(attendee.name).toBe("Real Person");
  });

  it.each([
    ["name", "'Real Person'"],
    ["email", "'real@example.com'"],
    ["first_name", "'Real'"],
    ["last_name", "'Person'"],
    ["company", "'Acme'"],
    ["department", "'Ops'"],
    ["custom_data", `'{"diet":"vegan"}'::jsonb`],
    ["token_hash", "'hash'"],
    ["token_enc", "'enc'"],
    ["qr_payload", "'qr'"],
    ["external_uuid", "'uuid'"],
    ["public_ref", "'ref'"],
  ])("rejects an erased row that still holds %s", async (column, leftover) => {
    const id = `erase-bad-${column}`;
    await createAttendee(id);
    // Everything scrubbed except this one column: only it may trip the constraint.
    await expect(prisma!.$executeRawUnsafe(eraseSql(id, { [column]: leftover }))).rejects.toThrow(
      /Attendee_erased_carries_no_personal_data/,
    );
  });

  it("rejects stamping erased_at on a row that was not scrubbed", async () => {
    const id = "erase-stamp-only";
    await createAttendee(id);
    await expect(
      prisma!.$executeRawUnsafe(`UPDATE "Attendee" SET "erased_at" = NOW() WHERE "id" = '${id}'`),
    ).rejects.toThrow(/Attendee_erased_carries_no_personal_data/);
  });

  it("rejects an erased row whose email is another row's placeholder", async () => {
    const id = "erase-wrong-placeholder";
    await createAttendee(id);
    await expect(
      prisma!.$executeRawUnsafe(
        eraseSql(id, { email: "'erased-someone-else@erased.invalid'" }),
      ),
    ).rejects.toThrow(/Attendee_erased_carries_no_personal_data/);
  });

  it.each([
    ["clearing erased_at", `"erased_at" = NULL`],
    ["moving erased_at", `"erased_at" = NOW() + INTERVAL '1 day'`],
  ])("refuses %s on an erased row, so personal data cannot be written back", async (_label, assignment) => {
    const id = `erase-permanent-${_label.replace(/\W+/g, "-")}`;
    await createAttendee(id);
    await prisma!.$executeRawUnsafe(eraseSql(id));
    await expect(
      prisma!.$executeRawUnsafe(`UPDATE "Attendee" SET ${assignment} WHERE "id" = '${id}'`),
    ).rejects.toThrow(/erased_at cannot be changed once set/);
    // The row is still erased, and a hard delete is still possible.
    expect((await prisma!.attendee.findUniqueOrThrow({ where: { id } })).erased_at).not.toBeNull();
    await prisma!.attendee.delete({ where: { id } });
  });

  it("lets an unrelated update of an erased row through", async () => {
    const id = "erase-unrelated-update";
    await createAttendee(id);
    await prisma!.$executeRawUnsafe(eraseSql(id));
    await prisma!.attendee.update({ where: { id }, data: { status: "cancelled" } });
    expect((await prisma!.attendee.findUniqueOrThrow({ where: { id } })).status).toBe("cancelled");
  });

  it("rejects writing personal data back to an already erased row", async () => {
    const id = "erase-writeback";
    await createAttendee(id);
    await prisma!.$executeRawUnsafe(eraseSql(id));
    await expect(
      prisma!.attendee.update({ where: { id }, data: { company: "Acme" } }),
    ).rejects.toThrow(/Attendee_erased_carries_no_personal_data/);
  });
});
