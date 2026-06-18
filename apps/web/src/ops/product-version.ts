import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findAdmittoRepoRoot } from "./repo-root.js";

let cachedVersion: string | undefined;

/** Product semver from root `package.json` (not workspace package versions). */
export function resolveProductVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const root = findAdmittoRepoRoot();
    if (!root) {
      cachedVersion = "unknown";
      return cachedVersion;
    }
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
    cachedVersion = typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}

/** @internal test helper */
export function resetProductVersionCache(): void {
  cachedVersion = undefined;
}
