import fs, { constants } from "node:fs";
import path from "node:path";
import { CliError } from "./args.js";

const PRIVATE_EXPORT_MODE = 0o600;

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
 * Validate `--out` and return the canonical path to write.
 * Restricts to EMERGENCY_EXPORT_DIR and blocks UPLOAD_DIR (public /uploads/*).
 * Skips prefix checks when env vars are unset (local dev without Docker env).
 */
export function assertSafeEmergencyExportOut(
  out: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const resolvedOut = path.resolve(out);
  const canonicalOut = canonicalExportOutPath(out);

  const uploadDir = env.UPLOAD_DIR?.trim();
  if (uploadDir) {
    const resolvedUploadDir = path.resolve(uploadDir);
    const realUploadDir = canonicalDir(uploadDir);
    // Raw path: /uploads/* is served without auth; readFile follows symlinks under UPLOAD_DIR.
    if (isPathInside(resolvedOut, resolvedUploadDir)) {
      throw new CliError(
        `--out must not be under UPLOAD_DIR (${resolvedUploadDir}): /uploads is served without auth.`,
      );
    }
    if (isPathInside(canonicalOut, realUploadDir)) {
      throw new CliError(
        `--out must not resolve under UPLOAD_DIR (${realUploadDir}): /uploads is served without auth.`,
      );
    }
  }

  const emergencyDir = env.EMERGENCY_EXPORT_DIR?.trim();
  if (emergencyDir) {
    const resolvedEmergencyDir = path.resolve(emergencyDir);
    const realEmergencyDir = canonicalDir(emergencyDir);

    if (uploadDir && isPathInside(resolvedEmergencyDir, path.resolve(uploadDir))) {
      throw new CliError(
        `EMERGENCY_EXPORT_DIR must not be under UPLOAD_DIR (${path.resolve(uploadDir)}): use a non-public path.`,
      );
    }

    if (!isPathInside(resolvedOut, resolvedEmergencyDir)) {
      throw new CliError(
        `--out must be under EMERGENCY_EXPORT_DIR (${resolvedEmergencyDir}).`,
      );
    }
    if (!isPathInside(canonicalOut, realEmergencyDir)) {
      throw new CliError(
        `--out must resolve under EMERGENCY_EXPORT_DIR (${realEmergencyDir}).`,
      );
    }
  }

  return canonicalOut;
}

/** Write export CSV with 0600 perms; O_NOFOLLOW rejects symlink races at open time. */
export function writeSafeEmergencyExportFile(
  out: string,
  content: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const exportPath = assertSafeEmergencyExportOut(out, env);
  const data = Buffer.from(content, "utf8");
  let fd: number | undefined;
  try {
    fd = fs.openSync(
      exportPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      PRIVATE_EXPORT_MODE,
    );
    fs.writeSync(fd, data);
    fs.fchmodSync(fd, PRIVATE_EXPORT_MODE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ELOOP") {
      throw new CliError("--out must not be a symlink.");
    }
    throw err;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
  return exportPath;
}
