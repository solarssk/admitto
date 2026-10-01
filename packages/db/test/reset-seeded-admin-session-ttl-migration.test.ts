import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20261001150000_reset_seeded_admin_session_ttl/migration.sql"),
  "utf8",
);

const SEVEN_DAYS_MS = "604800000";
const TWELVE_HOURS_MS = "43200000";
const SCHEMA = "reset_session_ttl_migration_test";

let client: InstanceType<typeof Client>;

/** Replace the settings rows, run the migration, and return the rows that are left. */
async function runMigrationOn(rows: Array<[key: string, value: string]>) {
  await client.query(`TRUNCATE "SystemSettings"`);
  for (const [key, value] of rows) {
    await client.query(`INSERT INTO "SystemSettings" ("key", "value_json", "updated_at") VALUES ($1, $2, '2026-01-01')`, [key, value]);
  }
  await client.query(MIGRATION_SQL);
  const { rows: after } = await client.query<{ key: string; value_json: string; touched: boolean }>(
    `SELECT "key", "value_json", "updated_at" > '2026-01-02' AS touched FROM "SystemSettings" ORDER BY "key"`,
  );
  return Object.fromEntries(after.map((r) => [r.key, { value: r.value_json, touched: r.touched }]));
}

// The migration only names "SystemSettings", so it runs against a copy of that table in a schema of
// its own: no dependence on what the shared test database holds, and nothing is reset.
beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(
    `CREATE TABLE "SystemSettings" ("key" TEXT PRIMARY KEY, "value_json" TEXT NOT NULL, "updated_at" TIMESTAMP(3) NOT NULL)`,
  );
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

describe("20261001150000_reset_seeded_admin_session_ttl", () => {
  it("moves a session_ttl that still holds the seeded 7 days to 12 hours and stamps the row", async () => {
    const rows = await runMigrationOn([["session_ttl", SEVEN_DAYS_MS]]);
    expect(rows["session_ttl"]).toEqual({ value: TWELVE_HOURS_MS, touched: true });
  });

  it("leaves a lifetime someone set to another value alone", async () => {
    for (const value of ["86400000", "2592000000", TWELVE_HOURS_MS, "3600000"]) {
      const rows = await runMigrationOn([["session_ttl", value]]);
      expect(rows["session_ttl"]).toEqual({ value, touched: false });
    }
  });

  it("changes no other setting, not even one that holds the same number", async () => {
    const rows = await runMigrationOn([
      ["session_ttl", SEVEN_DAYS_MS],
      ["operator_session_ttl", SEVEN_DAYS_MS],
      ["trusted_device_days", "30"],
      ["mfa_required_roles", '["admin","superadmin"]'],
    ]);
    expect(rows["session_ttl"]?.value).toBe(TWELVE_HOURS_MS);
    expect(rows["operator_session_ttl"]).toEqual({ value: SEVEN_DAYS_MS, touched: false });
    expect(rows["trusted_device_days"]).toEqual({ value: "30", touched: false });
    expect(rows["mfa_required_roles"]).toEqual({ value: '["admin","superadmin"]', touched: false });
  });

  it("does not create a row where there is none, and is safe to run twice", async () => {
    expect(await runMigrationOn([["trusted_device_days", "30"]])).not.toHaveProperty("session_ttl");
    await runMigrationOn([["session_ttl", SEVEN_DAYS_MS]]);
    await client.query(MIGRATION_SQL);
    const { rows } = await client.query(`SELECT "value_json" FROM "SystemSettings" WHERE "key" = 'session_ttl'`);
    expect(rows[0].value_json).toBe(TWELVE_HOURS_MS);
  });
});
