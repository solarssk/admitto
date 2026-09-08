import { afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { BACKFILL_STATEMENT_TIMEOUT_MS, createBackfillPrismaClient } from "../src/scripts/backfillClient.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");

let prisma: PrismaClient | undefined;

afterEach(async () => {
  await prisma?.$disconnect();
  prisma = undefined;
});

describe("createBackfillPrismaClient", () => {
  it("applies BACKFILL_STATEMENT_TIMEOUT_MS, longer than the app default", async () => {
    expect(BACKFILL_STATEMENT_TIMEOUT_MS).toBe(110_000);
    prisma = createBackfillPrismaClient();
    const [row] = await prisma.$queryRaw<Array<{ statement_timeout: string }>>`SHOW statement_timeout`;
    // Postgres's own SHOW output picks the "nicest" unit for a whole-second value (110000ms -> "110s").
    expect(row?.statement_timeout).toBe("110s");
  });
});
