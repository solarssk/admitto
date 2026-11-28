import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(path.resolve(__dirname, "../prisma/migrations/20261117100000_add_event_bot_protection/migration.sql"), "utf8");

const SCHEMA = "event_bot_protection_migration_test";

let client: InstanceType<typeof Client>;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

describe("20261117100000_add_event_bot_protection", () => {
  it("leaves the bot check on for every event that exists, and on for an event added afterwards that says nothing", async () => {
    await client.query(`DROP TABLE IF EXISTS "EventRegistrationSettings"`);
    await client.query(`CREATE TABLE "EventRegistrationSettings" ("id" TEXT PRIMARY KEY, "mode" TEXT)`);
    await client.query(`INSERT INTO "EventRegistrationSettings" VALUES ('e-on', 'automatic'), ('e-off', NULL)`);

    await client.query(MIGRATION_SQL);
    await client.query(`INSERT INTO "EventRegistrationSettings" ("id") VALUES ('e-new')`);

    const { rows } = await client.query<{ id: string; bot_protection_enabled: boolean }>(
      `SELECT "id", "bot_protection_enabled" FROM "EventRegistrationSettings" ORDER BY "id"`,
    );
    expect(rows).toEqual([
      { id: "e-new", bot_protection_enabled: true },
      { id: "e-off", bot_protection_enabled: true },
      { id: "e-on", bot_protection_enabled: true },
    ]);
  });

  it("is a column that cannot be null, so a form never has no answer about its check", async () => {
    await expect(client.query(`INSERT INTO "EventRegistrationSettings" ("id", "bot_protection_enabled") VALUES ('e-null', NULL)`)).rejects.toThrow(/null value/);
  });
});
