import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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

  it("does not let a live attendee take an address in the erased namespace", async () => {
    await expect(
      prisma!.attendee.create({
        data: { event_id: EVENT_ID, email: "Erased-someone@Erased.Invalid", name: "Squatter" },
      }),
    ).rejects.toThrow(/Attendee_email_not_erased_placeholder/);
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

describe("the migration's handling of addresses already in the reserved namespace", () => {
  const migration = readFileSync(
    path.join(DB_ROOT, "prisma/migrations/20261008120000_add_attendee_erased_at/migration.sql"),
    "utf8",
  );
  const remediation = /UPDATE "Attendee"[\s\S]*?;/.exec(migration)?.[0];
  const constraint = /ALTER TABLE "Attendee" ADD CONSTRAINT "Attendee_email_not_erased_placeholder"[\s\S]*?\n\);/.exec(
    migration,
  )?.[0];

  it("moves such an address to a domain that is not reserved, so the constraint can be added", async () => {
    expect(remediation).toBeDefined();
    expect(constraint).toBeDefined();
    // Put the database back in the state of an upgrade: rows from before the constraint existed.
    await prisma!.$executeRawUnsafe('ALTER TABLE "Attendee" DROP CONSTRAINT "Attendee_email_not_erased_placeholder"');
    try {
      for (const [id, email] of [
        ["legacy-reserved-1", "someone@erased.invalid"],
        ["legacy-reserved-2", "Other.Person@ERASED.INVALID"],
        ["legacy-fine", "fine@example.com"],
        ["legacy-similar", "x@erased.invalid.example.com"],
        // The same local part in the reserved domain and in the domain the old rows move to, and
        // two spellings of one address: none of them may end up on the same address.
        ["legacy-collide-1", "alice@erased.invalid"],
        ["legacy-collide-2", "alice@legacy.erased.invalid"],
        ["legacy-collide-3", "ALICE@ERASED.INVALID"],
      ] as const) {
        await prisma!.attendee.create({ data: { id, event_id: EVENT_ID, email, name: id } });
      }

      await prisma!.$executeRawUnsafe(remediation!);
      await prisma!.$executeRawUnsafe(constraint!);

      const emails = Object.fromEntries(
        (await prisma!.attendee.findMany({ where: { id: { startsWith: "legacy-" } } })).map((a) => [a.id, a.email]),
      );
      expect(emails).toEqual({
        "legacy-reserved-1": "someone+legacy-reserved-1@legacy.erased.invalid",
        "legacy-reserved-2": "Other.Person+legacy-reserved-2@legacy.erased.invalid",
        "legacy-fine": "fine@example.com",
        "legacy-similar": "x@erased.invalid.example.com",
        "legacy-collide-1": "alice+legacy-collide-1@legacy.erased.invalid",
        "legacy-collide-2": "alice@legacy.erased.invalid",
        "legacy-collide-3": "ALICE+legacy-collide-3@legacy.erased.invalid",
      });
      await expect(
        prisma!.attendee.create({ data: { event_id: EVENT_ID, email: "again@erased.invalid", name: "Again" } }),
      ).rejects.toThrow(/Attendee_email_not_erased_placeholder/);
    } finally {
      // The constraint is back from the statement above unless that failed; keep the suite's state sane.
      await prisma!.attendee.deleteMany({ where: { id: { startsWith: "legacy-" } } });
    }
  });
});
