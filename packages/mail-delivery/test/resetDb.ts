import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db");

/**
 * Apply full migration history (including raw SQL partial indexes not expressible in schema.prisma).
 * db push alone would skip EmailDelivery_initial_unique and break atomic initial-send dedup.
 */
export function resetDb(): void {
  execSync("npx prisma migrate reset --force --skip-seed", {
    cwd: DB_ROOT,
    env: process.env,
    stdio: "pipe",
  });
}
