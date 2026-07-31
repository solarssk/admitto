import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Prisma } from "@admitto/db";
import { checkMigrationsStatus } from "../../src/ops/migrations-check.js";

const require = createRequire(import.meta.url);

function migrationsDirFromDbPackage(): string {
  const dbEntry = require.resolve("@admitto/db");
  return join(dirname(dbEntry), "..", "prisma/migrations");
}

describe("checkMigrationsStatus", () => {
  it("resolves migration folders via @admitto/db package", () => {
    const migrationsDir = migrationsDirFromDbPackage();
    expect(existsSync(migrationsDir)).toBe(true);
    const onDisk = readdirSync(migrationsDir).filter((name) =>
      existsSync(join(migrationsDir, name, "migration.sql")),
    );
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it("returns ok when applied rows match migrations on disk", async () => {
    const migrationsDir = migrationsDirFromDbPackage();
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
