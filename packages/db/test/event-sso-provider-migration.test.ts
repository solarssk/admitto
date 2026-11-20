import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(path.resolve(__dirname, "../prisma/migrations/20261116100000_add_event_sso_provider/migration.sql"), "utf8");

const SCHEMA = "event_sso_provider_migration_test";
const KEY = "registration_sso_provider_id";

let client: InstanceType<typeof Client>;

type Event = { id: string; methods: string[] };

/**
 * The three tables the migration names, as they were before it, in a schema of its own (no dependence on what the shared test
 * database holds, nothing is reset). `chosen` is the stored value of the instance's provider (null: no row), `providers` the
 * identity providers as [id, type].
 */
async function runMigrationOn({ chosen, providers, events }: { chosen: string | null; providers: [string, string][]; events: Event[] }) {
  await client.query(`DROP TABLE IF EXISTS "EventRegistrationSettings", "SystemSettings", "IdentityProvider" CASCADE`);
  await client.query(`CREATE TABLE "IdentityProvider" ("id" TEXT PRIMARY KEY, "provider_type" TEXT NOT NULL)`);
  await client.query(`CREATE TABLE "SystemSettings" ("key" TEXT PRIMARY KEY, "value_json" TEXT NOT NULL)`);
  await client.query(`CREATE TABLE "EventRegistrationSettings" ("id" TEXT PRIMARY KEY, "access_methods" TEXT[] NOT NULL DEFAULT '{}')`);
  for (const [id, type] of providers) await client.query(`INSERT INTO "IdentityProvider" VALUES ($1, $2)`, [id, type]);
  if (chosen !== null) await client.query(`INSERT INTO "SystemSettings" VALUES ($1, $2)`, [KEY, chosen]);
  for (const event of events) await client.query(`INSERT INTO "EventRegistrationSettings" VALUES ($1, $2)`, [event.id, event.methods]);
  await client.query(MIGRATION_SQL);
}

async function providerOf(): Promise<Record<string, string | null>> {
  const { rows } = await client.query<{ id: string; sso_provider_id: string | null }>(
    `SELECT "id", "sso_provider_id" FROM "EventRegistrationSettings" ORDER BY "id"`,
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.sso_provider_id]));
}

const EVENTS: Event[] = [
  { id: "e-sso", methods: ["sso"] },
  { id: "e-link", methods: ["link"] },
  { id: "e-password", methods: ["password"] },
  { id: "e-off", methods: [] },
];

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

describe("20261116100000_add_event_sso_provider", () => {
  it("gives the provider chosen for the instance to every event that uses the company sign-in, and to no other", async () => {
    await runMigrationOn({ chosen: '"idp-1"', providers: [["idp-1", "oidc"], ["idp-2", "oidc"]], events: EVENTS });
    expect(await providerOf()).toEqual({ "e-sso": "idp-1", "e-link": null, "e-password": null, "e-off": null });
  });

  it("leaves every event without a provider when none was chosen", async () => {
    await runMigrationOn({ chosen: null, providers: [["idp-1", "oidc"]], events: EVENTS });
    expect(await providerOf()).toEqual({ "e-sso": null, "e-link": null, "e-password": null, "e-off": null });
  });

  it.each([
    ["a row that is not JSON", "not json"],
    ["a number", "7"],
    ["an empty string", '""'],
    ["a string with an escape", '"idp\\u0031"'],
    ["an id that is no provider", '"idp-gone"'],
    ["an id with a quote inside", '"idp-1"extra"'],
    ["an array", '["idp-1"]'],
  ])("skips %s and does not fail", async (_label, chosen) => {
    await runMigrationOn({ chosen, providers: [["idp-1", "oidc"]], events: EVENTS });
    expect(await providerOf()).toEqual({ "e-sso": null, "e-link": null, "e-password": null, "e-off": null });
  });

  it("skips a provider that is not an OIDC provider, as the old code read it as missing", async () => {
    await runMigrationOn({ chosen: '"idp-cf"', providers: [["idp-cf", "cloudflare_access"]], events: EVENTS });
    expect(await providerOf()).toEqual({ "e-sso": null, "e-link": null, "e-password": null, "e-off": null });
  });

  it("keeps a provider that is switched off (the migration reads no flag of it)", async () => {
    await runMigrationOn({ chosen: '"idp-1"', providers: [["idp-1", "oidc"]], events: [{ id: "e-sso", methods: ["sso"] }] });
    expect(await providerOf()).toEqual({ "e-sso": "idp-1" });
  });

  it("runs on tables with no rows, and leaves the old key where it was", async () => {
    await runMigrationOn({ chosen: '"idp-1"', providers: [], events: [] });
    const { rows } = await client.query(`SELECT "value_json" FROM "SystemSettings" WHERE "key" = $1`, [KEY]);
    expect(rows).toEqual([{ value_json: '"idp-1"' }]);
  });

  it("adds a CHECK that keeps a provider to the company sign-in, and a foreign key that sets it null", async () => {
    await runMigrationOn({ chosen: null, providers: [["idp-1", "oidc"]], events: [{ id: "e-link", methods: ["link"] }] });
    await expect(client.query(`UPDATE "EventRegistrationSettings" SET "sso_provider_id" = 'idp-1'`)).rejects.toThrow(
      /EventRegistrationSettings_sso_provider_check/,
    );
    await client.query(`UPDATE "EventRegistrationSettings" SET "access_methods" = '{sso}', "sso_provider_id" = 'idp-1'`);
    await client.query(`DELETE FROM "IdentityProvider"`);
    expect(await providerOf()).toEqual({ "e-link": null });
  });
});
