import { accessSync, constants, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/** Written by the admin Vite build (`apps/admin/dist/build-meta.json`). */
export type AdminBuildMeta = {
  version: string;
  commit: string;
};

/**
 * Candidate roots for the staff SPA bundle (shared by staff-spa serve + health build-meta).
 * Paths are anchored to this module (`apps/web/src/admin`) and `process.cwd()`.
 */
export function adminDistCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    normalize(join(here, "../../../admin/dist")),
    normalize(join(process.cwd(), "apps/admin/dist")),
    normalize(join(process.cwd(), "../admin/dist")),
  ];
}

/** First candidate that contains `index.html`, else the primary path (same as staff-spa). */
export function resolveDefaultAdminDistRoot(): string {
  const candidates = adminDistCandidates();
  for (const root of candidates) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from trusted dist root candidates
      accessSync(join(root, "index.html"), constants.R_OK);
      return root;
    } catch {
      // try next candidate
    }
  }
  return candidates[0]!;
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
