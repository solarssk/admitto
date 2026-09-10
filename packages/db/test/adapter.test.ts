import { afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createPrismaAdapter, DEFAULT_STATEMENT_TIMEOUT_MS } from "../src/adapter.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");

let prisma: PrismaClient | undefined;

afterEach(async () => {
  await prisma?.$disconnect();
  prisma = undefined;
});

async function showStatementTimeout(client: PrismaClient): Promise<string> {
  const [row] = await client.$queryRaw<Array<{ statement_timeout: string }>>`SHOW statement_timeout`;
  return row?.statement_timeout ?? "";
}

describe("createPrismaAdapter", () => {
  it("applies DEFAULT_STATEMENT_TIMEOUT_MS to a new connection", async () => {
    expect(DEFAULT_STATEMENT_TIMEOUT_MS).toBe(30_000);
    prisma = new PrismaClient({ adapter: createPrismaAdapter(process.env.DATABASE_URL) });
    // Postgres's own SHOW output picks the "nicest" unit for a whole-second value (30000ms -> "30s").
    expect(await showStatementTimeout(prisma)).toBe("30s");
  });

  it("applies an explicit statementTimeoutMs override instead of the default", async () => {
    prisma = new PrismaClient({
      adapter: createPrismaAdapter(process.env.DATABASE_URL, { statementTimeoutMs: 5_000 }),
    });
    expect(await showStatementTimeout(prisma)).toBe("5s");
  });

  it("aborts a statement that runs past the configured timeout", async () => {
    prisma = new PrismaClient({
      adapter: createPrismaAdapter(process.env.DATABASE_URL, { statementTimeoutMs: 200 }),
    });
    await expect(prisma.$queryRaw`SELECT pg_sleep(1)`).rejects.toThrow();
  });

  it("scopes the connection's search_path to an explicit schema option", async () => {
    // Doesn't need the schema to actually exist - search_path is just a session GUC, and this
    // only asserts the adapter wires the option through to the pg-level connection (the half a
    // raw $queryRaw/$executeRaw call resolves unqualified table names against). The other half -
    // PrismaPg's own `schema` constructor arg, which scopes Prisma's *generated* queries the same
    // way - is exercised by the same call (both read the same `options.schema`), and functionally
    // by apps/web's per-worker integration schemas (packages/db/src/testing.ts) using both halves
    // together against real generated queries.
    prisma = new PrismaClient({
      adapter: createPrismaAdapter(process.env.DATABASE_URL, { schema: "adapter_schema_option_test" }),
    });
    const [row] = await prisma.$queryRaw<Array<{ search_path: string }>>`SHOW search_path`;
    expect(row?.search_path).toBe("adapter_schema_option_test");
  });

  it("rejects a schema option that isn't a plain identifier", () => {
    expect(() => createPrismaAdapter(process.env.DATABASE_URL, { schema: "public; drop table users;" })).toThrow(
      /not a plain identifier/,
    );
  });
});
