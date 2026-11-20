import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(path.resolve(__dirname, "../prisma/migrations/20261120100000_add_registration_origin/migration.sql"), "utf8");

const SCHEMA = "registration_origin_migration_test";

let client: InstanceType<typeof Client>;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(`CREATE TABLE "EventRegistrationSettings" ("id" TEXT PRIMARY KEY, "mode" TEXT)`);
  await client.query(`CREATE TABLE "Registration" ("id" TEXT PRIMARY KEY, "email" TEXT NOT NULL)`);
  await client.query(`INSERT INTO "EventRegistrationSettings" VALUES ('e-on', 'automatic'), ('e-off', NULL)`);
  await client.query(`INSERT INTO "Registration" VALUES ('r-old', 'old@example.com')`);
  await client.query(MIGRATION_SQL);
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

describe("20261120100000_add_registration_origin", () => {
  it("keeps the origin of a new request for every event that exists, and for an event added afterwards that says nothing", async () => {
    await client.query(`INSERT INTO "EventRegistrationSettings" ("id") VALUES ('e-new')`);

    const { rows } = await client.query<{ id: string; keep_origin: boolean }>(`SELECT "id", "keep_origin" FROM "EventRegistrationSettings" ORDER BY "id"`);

    expect(rows).toEqual([
      { id: "e-new", keep_origin: true },
      { id: "e-off", keep_origin: true },
      { id: "e-on", keep_origin: true },
    ]);
  });

  it("is a switch that cannot be null, so an event is never undecided about it", async () => {
    await expect(client.query(`INSERT INTO "EventRegistrationSettings" ("id", "keep_origin") VALUES ('e-null', NULL)`)).rejects.toThrow(/null value/);
  });

  it("leaves a registration that exists with no origin, and one added afterwards that says nothing has none", async () => {
    await client.query(`INSERT INTO "Registration" ("id", "email") VALUES ('r-new', 'new@example.com')`);

    const { rows } = await client.query(`SELECT "id", "submitted_ip", "submitted_timezone", "submitted_country", "submitted_region" FROM "Registration" ORDER BY "id"`);

    expect(rows).toEqual([
      { id: "r-new", submitted_ip: null, submitted_timezone: null, submitted_country: null, submitted_region: null },
      { id: "r-old", submitted_ip: null, submitted_timezone: null, submitted_country: null, submitted_region: null },
    ]);
  });

  it("holds each part as text", async () => {
    await client.query(`UPDATE "Registration" SET "submitted_ip" = '2001:db8::1', "submitted_timezone" = 'Europe/Warsaw', "submitted_country" = 'PL', "submitted_region" = 'Mazovia' WHERE "id" = 'r-new'`);

    const { rows } = await client.query(`SELECT "submitted_ip", "submitted_region" FROM "Registration" WHERE "id" = 'r-new'`);

    expect(rows).toEqual([{ submitted_ip: "2001:db8::1", submitted_region: "Mazovia" }]);
  });
});
