import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Synchronous schema reset via execSync — call from a non-async beforeAll. */
export function resetDb(): void {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: fileURLToPath(new URL("../../db", import.meta.url)),
    env: process.env,
    stdio: "pipe",
  });
}
