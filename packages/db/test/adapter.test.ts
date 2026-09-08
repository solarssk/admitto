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
});
