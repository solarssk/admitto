import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20261021140000_add_custom_field_rules/migration.sql"),
  "utf8",
);

const SCHEMA = "custom_field_rules_migration_test";

let client: InstanceType<typeof Client>;

/** A table as it was before this migration, holding rows with these ids; the migration runs on it. */
async function runMigrationOn(ids: string[]) {
  await client.query(`DROP TABLE IF EXISTS "EventCustomField"`);
  await client.query(`CREATE TABLE "EventCustomField" ("id" TEXT PRIMARY KEY, "type" TEXT NOT NULL DEFAULT 'text')`);
  for (const id of ids) {
    await client.query(`INSERT INTO "EventCustomField" ("id") VALUES ($1)`, [id]);
  }
  await client.query(MIGRATION_SQL);
}

async function insertWithRules(id: string, rulesJson: string) {
  await client.query(`INSERT INTO "EventCustomField" ("id", "rules") VALUES ($1, $2::jsonb)`, [id, rulesJson]);
}

// The migration only names "EventCustomField", so it runs against a copy of the two columns it
// needs in a schema of its own: no dependence on what the shared test database holds, and nothing
// is reset.
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

describe("20261021140000_add_custom_field_rules", () => {
  it("leaves every existing field without rules", async () => {
    await runMigrationOn(["a", "b"]);
    const { rows } = await client.query<{ id: string; rules: unknown }>(
      `SELECT "id", "rules" FROM "EventCustomField" ORDER BY "id"`,
    );
    expect(rows).toEqual([
      { id: "a", rules: null },
      { id: "b", rules: null },
    ]);
  });

  it("runs on a table with no rows", async () => {
    await expect(runMigrationOn([])).resolves.toBeUndefined();
  });

  it("adds a nullable column, so a writer that does not know it still inserts", async () => {
    await runMigrationOn([]);
    await expect(client.query(`INSERT INTO "EventCustomField" ("id") VALUES ('plain')`)).resolves.toBeDefined();
    const { rows } = await client.query<{ is_nullable: string; data_type: string }>(
      `SELECT is_nullable, data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'EventCustomField' AND column_name = 'rules'`,
      [SCHEMA],
    );
    expect(rows).toEqual([{ is_nullable: "YES", data_type: "jsonb" }]);
  });

  it("accepts no rules and a JSON object, whatever keys it holds", async () => {
    await runMigrationOn([]);
    await insertWithRules("empty", "{}");
    await insertWithRules("some", '{"min_length": 3, "max_length": 9, "digits_only": true, "example": "600100200"}');
    // The keys are checked by the application, so a later rule needs no migration.
    await insertWithRules("future", '{"a_rule_added_later": 1}');
    const { rows } = await client.query<{ id: string }>(`SELECT "id" FROM "EventCustomField" ORDER BY "id"`);
    expect(rows.map((row) => row.id)).toEqual(["empty", "future", "some"]);
  });

  it.each([
    ["a JSON null", "null"],
    ["an array", "[]"],
    ["a string", '"digits_only"'],
    ["a number", "5"],
    ["a boolean", "true"],
  ])("refuses %s, so no rules is only ever the SQL NULL", async (_label, json) => {
    await runMigrationOn([]);
    await expect(insertWithRules("bad", json)).rejects.toThrow("EventCustomField_rules_is_object");
  });
});
