import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Walk up from `startDir` until monorepo root `package.json` with `"name": "admitto"`. */
export function findAdmittoRepoRoot(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "admitto") return dir;
      } catch {
        // ignore malformed package.json
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
