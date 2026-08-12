import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Shared by vite.config.ts and vitest.config.ts (config-time only, never shipped to the
 * browser) - both need the same __APP_VERSION__/__APP_COMMIT__ values so dev and test builds
 * match production. */

export function resolveAppVersion(): string {
  return (
    JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf-8")) as {
      version: string;
    }
  ).version;
}

// The production image has no .git dir, so publish-container.yml passes the real commit as a
// Docker build-arg (GIT_COMMIT); local dev/builds fall back to the checked-out HEAD.
export function resolveCommitSha(): string {
  const sha = process.env.GIT_COMMIT ?? gitHeadSha();
  return sha ? sha.slice(0, 7) : "unknown";
}

/** Persist the same identity the SPA embeds as `__APP_*`, for the web health report. */
export function writeBuildMetaJson(outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "build-meta.json"),
    `${JSON.stringify({ version: resolveAppVersion(), commit: resolveCommitSha() }, null, 2)}\n`,
    "utf8",
  );
}

function gitHeadSha(): string | null {
  try {
    // --short is skipped: its length varies with hash density (7 or 8+ chars depending on the
    // repo) - always resolve the full SHA and slice to a fixed 7, matching GitHub's own display.
    // Bare "git" resolves via PATH, same as every other npm script this monorepo's build already
    // shells out through (tsc, prisma, vite itself) - this is trusted build/CI tooling, never
    // fed untrusted input, so it isn't a meaningfully different exposure than the rest of the
    // toolchain (SonarCloud typescript:S4036 reviewed and accepted).
    return execSync("git rev-parse HEAD", { cwd: import.meta.dirname }).toString().trim(); // NOSONAR - see comment above
  } catch {
    return null;
  }
}
