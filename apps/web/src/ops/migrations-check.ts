import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { findAdmittoRepoRoot } from "./repo-root.js";

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

function listMigrationNamesOnDisk(): Set<string> {
  const migrationsDir = join(findAdmittoRepoRoot(), "packages/db/prisma/migrations");
  if (!existsSync(migrationsDir)) return new Set();

  return new Set(
    readdirSync(migrationsDir).filter((name) =>
      existsSync(join(migrationsDir, name, "migration.sql")),
    ),
  );
}

/** Compare applied `_prisma_migrations` rows with migration folders on disk (read-only). */
export async function checkMigrationsStatus(db: PrismaClient): Promise<"ok" | "pending"> {
  const onDisk = listMigrationNamesOnDisk();
  if (onDisk.size === 0) return "pending";

  try {
    const rows = await db.$queryRaw<MigrationRow[]>(Prisma.sql`
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations
    `);

    const applied = new Set<string>();
    for (const row of rows) {
      if (row.rolled_back_at !== null) continue;
      if (row.finished_at === null) return "pending";
      applied.add(row.migration_name);
      if (!onDisk.has(row.migration_name)) return "pending";
    }

    for (const name of onDisk) {
      if (!applied.has(name)) return "pending";
    }
    return "ok";
  } catch {
    return "pending";
  }
}
