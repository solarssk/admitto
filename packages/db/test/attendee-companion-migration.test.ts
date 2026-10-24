/**
 * 20261023220000_add_attendee_companion on a database that already holds data. A database of its own is made, every
 * migration before this one is applied to it by `prisma migrate deploy`, rows are written (events, attendees, fields, a
 * registration that holds a companion), and then only this migration is applied, the way an upgrade applies it. Nothing may
 * be lost or changed, every field must read as a question about the guest, and the new table must work for the old attendees.
 *
 * A database and not a schema of the shared one: an earlier migration installs pgcrypto, whose functions live in the
 * schema the extension was created in, and a private schema beside a database that has it elsewhere cannot find them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const { Client } = pg;

const DB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(DB_ROOT, "prisma/migrations");
const THIS_MIGRATION = "20261023220000_add_attendee_companion";

let work: string;
let maintenance: InstanceType<typeof Client>;
let data: InstanceType<typeof Client>;
let prisma: PrismaClient;
let databaseName: string;
let databaseUrl: string;

/** `prisma migrate deploy` against the database of this test, for the migrations that are in the work directory now. */
function deploy(): void {
  execFileSync("npx", ["prisma", "migrate", "deploy", "--config", path.join(work, "prisma.config.mjs")], {
    cwd: DB_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}

const rowsOf = async <T extends Record<string, unknown>>(sql: string): Promise<T[]> => (await data.query<T>(sql)).rows;

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? "";
  assertTestDatabaseUrl(url);
  // Named for this run and ending in _test, which is what makes it a database the tests may reset.
  databaseName = `${new URL(url).pathname.slice(1)}_upgrade_${randomUUID().replaceAll("-", "").slice(0, 12)}_test`;
  const own = new URL(url);
  own.pathname = `/${databaseName}`;
  databaseUrl = own.toString();
  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = "/postgres";

  // A copy of the migrations that come before this one, with a Prisma config of its own pointing at the copy.
  work = mkdtempSync(path.join(tmpdir(), "admitto-companion-upgrade-"));
  const before = readdirSync(MIGRATIONS).filter((name) => /^\d{14}_/.test(name) && name < THIS_MIGRATION);
  mkdirSync(path.join(work, "migrations"));
  for (const name of before) cpSync(path.join(MIGRATIONS, name), path.join(work, "migrations", name), { recursive: true });
  cpSync(path.join(MIGRATIONS, "migration_lock.toml"), path.join(work, "migrations/migration_lock.toml"));
  // The database is the one of this run, which only the environment knows: the config reads it from there.
  writeFileSync(
    path.join(work, "prisma.config.mjs"),
    [
      "export default {",
      `  schema: ${JSON.stringify(path.join(DB_ROOT, "prisma/schema.prisma"))},`,
      `  migrations: { path: ${JSON.stringify(path.join(work, "migrations"))} },`,
      "  datasource: { url: process.env.DATABASE_URL },",
      "};",
      "",
    ].join("\n"),
  );

  maintenance = new Client({ connectionString: maintenanceUrl.toString() });
  await maintenance.connect();
  // A name made here from a database name and a random hex string, never request content.
  await maintenance.query(`CREATE DATABASE "${databaseName}"`);
  deploy();
  data = new Client({ connectionString: databaseUrl });
  await data.connect();
  prisma = createTestPrismaClient(databaseUrl);
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await data?.end();
  if (maintenance && databaseName) await maintenance.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await maintenance?.end();
  if (work) rmSync(work, { recursive: true, force: true });
});

describe(THIS_MIGRATION, () => {
  it("keeps every row of a populated database, reads every field as a question about the guest, and leaves the companions of registrations where they are", async () => {
    const org = await prisma.organization.create({ data: { name: "Upgrade Org", slug: "upgrade-org" } });
    const event = await prisma.event.create({
      data: { organization_id: org.id, title: "Upgrade Event", slug: "upgrade-event", date: new Date("2030-09-01") },
    });
    const attendees = await prisma.attendee.createManyAndReturn({
      data: [
        { event_id: event.id, email: "registered@example.com", name: "Registered" },
        { event_id: event.id, email: "revoked@example.com", name: "Revoked", status: "revoked" },
        { event_id: event.id, email: "answers@example.com", name: "Answers", custom_data: { diet: "vegan" } },
      ],
    });
    await prisma.registration.create({
      data: {
        event_id: event.id,
        email: "guest@example.com",
        first_name: "Guest",
        last_name: "Example",
        name: "Guest Example",
        status: "accepted",
        attendee_id: attendees[0]!.id,
        companions: [{ name: "Companion Example", custom_data: { diet: "none" } }],
      },
    });
    // Raw, because a row of the table as it is before this migration has no applies_to for the client to return.
    await data.query(
      `INSERT INTO "EventCustomField" ("id", "event_id", "source_field", "label", "type", "updated_at")
       VALUES ('field-diet', $1, 'diet', 'Diet', 'text', now()), ('field-size', $1, 'size', 'Size', 'select', now())`,
      [event.id],
    );
    const fieldColumns = `"id", "event_id", "source_field", "label", "type", "required", "show_on_form"`;
    const before = {
      attendees: await rowsOf(`SELECT * FROM "Attendee" ORDER BY "id"`),
      registrations: await rowsOf(`SELECT * FROM "Registration" ORDER BY "id"`),
      fields: await rowsOf(`SELECT ${fieldColumns} FROM "EventCustomField" ORDER BY "id"`),
    };
    expect(before.attendees).toHaveLength(3);
    // The state before the upgrade: the table is not there yet.
    expect(await rowsOf(`SELECT to_regclass('"AttendeeCompanion"') AS "table"`)).toEqual([{ table: null }]);

    cpSync(path.join(MIGRATIONS, THIS_MIGRATION), path.join(work, "migrations", THIS_MIGRATION), { recursive: true });
    deploy();

    expect(await rowsOf(`SELECT * FROM "Attendee" ORDER BY "id"`)).toEqual(before.attendees);
    expect(await rowsOf(`SELECT * FROM "Registration" ORDER BY "id"`)).toEqual(before.registrations);
    expect(await rowsOf(`SELECT ${fieldColumns} FROM "EventCustomField" ORDER BY "id"`)).toEqual(before.fields);
    expect(await rowsOf(`SELECT "id", "applies_to" FROM "EventCustomField" ORDER BY "id"`)).toEqual([
      { id: "field-diet", applies_to: "guest" },
      { id: "field-size", applies_to: "guest" },
    ]);
    // Nothing is made out of the companion a registration holds: it becomes an attendee's companion when the registration is accepted.
    expect(await rowsOf(`SELECT count(*)::int AS "n" FROM "AttendeeCompanion"`)).toEqual([{ n: 0 }]);
  });

  it("gives the old attendees a table to hold companions in, and takes them away with the attendee", async () => {
    const [old] = await prisma.attendee.findMany({ where: { email: "answers@example.com" } });
    await prisma.attendeeCompanion.create({ data: { attendee_id: old!.id, slot: 1, name: "Companion Example" } });
    expect(await prisma.attendeeCompanion.count({ where: { attendee_id: old!.id } })).toBe(1);
    await prisma.attendee.delete({ where: { id: old!.id } });
    expect(await prisma.attendeeCompanion.count()).toBe(0);
  });

  it("defaults a field created by code that does not know the column to the guest, and refuses a value outside the two", async () => {
    const [event] = await prisma.event.findMany();
    await data.query(
      `INSERT INTO "EventCustomField" ("id", "event_id", "source_field", "label", "updated_at") VALUES ('field-new', $1, 'newer', 'Newer', now())`,
      [event!.id],
    );
    expect(await rowsOf(`SELECT "applies_to" FROM "EventCustomField" WHERE "id" = 'field-new'`)).toEqual([{ applies_to: "guest" }]);
    await expect(
      data.query(
        `INSERT INTO "EventCustomField" ("id", "event_id", "source_field", "label", "applies_to", "updated_at") VALUES ('field-bad', $1, 'bad', 'Bad', 'everyone', now())`,
        [event!.id],
      ),
    ).rejects.toThrow("EventCustomField_applies_to_check");
  });
});
