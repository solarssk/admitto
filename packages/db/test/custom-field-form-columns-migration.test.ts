import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20261021120000_add_custom_field_form_columns/migration.sql"),
  "utf8",
);
// The numbering statement alone, to run it a second time on a table that already has the columns.
const NUMBERING_SQL = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf('UPDATE "EventCustomField"'));

const SCHEMA = "custom_field_form_columns_migration_test";

type Row = [id: string, eventId: string, createdAt: string];

let client: InstanceType<typeof Client>;

async function readRows() {
  const { rows } = await client.query<{ id: string; show_on_form: boolean; display_order: number | null }>(
    `SELECT "id", "show_on_form", "display_order" FROM "EventCustomField" ORDER BY "id"`,
  );
  return Object.fromEntries(rows.map((row) => [row.id, { show_on_form: row.show_on_form, display_order: row.display_order }]));
}

/** A table as it was before this migration, holding `rows`; the migration runs on it; what is left is returned. */
async function runMigrationOn(rows: Row[]) {
  await client.query(`DROP TABLE IF EXISTS "EventCustomField"`);
  await client.query(
    `CREATE TABLE "EventCustomField" ("id" TEXT PRIMARY KEY, "event_id" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL)`,
  );
  for (const [id, eventId, createdAt] of rows) {
    await client.query(`INSERT INTO "EventCustomField" ("id", "event_id", "created_at") VALUES ($1, $2, $3)`, [id, eventId, createdAt]);
  }
  await client.query(MIGRATION_SQL);
  return readRows();
}

// The migration only names "EventCustomField", so it runs against a copy of the three columns it
// reads in a schema of its own: no dependence on what the shared test database holds, and nothing
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

describe("20261021120000_add_custom_field_form_columns", () => {
  it("keeps every existing field off the registration form", async () => {
    const rows = await runMigrationOn([
      ["a", "evt-1", "2026-01-01"],
      ["b", "evt-2", "2026-01-02"],
    ]);
    expect(rows.a?.show_on_form).toBe(false);
    expect(rows.b?.show_on_form).toBe(false);
  });

  it("numbers an event's fields 0, 1, 2... oldest first, the order they were shown in", async () => {
    const rows = await runMigrationOn([
      ["third", "evt-1", "2026-03-01"],
      ["first", "evt-1", "2026-01-01"],
      ["second", "evt-1", "2026-02-01"],
    ]);
    expect(rows.first?.display_order).toBe(0);
    expect(rows.second?.display_order).toBe(1);
    expect(rows.third?.display_order).toBe(2);
  });

  it("breaks a tie in created_at by id, as fields made by one createMany are read", async () => {
    const rows = await runMigrationOn([
      ["f-c", "evt-1", "2026-01-01"],
      ["f-a", "evt-1", "2026-01-01"],
      ["f-b", "evt-1", "2026-01-01"],
    ]);
    expect([rows["f-a"]?.display_order, rows["f-b"]?.display_order, rows["f-c"]?.display_order]).toEqual([0, 1, 2]);
  });

  it("numbers each event on its own, from 0", async () => {
    const rows = await runMigrationOn([
      ["a1", "evt-a", "2026-01-01"],
      ["b1", "evt-b", "2026-01-02"],
      ["a2", "evt-a", "2026-01-03"],
      ["b2", "evt-b", "2026-01-04"],
      ["c1", "evt-c", "2026-01-05"],
    ]);
    expect([rows.a1?.display_order, rows.a2?.display_order]).toEqual([0, 1]);
    expect([rows.b1?.display_order, rows.b2?.display_order]).toEqual([0, 1]);
    expect(rows.c1?.display_order).toBe(0);
  });

  it("runs on a table with no rows", async () => {
    expect(await runMigrationOn([])).toEqual({});
  });

  it("never moves a field that already has a position when the numbering runs again", async () => {
    await runMigrationOn([
      ["a", "evt-1", "2026-01-01"],
      ["b", "evt-1", "2026-01-02"],
      ["c", "evt-1", "2026-01-03"],
    ]);
    // An organiser reordered (c first), then a new field d arrived without a position.
    await client.query(`UPDATE "EventCustomField" SET "display_order" = CASE "id" WHEN 'c' THEN 0 WHEN 'a' THEN 1 WHEN 'b' THEN 2 END`);
    await client.query(`INSERT INTO "EventCustomField" ("id", "event_id", "created_at") VALUES ('d', 'evt-1', '2026-01-04')`);

    await client.query(NUMBERING_SQL);

    const rows = await readRows();
    expect([rows.c?.display_order, rows.a?.display_order, rows.b?.display_order]).toEqual([0, 1, 2]);
    expect(rows.d?.display_order).not.toBeNull();
  });
});
