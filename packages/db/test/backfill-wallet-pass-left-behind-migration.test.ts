import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20261015100000_backfill_wallet_pass_left_behind_pass_id/migration.sql"),
  "utf8",
);

const SCHEMA = "backfill_wallet_pass_left_behind_test";

let client: InstanceType<typeof Client>;

/** Replace the pass rows, run the migration, and return what each row holds afterwards, by attendee. */
async function runMigrationOn(rows: Array<[attendeeId: string, lastErrorCode: string | null, leftBehind: string | null]>) {
  await client.query(`TRUNCATE "WalletPass"`);
  for (const [attendeeId, code, leftBehind] of rows) {
    await client.query(
      `INSERT INTO "WalletPass" ("attendee_id", "last_error_code", "left_behind_pass_id") VALUES ($1, $2, $3)`,
      [attendeeId, code, leftBehind],
    );
  }
  await client.query(MIGRATION_SQL);
  const { rows: after } = await client.query<{ attendee_id: string; left_behind_pass_id: string | null }>(
    `SELECT "attendee_id", "left_behind_pass_id" FROM "WalletPass" ORDER BY "attendee_id"`,
  );
  return Object.fromEntries(after.map((row) => [row.attendee_id, row.left_behind_pass_id]));
}

// The migration only names "WalletPass", so it runs against a copy of the three columns it uses in a schema of its own:
// no dependence on what the shared test database holds, and nothing is reset.
beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(
    `CREATE TABLE "WalletPass" ("attendee_id" TEXT PRIMARY KEY, "last_error_code" TEXT, "left_behind_pass_id" TEXT)`,
  );
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

describe("20261015100000_backfill_wallet_pass_left_behind_pass_id", () => {
  it("marks a row that a released version left as 'wallet_credential_changed', with the id it never recorded", async () => {
    const rows = await runMigrationOn([["att-credential-changed", "wallet_credential_changed", null]]);
    expect(rows["att-credential-changed"]).toBe("unknown");
  });

  it("keeps the value of a row that has the mark already", async () => {
    const rows = await runMigrationOn([["att-marked", "wallet_credential_changed", "pc-old-account"]]);
    expect(rows["att-marked"]).toBe("pc-old-account");
  });

  it("leaves rows alone that failed for another reason, that have no code, or that never had the mark", async () => {
    const rows = await runMigrationOn([
      ["att-timeout", "wallet_provider_timeout", null],
      ["att-expiration", "wallet_expiration_changed", null],
      ["att-no-code", null, null],
      ["att-no-code-marked", null, "pc-elsewhere"],
    ]);
    expect(rows["att-timeout"]).toBeNull();
    expect(rows["att-expiration"]).toBeNull();
    expect(rows["att-no-code"]).toBeNull();
    expect(rows["att-no-code-marked"]).toBe("pc-elsewhere");
  });

  it("does not create a row where there is none, and is safe to run twice", async () => {
    expect(await runMigrationOn([])).toEqual({});
    await runMigrationOn([["att-twice", "wallet_credential_changed", null]]);
    await client.query(MIGRATION_SQL);
    const { rows } = await client.query(`SELECT "left_behind_pass_id" FROM "WalletPass" WHERE "attendee_id" = 'att-twice'`);
    expect(rows[0].left_behind_pass_id).toBe("unknown");
  });
});
