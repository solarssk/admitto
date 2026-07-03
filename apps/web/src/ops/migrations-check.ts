import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { findAdmittoRepoRoot } from "./repo-root.js";

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

/** Anchor from this module to `@admitto/web` — avoids relying on `process.cwd()` in Vitest forks. */
const WEB_PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** List Prisma migration folder names that contain `migration.sql`. */
function listMigrationNamesOnDisk(): Set<string> {
  const root = findAdmittoRepoRoot(WEB_PACKAGE_DIR);
  if (!root) return new Set();

  const migrationsDir = join(root, "packages/db/prisma/migrations");
  if (!existsSync(migrationsDir)) return new Set();

  try {
    return new Set(
      readdirSync(migrationsDir).filter((name) =>
        existsSync(join(migrationsDir, name, "migration.sql")),
      ),
    );
  } catch {
    return new Set();
  }
}

/** Compare applied `_prisma_migrations` rows with migration folders on disk (read-only). */
export async function checkMigrationsStatus(db: PrismaClient): Promise<"ok" | "pending"> {
  try {
    const onDisk = listMigrationNamesOnDisk();
    if (onDisk.size === 0) return "pending";

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
