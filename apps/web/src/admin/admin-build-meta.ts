import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/** Written by the admin Vite build (`apps/admin/dist/build-meta.json`). */
export type AdminBuildMeta = {
  version: string;
  commit: string;
};

/** Same candidate roots as `staff-spa` uses to locate the served SPA bundle. */
export function adminDistCandidates(moduleUrl: string = import.meta.url): string[] {
  const here = dirname(fileURLToPath(moduleUrl));
  return [
    normalize(join(here, "../../admin/dist")),
    normalize(join(process.cwd(), "apps/admin/dist")),
    normalize(join(process.cwd(), "../admin/dist")),
  ];
}

/**
 * Read version/commit baked into the staff SPA that this web process serves.
 * That is the same identity the sidebar footer shows (`__APP_*` from the Vite build).
 */
export function readAdminBuildMeta(distRoot?: string): AdminBuildMeta | null {
  const roots = distRoot ? [normalize(distRoot)] : adminDistCandidates();
  for (const root of roots) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from trusted dist root candidates
      const raw = JSON.parse(readFileSync(join(root, "build-meta.json"), "utf8")) as {
        version?: unknown;
        commit?: unknown;
      };
      if (typeof raw.version !== "string" || typeof raw.commit !== "string") continue;
      const version = raw.version.trim();
      const commit = raw.commit.trim().slice(0, 7);
      if (!version || !commit) continue;
      return { version, commit };
    } catch {
      // try next candidate
    }
  }
  return null;
}
