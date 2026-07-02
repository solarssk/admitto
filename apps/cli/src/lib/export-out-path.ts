import fs from "node:fs";
import path from "node:path";
import { CliError } from "./args.js";

function isPathInside(child: string, parent: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  return (
    resolvedChild === resolvedParent ||
    resolvedChild.startsWith(`${resolvedParent}${path.sep}`)
  );
}

function canonicalDir(dir: string): string {
  const resolved = path.resolve(dir);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Resolve symlinks in parent chain; reject symlink final paths. */
function canonicalExportOutPath(out: string): string {
  const resolved = path.resolve(out);

  try {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      throw new CliError("--out must not be a symlink.");
    }
    return fs.realpathSync(resolved);
  } catch (err) {
    if (err instanceof CliError) throw err;
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const parent = path.dirname(resolved);
  const base = path.basename(resolved);

  if (!fs.existsSync(parent)) {
    return resolved;
  }

  const realParent = fs.realpathSync(parent);
  const candidate = path.join(realParent, base);

  try {
    const candidateStat = fs.lstatSync(candidate);
    if (candidateStat.isSymbolicLink()) {
      throw new CliError("--out must not be a symlink.");
    }
    return fs.realpathSync(candidate);
  } catch (err) {
    if (err instanceof CliError) throw err;
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return candidate;
}

/**
 * Restrict emergency CSV exports to EMERGENCY_EXPORT_DIR and block UPLOAD_DIR
 * (served publicly at /uploads/*). Skips prefix checks when env vars are unset
 * (local dev without Docker env). Resolves symlinks when the parent path exists.
 */
export function assertSafeEmergencyExportOut(
  out: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const canonicalOut = canonicalExportOutPath(out);

  const uploadDir = env.UPLOAD_DIR?.trim();
  if (uploadDir && isPathInside(canonicalOut, canonicalDir(uploadDir))) {
    throw new CliError(
      `--out must not be under UPLOAD_DIR (${canonicalDir(uploadDir)}): /uploads is served without auth.`,
    );
  }

  const emergencyDir = env.EMERGENCY_EXPORT_DIR?.trim();
  if (emergencyDir && !isPathInside(canonicalOut, canonicalDir(emergencyDir))) {
    throw new CliError(
      `--out must be under EMERGENCY_EXPORT_DIR (${canonicalDir(emergencyDir)}).`,
    );
  }
}
