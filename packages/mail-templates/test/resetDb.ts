import { execSync } from "node:child_process";

/** Synchronous schema reset via execSync — call from a non-async beforeAll. */
export function resetDb(): void {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: new URL("../../db", import.meta.url).pathname,
    env: process.env,
    stdio: "pipe",
  });
}
