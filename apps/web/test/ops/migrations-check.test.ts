import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { checkMigrationsStatus } from "../../src/ops/migrations-check.js";
import { dirname, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("checkMigrationsStatus", () => {
  it("resolves migration folders from the web package anchor (not only process.cwd)", () => {
    const moduleDir = join(dirname(fileURLToPath(import.meta.url)), "../..", "src", "ops");
    const migrationsDir = join(moduleDir, "../../../../packages/db/prisma/migrations");
    expect(existsSync(migrationsDir)).toBe(true);
    const onDisk = readdirSync(migrationsDir).filter((name) =>
      existsSync(join(migrationsDir, name, "migration.sql")),
    );
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it("returns ok when applied rows match migrations on disk", async () => {
    const moduleDir = join(dirname(fileURLToPath(import.meta.url)), "../..", "src", "ops");
    const migrationsDir = join(moduleDir, "../../../../packages/db/prisma/migrations");
    const rows = readdirSync(migrationsDir)
      .filter((name) => existsSync(join(migrationsDir, name, "migration.sql")))
      .map((migration_name) => ({
        migration_name,
        finished_at: new Date(),
        rolled_back_at: null,
      }));

    const db = {
      $queryRaw: async (query: unknown) => {
        const sql =
          typeof query === "object" && query !== null && "strings" in query
            ? (query as Prisma.Sql).strings.join("")
            : String(query);
        if (sql.includes("_prisma_migrations")) return rows;
        return [{ "?column?": 1 }];
      },
    };

    await expect(checkMigrationsStatus(db as never)).resolves.toBe("ok");
  });
});
